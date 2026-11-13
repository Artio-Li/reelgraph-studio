/**
 * 自动导演（Auto Director）
 *
 * Brief（方向 + 关键词 + 规格）→ Planner（LLM / 规则兜底）→ Validator（硬性校验）
 * → 自动建画布 → 交给现有画布执行器 → 质检/重试 → 分镜板导出成片。
 *
 * 设计要点：导演不直接调生成接口，而是生成一张画布再走 /api/canvases/:id/runs，
 * 复用 DAG 执行、质检、重试、退款与媒体管理。
 */
import { CFG } from './config.js';
import { db, uid, now, priceOf } from './db.js';
import { canvasProvider } from './canvasAI.js';
import { signToken } from './auth.js';

const ACTIVE = new Set(['planning', 'running', 'assembling']);
const MAX_SHOTS = 8;
const MAX_CHAIN = 3;
const STALE_MS = 90 * 60 * 1000;
const PROVIDER_ORDER = ['antigravity', 'chatgpt2api', 'gemini'];

const running = new Set();

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/* ------------------------------- Planner ------------------------------- */

const PLANNER_SYSTEM = `你是 ReelGraph Studio 的 AI 视频导演。根据用户的创作方向与关键词，规划一支可直接生产的短片。

只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。

JSON 结构：
{
  "title": "不超过 20 字的成片标题",
  "character": { "name": "人物代号", "description": "一句话外观：年龄感、发型、服装、气质" },
  "shots": [
    {
      "index": 1,
      "label": "镜头 1",
      "duration": 10,
      "continuation": false,
      "prompt": "可直接用于视频模型的完整中文提示词：人物、服装、场景、光线来源、机位、景别、逐段动作节奏"
    }
  ]
}

硬性规则：
1. duration 只能是 5、6、8、10 之一；所有镜头时长之和应等于用户要求的成片时长（允许 ±10%）。
2. 每个 prompt 只描述本镜头，不要把多个镜头写进同一段。
3. prompt 里不要出现与本镜头 duration 冲突的时长描述（例如 duration=10 却写“严格 5 秒”）。
4. 人物外观在每段 prompt 里都要重复写清楚（发色、服装、配饰），不要依赖模型记忆。
5. 第一个镜头 continuation 必须为 false；后续镜头需要与上一镜头连续时才为 true。
6. 一段 10 秒内最多 2–3 个主要动作，不要塞入无法完成的动作。
7. 只写画面，不写镜头切换、转场、字幕或后期。`;

function shotCountFor(brief) {
  const total = Number(brief.totalSeconds) || 30;
  const per = Number(brief.shotSeconds) || 10;
  return Math.min(MAX_SHOTS, Math.max(1, Math.round(total / per)));
}

function plannerUserPrompt(brief) {
  const count = shotCountFor(brief);
  const per = Number(brief.shotSeconds) || 10;
  return [
    `创作方向：${String(brief.direction || '').slice(0, 500)}`,
    brief.keywords ? `关键词：${String(brief.keywords).slice(0, 500)}` : '',
    `成片时长：${Number(brief.totalSeconds) || 30} 秒`,
    `每镜时长：${per} 秒`,
    `镜头数量：${count} 个`,
    `画幅：${brief.size || '9:16'}`,
    brief.style ? `风格：${String(brief.style).slice(0, 300)}` : '',
    brief.characterDescription ? `人物设定：${String(brief.characterDescription).slice(0, 300)}` : '',
    `请输出 ${count} 个镜头的 JSON。`,
  ].filter(Boolean).join('\n');
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw fail('AI 没有返回可解析的分镜 JSON', 502);
  return parseJson(raw.slice(start, end + 1), null);
}

async function planWithLLM(brief) {
  const errors = [];
  for (const provider of PROVIDER_ORDER) {
    let selected;
    try {
      selected = canvasProvider(provider);
    } catch {
      continue; // provider 未启用
    }
    try {
      const out = await selected.target.generateText({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM },
          { role: 'user', content: plannerUserPrompt(brief) },
        ],
        temperature: 0.7,
      });
      const plan = extractJson(out?.content);
      if (!Array.isArray(plan?.shots) || !plan.shots.length) throw new Error('分镜为空');
      return { ...plan, provider };
    } catch (error) {
      errors.push(`${provider}: ${String(error.message || error).slice(0, 120)}`);
    }
  }
  throw fail(`所有 AI Provider 均未返回可用分镜（${errors.join('；') || '无可用 Provider'}）`, 502);
}

