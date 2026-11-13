/**
 * 自动导演（Auto Director）v2
 *
 * Brief → Planner（LLM / 规则兜底）→ Validator → 自动建画布 → 现有画布执行器
 * → 质检（失败时按反馈修复提示词后重试）→ 分镜板导出成片。
 *
 * v2 新增：
 * - 批量模式：一个 batch 内多条 brief 串行排队，避免同时打满上游并发；
 * - 排队状态 queued，由调度器按 directorConcurrency 逐个启动。
 */
import { CFG } from './config.js';
import { db, uid, now, priceOf, getSetting } from './db.js';
import { canvasProvider } from './canvasAI.js';
import { getStylePreset, styleBaseline } from './styles.js';
import {
  getStoryStructure, getShotRecipe, getCharacterCard,
  storyBaseline, shotBaseline, characterBaseline,
} from './presets.js';
import { signToken } from './auth.js';

const ACTIVE = new Set(['planning', 'running', 'assembling']);
const MAX_SHOTS = 8;
const MAX_CHAIN = 3;
const STALE_MS = 90 * 60 * 1000;
const PROVIDER_ORDER = ['antigravity', 'chatgpt2api', 'gemini'];

const running = new Set();

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : parsed;
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
  const preset = getStylePreset(brief.styleId);
  const styleLine = preset
    ? styleBaseline(preset)
    : (brief.style ? `风格：${String(brief.style).slice(0, 300)}` : '');
  const styleAvoid = preset && preset.negative ? `避免出现：${preset.negative}` : '';
  const story = getStoryStructure(brief.storyId);
  const recipe = getShotRecipe(brief.shotId);
  const card = getCharacterCard(brief.characterId);
  const storyLine = story ? storyBaseline(story, count) : '';
  const shotLine = recipe ? shotBaseline(recipe) : '';
  const characterLine = card ? characterBaseline(card) : '';
  return [
    `创作方向：${String(brief.direction || '').slice(0, 500)}`,
    brief.keywords ? `关键词：${String(brief.keywords).slice(0, 500)}` : '',
    `成片时长：${Number(brief.totalSeconds) || 30} 秒`,
    `每镜时长：${per} 秒`,
    `镜头数量：${count} 个`,
    `画幅：${brief.size || '9:16'}`,
    styleLine,
    styleAvoid,
    storyLine,
    shotLine,
    characterLine || (brief.characterDescription
      ? `人物设定（每个镜头都要原样复述）：${String(brief.characterDescription).slice(0, 300)}`
      : ''),
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
  const preferred = String(brief.provider || '').trim();
  const order = preferred
    ? [preferred, ...PROVIDER_ORDER.filter((id) => id !== preferred)]
    : PROVIDER_ORDER;
  for (const provider of order) {
    let selected;
    try {
      selected = canvasProvider(provider);
    } catch {
      continue;
    }
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const out = await selected.target.generateText({
          messages: [
            { role: 'system', content: PLANNER_SYSTEM },
            { role: 'user', content: plannerUserPrompt(brief) },
          ],
          temperature: 0.7,
        });
        const plan = extractJson(out?.content);
        if (!Array.isArray(plan?.shots) || !plan.shots.length) {
          throw new Error(`分镜为空（返回结构：${JSON.stringify(plan).slice(0, 300)}）`);
        }
        return { ...plan, provider };
      } catch (error) {
        lastError = error;
      }
    }
    errors.push(`${provider}: ${String(lastError?.message || lastError).slice(0, 120)}`);
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

function countGroup(shots, group) {
  return shots.filter((shot) => shot.chainGroup === group).length;
}

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
      .map((match, i) => Number(match[1]))
      .filter((value) => value >= 5);
    const conflicting = [...new Set(seconds)].filter((value) => value !== duration);
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
    styleId: String(brief.styleId || ''),
    storyId: String(brief.storyId || ''),
    shotId: String(brief.shotId || ''),
    characterId: String(brief.characterId || ''),
    shots: normalized,
    totalSeconds: total,
    estimatedCost: normalized.reduce(
      (sum, shot) => sum + priceOf('video', { duration: shot.duration, size: brief.size }),
      0,
    ),
  };
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
        aiProvider: brief.provider || null,
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
    batchId: row.batch_id || null,
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
    console.warn('[director] AI 规划失败，回退规则分镜:', String(error.message || error).slice(0, 600));
    plan = validatePlan(planFallback(brief), brief);
  }
  const { doc, storyboardId } = buildCanvasDoc(plan, brief);
  return { plan, doc, storyboardId };
}

/** 真正开始一条生产：规划 → 建画布 → 提交运行 */
export async function beginProduction(id) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
  if (!row) throw fail('生产任务不存在', 404);
  const brief = parseJson(row.brief_json, {});
  patchProduction(id, { status: 'planning', stage: '规划分镜' });
  try {
    const { plan, doc } = await planProduction(brief);
    patchProduction(id, { plan_json: JSON.stringify(plan), status: 'running', stage: '排队生成' });

    const canvasId = uid('cv_');
    db.prepare(
      'INSERT INTO canvases(id, user_id, name, doc_json, rev, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    ).run(canvasId, row.user_id, `自动导演 · ${plan.title}`, JSON.stringify(doc), 1, now(), now());

    const out = await internalPost(`/api/canvases/${canvasId}/runs`, row.user_id, {});
    patchProduction(id, {
      canvas_id: canvasId, run_id: out?.run?.id || null, stage: '生成中',
    });
  } catch (error) {
    patchProduction(id, {
      status: 'failed',
      stage: '失败',
      error: String(error.message || error).slice(0, 500),
      finished_at: now(),
    });
    throw error;
  }
  return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
}