/** 无 LLM 时的兜底：按关键词与时长切分，保证流水线仍可运行 */
function planFallback(brief) {
  const count = shotCountFor(brief);
  const per = Number(brief.shotSeconds) || 10;
  const direction = String(brief.direction || '短片').slice(0, 120);
  const keywords = String(brief.keywords || '').split(/[,，、\s]+/).filter(Boolean).slice(0, 6);
  const beats = ['建立环境与人物出场', '核心动作展开', '情绪或细节特写', '收束与留白'];
  const shots = Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    label: `镜头 ${i + 1}`,
    duration: per,
    continuation: false,
    prompt: [
      `主题：${direction}。`,
      keywords.length ? `画面关键词：${keywords.join('、')}。` : '',
      `本镜头内容：${beats[i % beats.length]}。`,
      brief.characterDescription ? `人物：${brief.characterDescription}。` : '',
      '真实拍摄质感，自然光来源明确，真实手机或相机物理表现，中景为主，画面稳定无跳切。',
    ].filter(Boolean).join(''),
  }));
  return { title: direction.slice(0, 20), character: null, shots, provider: 'fallback' };
}

/* ------------------------------ Validator ------------------------------ */

function validatePlan(plan, brief) {
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  if (!shots.length) throw fail('分镜为空，无法开始生产');
  if (shots.length > MAX_SHOTS) throw fail(`镜头数量超过上限 ${MAX_SHOTS}`);

  const normalized = shots.map((shot, index) => {
    const duration = Number(shot.duration);
    if (!CFG.videoDurations.includes(duration)) {
      throw fail(`镜头 ${index + 1} 的时长 ${shot.duration} 不合法，只能是 ${CFG.videoDurations.join('/')} 秒`);
    }
    const prompt = String(shot.prompt || '').trim();
    if (prompt.length < 8) throw fail(`镜头 ${index + 1} 的提示词太短`);
    if (prompt.length > 1200) throw fail(`镜头 ${index + 1} 的提示词过长（上限 1200 字）`);
    const seconds = [...prompt.matchAll(/(\d+(?:\.\d+)?)\s*秒/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 5);
    const conflicting = [...new Set(seconds)].filter((n) => n !== duration);
    if (conflicting.length) {
      throw fail(`镜头 ${index + 1} 的提示词写了 ${conflicting.join('/')} 秒，与节点时长 ${duration} 秒冲突，容易被上游拒绝`);
    }
    return {
      index: index + 1,
      label: String(shot.label || `镜头 ${index + 1}`).slice(0, 40),
      duration,
      prompt,
      continuation: index > 0 && shot.continuation === true,
      chainGroup: 0,
    };
  });

  // 续集链分组：每 MAX_CHAIN 段断开一次，避免长链身份漂移
  let group = 0;
  normalized.forEach((shot, i) => {
    if (i === 0 || !shot.continuation) group += 1;
    else if (normalized[i - 1].chainGroup === group && countGroup(normalized, group) >= MAX_CHAIN) group += 1;
    shot.chainGroup = group;
  });

  const total = normalized.reduce((sum, shot) => sum + shot.duration, 0);
  const wanted = Number(brief.totalSeconds) || total;
  if (Math.abs(total - wanted) > Math.max(6, wanted * 0.25)) {
    throw fail(`分镜总时长 ${total} 秒与要求的 ${wanted} 秒差距过大`);
  }

  return {
    title: String(plan.title || brief.direction || '自动短片').slice(0, 40),
    character: plan.character && typeof plan.character === 'object'
      ? {
        name: String(plan.character.name || '').slice(0, 40),
        description: String(plan.character.description || '').slice(0, 300),
      }
      : null,
    provider: String(plan.provider || 'unknown'),
    shots: normalized,
    totalSeconds: total,
    estimatedCost: normalized.reduce(
      (sum, shot) => sum + priceOf('video', { duration: shot.duration, size: brief.size }),
      0,
    ),
  };
}

function countGroup(shots, group) {
  return shots.filter((shot) => shot.chainGroup === group).length;
}

/* --------------------------- Canvas builder --------------------------- */

function buildCanvasDoc(plan, brief) {
  const nodes = [];
  const edges = [];
  const size = CFG.sizes.includes(brief.size) ? brief.size : '9:16';
  const anchorRefs = Array.isArray(brief.characterRefs) ? brief.characterRefs.slice(0, 4) : [];

  let characterId = null;
  if (anchorRefs.length) {
    characterId = uid('n_');
    nodes.push({
      id: characterId,
      type: 'character',
      position: { x: 40, y: 60 },
      data: {
        label: plan.character?.name ? `人物·${plan.character.name}` : '人物锚点',
        description: plan.character?.description || brief.characterDescription || '',
        refs: anchorRefs,
      },
    });
  }

  const videoIds = plan.shots.map((shot, i) => {
    const id = uid('n_');
    nodes.push({
      id,
      type: 'video',
      position: { x: 320 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 260 },
      data: {
        label: shot.label,
        prompt: shot.prompt,
        duration: shot.duration,
        size,
        qualityControl: true,
        qualityThreshold: 75,
        qualityMaxRetries: 1,
        identityCheck: anchorRefs.length > 0,
      },
    });
    return id;
  });

  const storyboardId = uid('n_');
  nodes.push({
    id: storyboardId,
    type: 'storyboard',
    position: { x: 320, y: 60 + Math.ceil(plan.shots.length / 3) * 260 },
    data: { label: '成片' },
  });

  // 人物锚点只连每一条续集链的头节点，链内其他节点自动继承
  if (characterId) {
    plan.shots.forEach((shot, i) => {
      if (shot.continuation) return;
      edges.push({
        id: uid('e_'),
        source: characterId,
        sourceHandle: 'images',
        target: videoIds[i],
        targetHandle: 'ref',
      });
    });
  }

  plan.shots.forEach((shot, i) => {
    if (shot.continuation && i > 0) {
      edges.push({
        id: uid('e_'),
        source: videoIds[i - 1],
        sourceHandle: 'video',
        target: videoIds[i],
        targetHandle: 'continuation',
      });
    }
    edges.push({
      id: uid('e_'),
      source: videoIds[i],
      sourceHandle: 'video',
      target: storyboardId,
      targetHandle: 'clip',
      data: { order: i },
    });
  });

  return {
    doc: {
      version: 3,
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
    storyboardId,
  };
}

/* ----------------------------- Orchestration ----------------------------- */

function shapeProduction(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    brief: parseJson(row.brief_json, {}),
    plan: parseJson(row.plan_json, null),
    canvasId: row.canvas_id,
    runId: row.run_id,
    error: row.error,
    output: parseJson(row.output_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function patchProduction(id, patch) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  db.prepare(`UPDATE productions SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...fields.map((f) => patch[f]), now(), id);
}

async function internalPost(pathname, userId, body) {
  const token = signToken({ id: userId, role: 'admin' });
  const res = await fetch(`http://127.0.0.1:${CFG.port}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  const data = parseJson(text, { error: text.slice(0, 300) });
  if (!res.ok) throw fail(data?.error || `内部请求失败 HTTP ${res.status}`, res.status);
  return data;
}

export async function planProduction(brief) {
  if (!String(brief.direction || '').trim()) throw fail('请填写创作方向');
  let plan;
  try {
    plan = validatePlan(await planWithLLM(brief), brief);
  } catch (error) {
    if (error.status && error.status !== 502) throw error;
    plan = validatePlan(planFallback(brief), brief);
  }
  const { doc, storyboardId } = buildCanvasDoc(plan, brief);
  return { plan, doc, storyboardId };
}

export async function createProduction(userId, brief) {
  const id = uid('pr_');
  const ts = now();
  db.prepare(
    `INSERT INTO productions(id, user_id, brief_json, status, stage, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(id, userId, JSON.stringify(brief), 'planning', '规划分镜', ts, ts);

  try {
    const { plan, doc, storyboardId } = await planProduction(brief);
    patchProduction(id, { plan_json: JSON.stringify(plan), status: 'running', stage: '排队生成' });

    const canvasId = uid('cv_');
    db.prepare(
      'INSERT INTO canvases(id, user_id, name, doc_json, rev, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    ).run(canvasId, userId, `自动导演 · ${plan.title}`, JSON.stringify(doc), 1, now(), now());

    const out = await internalPost(`/api/canvases/${canvasId}/runs`, userId, {});
    const runId = out?.run?.id || null;
    patchProduction(id, { canvas_id: canvasId, run_id: runId, stage: '生成中' });
    return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
  } catch (error) {
    patchProduction(id, {
      status: 'failed',
      stage: '失败',
      error: String(error.message || error).slice(0, 500),
      finished_at: now(),
    });
    throw error;
  }
}

export async function advanceProduction(id) {
  if (running.has(id)) return null;
  const row = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
  if (!row || !ACTIVE.has(row.status)) return shapeProduction(row);

  if (now() - row.created_at > STALE_MS) {
    patchProduction(id, { status: 'failed', stage: '超时', error: '生产超时（90 分钟）', finished_at: now() });
    return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
  }
  if (!row.run_id) return shapeProduction(row);

  running.add(id);
  try {
    const run = db.prepare('SELECT * FROM canvas_runs WHERE id = ?').get(row.run_id);
    if (!run) return shapeProduction(row);

    if (run.status === 'failed' && row.status !== 'assembling') {
      patchProduction(id, { status: 'failed', stage: '生成失败', error: run.error || '画布执行失败', finished_at: now() });
    } else if (run.status === 'completed') {
      if (row.status !== 'assembling') {
        patchProduction(id, { status: 'assembling', stage: '合成成片' });
        return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
      }
      const plan = parseJson(row.plan_json, {});
      const storyboardId = findStoryboardId(row.canvas_id);
      if (!storyboardId) throw fail('画布中找不到分镜板节点', 500);
      const exported = await internalPost(
        `/api/canvases/${row.canvas_id}/storyboards/${storyboardId}/export`, row.user_id, {},
      );
      patchProduction(id, {
        status: 'completed',
        stage: '完成',
        output_json: JSON.stringify({
          url: exported?.export?.url,
          filename: exported?.export?.filename,
          bytes: exported?.export?.bytes,
          totalSeconds: plan.totalSeconds || null,
          shotCount: plan.shots?.length || 0,
        }),
        finished_at: now(),
      });
    }
    return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
  } catch (error) {
    patchProduction(id, {
      status: 'failed', stage: '合成失败', error: String(error.message || error).slice(0, 500), finished_at: now(),
    });
    return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
  } finally {
    running.delete(id);
  }
}

function findStoryboardId(canvasId) {
  const row = db.prepare('SELECT doc_json FROM canvases WHERE id = ?').get(canvasId);
  if (!row) return null;
  const doc = parseJson(row.doc_json, { nodes: [] });
  return (doc.nodes || []).find((node) => node.type === 'storyboard')?.id || null;
}

export function listProductions(userId, limit = 20) {
  return db.prepare('SELECT * FROM productions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)
    .map(shapeProduction);
}

export function getProduction(userId, id) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw fail('生产任务不存在', 404);
  return shapeProduction(row);
}

let schedulerTimer = null;

export function startDirectorScheduler() {
  if (schedulerTimer) return schedulerTimer;
  const tick = async () => {
    const rows = db.prepare("SELECT id FROM productions WHERE status IN ('planning','running','assembling') ORDER BY created_at LIMIT 20").all();
    for (const row of rows) {
      try {
        await advanceProduction(row.id);
      } catch (error) {
        console.error('[director] 推进失败:', error.message);
      }
    }
  };
  schedulerTimer = setInterval(() => { tick().catch((error) => console.error('[director] 调度异常:', error.message)); }, 5000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}