/** 单条生产：立即开始（保留原有行为） */
export async function createProduction(userId, brief) {
  const id = uid('pr_');
  const ts = now();
  db.prepare(
    `INSERT INTO productions(id, user_id, brief_json, status, stage, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(id, userId, JSON.stringify(brief), 'planning', '规划分镜', ts, ts);
  try {
    await beginProduction(id);
  } catch (error) {
    throw error;
  }
  return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
}

/** 批量：同一 batch 下按顺序排队，由调度器逐条启动 */
export function enqueueBatch(userId, briefs, { name = '' } = {}) {
  if (!Array.isArray(briefs) || !briefs.length) throw fail('批量模式至少需要一条创作方向');
  if (briefs.length > 20) throw fail('单次批量最多 20 条');
  const batchId = uid('bt_');
  const ts = now();
  const ids = [];
  for (const brief of briefs) {
    if (!String(brief.direction || '').trim()) continue;
    const id = uid('pr_');
    db.prepare(
      `INSERT INTO productions(id, user_id, batch_id, brief_json, status, stage, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run(id, userId, batchId, JSON.stringify(brief), 'queued', '排队中', ts, ts);
    ids.push(id);
  }
  if (!ids.length) throw fail('批量内容里没有有效的创作方向');
  return {
    batchId,
    name: String(name || '').slice(0, 60) || `批量 · ${ids.length} 条`,
    count: ids.length,
    productions: db.prepare(
      `SELECT * FROM productions WHERE batch_id = ? ORDER BY created_at`,
    ).all(batchId).map(shapeProduction),
  };
}

function directorConcurrency() {
  return Math.max(1, Math.min(3, Number(getSetting('directorConcurrency')) || 1));
}

/** 调度：先按并发上限启动排队任务，再推进进行中的任务 */
export async function tickDirector() {
  const limit = directorConcurrency();
  const active = db.prepare(
    "SELECT COUNT(*) n FROM productions WHERE status IN ('planning','running','assembling')",
  ).get().n;
  const slots = Math.max(0, limit - active);
  if (slots > 0) {
    const next = db.prepare(
      "SELECT id FROM productions WHERE status = 'queued' ORDER BY created_at LIMIT ?",
    ).all(slots);
    for (const row of next) {
      try {
        await beginProduction(row.id);
      } catch (error) {
        console.error('[director] 启动失败:', row.id, error.message);
      }
    }
  }

  const runningRows = db.prepare(
    "SELECT id FROM productions WHERE status IN ('planning','running','assembling') ORDER BY created_at LIMIT 20",
  ).all();
  for (const row of runningRows) {
    try {
      await advanceProduction(row.id);
    } catch (error) {
      console.error('[director] 推进失败:', error.message);
    }
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
      const quality = summarizeQuality(row.run_id);
      patchProduction(id, {
        status: 'completed',
        stage: '完成',
        output_json: JSON.stringify({
          url: exported?.export?.url,
          filename: exported?.export?.filename,
          bytes: exported?.export?.bytes,
          totalSeconds: plan.totalSeconds || null,
          shotCount: plan.shots?.length || 0,
          quality,
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

function summarizeQuality(runId) {
  const rows = db.prepare('SELECT output_json, status FROM node_runs WHERE run_id = ?').all(runId);
  let checked = 0;
  let passed = 0;
  let retried = 0;
  let minScore = null;
  for (const row of rows) {
    const output = parseJson(row.output_json, {});
    const report = output.quality;
    if (!report) continue;
    checked += 1;
    if (report.passed) passed += 1;
    retried += Math.max(0, (output.qualityHistory?.length || 1) - 1);
    const score = Number(report.score);
    if (Number.isFinite(score)) minScore = minScore === null ? score : Math.min(minScore, score);
  }
  return { checked, passed, retried, minScore };
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

export function listBatches(userId, limit = 10) {
  const rows = db.prepare(
    `SELECT batch_id, COUNT(*) total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) done,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
            MIN(created_at) created_at
     FROM productions
     WHERE user_id = ? AND batch_id IS NOT NULL
     GROUP BY batch_id ORDER BY created_at DESC LIMIT ?`,
  ).all(userId, limit);
  return rows.map((row) => ({
    batchId: row.batch_id,
    total: row.total,
    done: row.done,
    failed: row.failed,
    createdAt: row.created_at,
    productions: db.prepare(
      'SELECT * FROM productions WHERE batch_id = ? ORDER BY created_at',
    ).all(row.batch_id).map(shapeProduction),
  }));
}

export function getProduction(userId, id) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw fail('生产任务不存在', 404);
  return shapeProduction(row);
}

export async function retryProduction(userId, id) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw fail('生产任务不存在', 404);
  if (ACTIVE.has(row.status) || row.status === 'queued') throw fail('任务仍在进行中', 409);
  patchProduction(id, {
    status: 'queued', stage: '排队中', error: null, output_json: null,
    canvas_id: null, run_id: null, finished_at: null,
  });
  return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
}

let schedulerTimer = null;

export function startDirectorScheduler() {
  if (schedulerTimer) return schedulerTimer;
  const tick = async () => {
    try {
      await tickDirector();
    } catch (error) {
      console.error('[director] 调度异常:', error.message);
    }
  };
  schedulerTimer = setInterval(tick, 5000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}

/** 可用的提示词 AI（供前端下拉选择） */
export function listProviders() {
  const labels = { chatgpt2api: 'ChatGPT2API', antigravity: 'Antigravity', gemini: 'Gemini 官方' };
  const out = [];
  for (const id of ['chatgpt2api', 'antigravity', 'gemini']) {
    try {
      const selected = canvasProvider(id);
      out.push({
        id,
        label: labels[id] || id,
        textModel: getSetting(selected.textSetting) || null,
        imageModel: getSetting(selected.imageSetting) || null,
      });
    } catch { /* 未启用 */ }
  }
  return out;
}
