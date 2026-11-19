/**
 * 自动导演（Auto Director）v3
 *
 * Brief → Planner（LLM JSON Mode / 规则兜底 / 用户确认并编辑后的分镜）
 * → Validator → 自动建画布（支持首帧关键帧并行管线 Keyframe-First / 续集链 / 标准并行）
 * → 画布执行器 → 风格感知质检与反馈改词重试 → 配音合成(TTS) + 字幕烧录 + 分镜板导出成片。
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { db, uid, now, getSetting } from './db.js';
import { canvasProvider } from './canvasAI.js';
import { getStylePreset, styleBaseline, composeStylePrompt } from './styles.js';
import {
  getStoryStructure, getShotRecipe, getCharacterCard,
  storyBaseline, shotBaseline, characterBaseline,
} from './presets.js';
import {
  startCanvasRunForUser,
  exportStoryboardForUser,
  cancelCanvasRunForUser,
  retryFailedCanvasNodesForUser,
} from './routes/canvases.js';
import { synthesizeNarrationToFile, VOICE_PRESETS } from './tts.js';
import { sanitizeVideoPrompt } from './videoProvider.js';

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

只输出一个合法 JSON 对象，不要 Markdown 代码块，不要任何额外解释文字。

JSON 结构：
{
  "title": "不超过 20 字的成片标题",
  "character": { "name": "人物代号", "description": "一句话外观：年龄感、发型、服装、气质" },
  "shots": [
    {
      "index": 1,
      "label": "镜头 1 · 节拍名",
      "duration": 10,
      "continuation": false,
      "keyframePrompt": "本镜头第 0 秒定格首帧画面描述：人物姿态、场景空间、机位景别、光线色调（纯静态画面，不含时间推移）",
      "narration": "本镜头配套的自然中文旁白或口播台词（10-28字，贴合画面情绪与时长；纯空镜可留空字符串）",
      "prompt": "可直接用于视频模型的完整中文提示词：人物、场景、光线来源、机位、景别、逐段动作节奏"
    }
  ]
}

硬性规则：
1. duration 只能是 5、6、8、10 之一；所有镜头时长之和应等于用户要求的成片时长（允许 ±10%）。
2. 每个 prompt 只描述本镜头，不要把多个镜头写进同一段，严禁出现 @[Image 1] 或 @图1 符号。
3. prompt 里绝对不要出现任何具体秒数数字（例如不要写“5秒”“10.00秒”“0-3秒”），节奏用“起初、随后、最后”表达，避免与节点时长冲突。
4. 若用户未上传参考图，人物外观在每段 prompt 与 keyframePrompt 里都要重复写清楚；若提示说明“已上传人物参考图”，则写“保持参考图中的人物面容、发型与穿搭造型”，不要自行编造可能冲突的新衣服颜色款式。
5. 第一个镜头 continuation 必须为 false；仅在用户要求续集连续且相邻镜头同一时空接续时才设为 true。
6. 一段镜头内最多安排 2–3 个自然连贯动作，不塞入无法完成的复杂表演。
7. prompt 只写实拍画面与动作，不写转场、字幕、花字或后期包装。`;

function shotCountFor(brief) {
  const total = Number(brief.totalSeconds) || 30;
  const per = Number(brief.shotSeconds) || 10;
  return Math.min(MAX_SHOTS, Math.max(1, Math.round(total / per)));
}

function effectivePipelineMode(brief) {
  if (['keyframe', 'chain', 'standard'].includes(brief.pipelineMode)) return brief.pipelineMode;
  return brief.chain ? 'chain' : 'standard';
}

function plannerUserPrompt(brief) {
  const count = shotCountFor(brief);
  const per = Number(brief.shotSeconds) || 10;
  const mode = effectivePipelineMode(brief);
  const hasRefPhotos = Array.isArray(brief.characterRefs) && brief.characterRefs.length > 0;
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
  const characterLine = hasRefPhotos
    ? `已上传 ${brief.characterRefs.length} 张真实人物参考图作为最高优先级身份锚点：各镜头人物面容、发型与服装必须保持参考图一致，请勿编造冲突服装描述${brief.characterDescription ? `（补充特征：${String(brief.characterDescription).slice(0, 200)}）` : ''}。`
    : (characterBaseline(card) || (brief.characterDescription
      ? `人物设定（每个镜头都要原样复述）：${String(brief.characterDescription).slice(0, 300)}`
      : ''));

  return [
    `创作方向：${String(brief.direction || '').slice(0, 500)}`,
    brief.keywords ? `关键词：${String(brief.keywords).slice(0, 500)}` : '',
    `成片时长：${Number(brief.totalSeconds) || 30} 秒`,
    `每镜时长：${per} 秒`,
    `镜头数量：${count} 个`,
    `画幅：${brief.size || '9:16'}`,
    `管线模式：${mode === 'keyframe' ? '首帧关键帧并行模式（请认真填写每个镜头的 keyframePrompt 静态首帧描述，continuation 全部设为 false）' : mode === 'chain' ? '连续续集链模式（相邻连续镜头可将 continuation 设为 true）' : '独立镜头并行模式（continuation 设为 false）'}`,
    brief.voiceoverEnabled || brief.subtitlesEnabled
      ? '旁白与字幕已开启：请为每个镜头撰写自然、有感染力、与镜头时长匹配的中文旁白 narration（12-26字）。'
      : '请同时为每个镜头附带一句简短可选旁白 narration，方便用户按需开启字幕或配音。',
    styleLine,
    styleAvoid,
    storyLine,
    shotLine,
    characterLine,
    `请严格输出包含 ${count} 个镜头的 JSON 对象。`,
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
          temperature: 0.68,
          jsonMode: true,
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
  const hasRefPhotos = Array.isArray(brief.characterRefs) && brief.characterRefs.length > 0;
  const preset = getStylePreset(brief.styleId);
  const styleDesc = preset ? composeStylePrompt(preset) : (brief.style || '真实拍摄质感，自然光来源明确');
  const beats = ['建立环境与人物出场', '核心动作自然展开', '情绪与细节近景特写', '氛围收束与画面留白'];
  const shots = Array.from({ length: count }, (_, i) => {
    const charLine = hasRefPhotos
      ? '保持参考图中的人物面容、发型与穿搭一致。'
      : (brief.characterDescription ? `人物：${brief.characterDescription}。` : '');
    const prompt = [
      `主题：${direction}。`,
      keywords.length ? `画面元素：${keywords.join('、')}。` : '',
      `本镜头重点：${beats[i % beats.length]}。`,
      charLine,
      `${styleDesc}，画面稳定连贯无跳切。`,
    ].filter(Boolean).join('');
    return {
      index: i + 1,
      label: `镜头 ${i + 1}`,
      duration: per,
      continuation: false,
      keyframePrompt: prompt,
      narration: i === 0 ? direction.slice(0, 24) : '',
      prompt,
    };
  });
  return { title: direction.slice(0, 20), character: null, shots, provider: 'fallback' };
}

/* ------------------------------ Validator ------------------------------ */

function countGroup(shots, group) {
  return shots.filter((shot) => shot.chainGroup === group).length;
}

export function validatePlan(plan, brief = {}) {
  if (!plan || typeof plan !== 'object') throw fail('分镜结构无效');
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  if (!shots.length) throw fail('分镜为空，无法开始生产');
  if (shots.length > MAX_SHOTS) throw fail(`镜头数量超过上限 ${MAX_SHOTS}`);
  const mode = effectivePipelineMode(brief);

  const normalized = shots.map((shot, index) => {
    const duration = Number(shot.duration);
    if (!CFG.videoDurations.includes(duration)) {
      throw fail(`镜头 ${index + 1} 的时长 ${shot.duration} 不合法，只能是 ${CFG.videoDurations.join('/')} 秒`);
    }
    // 自动清理提示词中与节点时长冲突的秒数表述，避免直接报错打断用户流程
    let prompt = sanitizeVideoPrompt(String(shot.prompt || '').trim());
    prompt = prompt.replace(/严格\s*\d+(?:\.\d+)?\s*秒[｜|，,。;\s]*/g, '');
    prompt = prompt.replace(/(\d+(?:\.\d+)?)\s*秒/g, (match, num) => (Number(num) === duration ? match : '本段'));

    if (prompt.length < 8) throw fail(`镜头 ${index + 1} 的提示词太短`);
    if (prompt.length > 1400) prompt = prompt.slice(0, 1400);

    const keyframePrompt = sanitizeVideoPrompt(String(shot.keyframePrompt || prompt).trim()).slice(0, 1000);
    const narration = String(shot.narration || '').replace(/\r?\n+/g, ' ').trim().slice(0, 120);
    const allowChain = mode === 'chain';

    return {
      index: index + 1,
      label: String(shot.label || `镜头 ${index + 1}`).slice(0, 40),
      duration,
      prompt,
      keyframePrompt,
      narration,
      continuation: allowChain && index > 0 && shot.continuation !== false,
      chainGroup: 0,
    };
  });

  let group = 0;
  normalized.forEach((shot, i) => {
    if (i === 0 || !shot.continuation) group += 1;
    else if (normalized[i - 1].chainGroup === group && countGroup(normalized, group) >= MAX_CHAIN) {
      shot.continuation = false;
      group += 1;
    }
    shot.chainGroup = group;
  });

  const total = normalized.reduce((sum, shot) => sum + shot.duration, 0);

  return {
    title: String(plan.title || brief.direction || '自动短片').slice(0, 40),
    character: plan.character && typeof plan.character === 'object'
      ? {
        name: String(plan.character.name || '').slice(0, 40),
        description: String(plan.character.description || '').slice(0, 300),
      }
      : null,
    provider: String(plan.provider || brief.provider || 'custom'),
    pipelineMode: mode,
    styleId: String(brief.styleId || plan.styleId || ''),
    storyId: String(brief.storyId || plan.storyId || ''),
    shotId: String(brief.shotId || plan.shotId || ''),
    characterId: String(brief.characterId || plan.characterId || ''),
    totalSeconds: total,
    shots: normalized,
  };
}

function resolveImageProviderForKeyframes(preferredProvider) {
  const order = [preferredProvider, 'chatgpt2api', 'antigravity', 'gemini'].filter(Boolean);
  for (const id of [...new Set(order)]) {
    try {
      canvasProvider(id);
      return id;
    } catch { /* try next */ }
  }
  return null;
}

function buildCanvasDoc(plan, brief) {
  const nodes = [];
  const edges = [];
  const size = CFG.sizes.includes(brief.size) ? brief.size : '9:16';
  const anchorRefs = Array.isArray(brief.characterRefs) ? brief.characterRefs.slice(0, 4) : [];
  const mode = effectivePipelineMode(brief);
  const preset = getStylePreset(brief.styleId);
  const styleSuffix = preset ? `视觉风格要求：${composeStylePrompt(preset)}。` : (brief.style ? `风格：${brief.style}。` : '');
  const kfProvider = mode === 'keyframe' ? resolveImageProviderForKeyframes(brief.provider) : null;
  const useKeyframes = mode === 'keyframe' && Boolean(kfProvider);

  let characterId = null;
  const refImageNodeIds = [];

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
    if (useKeyframes) {
      anchorRefs.forEach((url, idx) => {
        const imgNodeId = uid('n_');
        refImageNodeIds.push(imgNodeId);
        nodes.push({
          id: imgNodeId,
          type: 'image',
          position: { x: 40, y: 280 + idx * 170 },
          data: { label: `人物参考 #${idx + 1}`, url },
        });
      });
    }
  }

  const keyframeIds = [];
  if (useKeyframes) {
    plan.shots.forEach((shot, i) => {
      const kfId = uid('n_');
      keyframeIds.push(kfId);
      const kfPrompt = [
        anchorRefs.length
          ? '严格保持参考图人物的五官脸型、发型与穿搭造型一致，生成本镜头的高清实拍起始首帧定格画面。'
          : (plan.character?.description ? `人物外观：${plan.character.description}。` : ''),
        shot.keyframePrompt || shot.prompt,
        styleSuffix,
      ].filter(Boolean).join('\n');

      nodes.push({
        id: kfId,
        type: 'geminiImage',
        position: { x: 340 + (i % 3) * 320, y: 40 + Math.floor(i / 3) * 460 },
        data: {
          label: `首帧 · ${shot.label}`,
          prompt: kfPrompt,
          size,
          resolution: '1K',
          provider: kfProvider,
        },
      });

      for (const refNodeId of refImageNodeIds) {
        edges.push({
          id: uid('e_'),
          source: refNodeId,
          sourceHandle: 'image',
          target: kfId,
          targetHandle: 'ref',
        });
      }
    });
  }

  const videoIds = plan.shots.map((shot, i) => {
    const id = uid('n_');
    const yBase = useKeyframes
      ? 250 + Math.floor(i / 3) * 460
      : 60 + Math.floor(i / 3) * 260;
    nodes.push({
      id,
      type: 'video',
      position: { x: 340 + (i % 3) * 320, y: yBase },
      data: {
        label: shot.label,
        prompt: shot.prompt,
        subtitle: brief.subtitlesEnabled ? (shot.narration || '') : '',
        duration: shot.duration,
        size,
        qualityControl: true,
        qualityThreshold: 75,
        qualityMaxRetries: 1,
        identityCheck: anchorRefs.length > 0,
        aiProvider: brief.provider || null,
        styleId: brief.styleId || '',
        shotId: brief.shotId || '',
        keyframePriority: useKeyframes,
      },
    });
    return id;
  });

  const storyboardId = uid('n_');
  const rowsCount = Math.ceil(plan.shots.length / 3);
  nodes.push({
    id: storyboardId,
    type: 'storyboard',
    position: { x: 340, y: 80 + rowsCount * (useKeyframes ? 460 : 260) },
    data: {
      label: '成片合成',
      outputSize: size,
      bgmUrl: brief.bgmUrl || '',
      bgmVolume: Number.isFinite(Number(brief.bgmVolume)) ? Number(brief.bgmVolume) : 0.22,
      burnSubtitles: Boolean(brief.subtitlesEnabled || brief.voiceoverEnabled),
    },
  });

  if (useKeyframes) {
    plan.shots.forEach((_, i) => {
      edges.push({
        id: uid('e_'),
        source: keyframeIds[i],
        sourceHandle: 'image',
        target: videoIds[i],
        targetHandle: 'ref',
      });
    });
  }

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
    if (!useKeyframes && shot.continuation && i > 0) {
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
      data: {
        order: i,
        transition: brief.transition === 'fade' ? 'fade' : 'cut',
        transitionDuration: 0.35,
        subtitle: shot.narration || '',
      },
    });
  });

  return {
    doc: {
      version: 3,
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 0.78 },
    },
    storyboardId,
  };
}

/* ----------------------------- Orchestration ----------------------------- */

function buildShotRuntime(row, plan) {
  if (!row?.run_id || !row?.canvas_id) return [];
  const canvasRow = db.prepare('SELECT doc_json FROM canvases WHERE id = ?').get(row.canvas_id);
  if (!canvasRow) return [];
  const doc = parseJson(canvasRow.doc_json, { nodes: [] });
  const nodeRuns = db.prepare('SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at').all(row.run_id);
  const byNodeId = new Map(nodeRuns.map((nr) => [nr.node_id, nr]));
  const videoNodes = (doc.nodes || []).filter((n) => n.type === 'video');
  const kfNodes = (doc.nodes || []).filter((n) => n.type === 'geminiImage');

  return videoNodes.map((vNode, idx) => {
    const nr = byNodeId.get(vNode.id);
    const job = nr?.job_id ? db.prepare('SELECT progress, media_file, error, status FROM jobs WHERE id = ?').get(nr.job_id) : null;
    const out = parseJson(nr?.output_json, {});
    const kfNode = kfNodes[idx];
    const kfRun = kfNode ? byNodeId.get(kfNode.id) : null;
    const kfOut = parseJson(kfRun?.output_json, {});
    return {
      index: idx + 1,
      nodeId: vNode.id,
      label: vNode.data?.label || plan?.shots?.[idx]?.label || `镜头 ${idx + 1}`,
      narration: plan?.shots?.[idx]?.narration || vNode.data?.subtitle || '',
      status: nr?.status || 'queued',
      progress: job?.progress || (nr?.status === 'completed' ? 100 : 0),
      keyframeStatus: kfRun?.status || null,
      keyframeUrl: kfOut?.mediaUrl || null,
      mediaUrl: out?.mediaUrl || (job?.media_file ? `/media/${job.media_file}` : null),
      qualityScore: out?.quality?.score ?? null,
      error: nr?.error || job?.error || null,
    };
  });
}

function shapeProduction(row) {
  if (!row) return null;
  const plan = parseJson(row.plan_json, null);
  return {
    id: row.id,
    batchId: row.batch_id || null,
    status: row.status,
    stage: row.stage,
    brief: parseJson(row.brief_json, {}),
    plan,
    shotStates: buildShotRuntime(row, plan),
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

/** 真正开始一条生产：支持复用用户已确认的分镜 plan，无需二次盲调 LLM */
export async function beginProduction(id) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
  if (!row) throw fail('生产任务不存在', 404);
  const brief = parseJson(row.brief_json, {});
  const preplanned = parseJson(row.plan_json, null);

  patchProduction(id, { status: 'planning', stage: preplanned ? '校验分镜' : '规划分镜' });
  try {
    let plan;
    let doc;
    if (preplanned && Array.isArray(preplanned.shots) && preplanned.shots.length) {
      plan = validatePlan(preplanned, brief);
      doc = buildCanvasDoc(plan, brief).doc;
    } else {
      const planned = await planProduction(brief);
      plan = planned.plan;
      doc = planned.doc;
    }

    patchProduction(id, { plan_json: JSON.stringify(plan), status: 'running', stage: '提交工作流' });

    const canvasId = uid('cv_');
    db.prepare(
      'INSERT INTO canvases(id, user_id, name, doc_json, rev, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    ).run(canvasId, row.user_id, `自动导演 · ${plan.title}`, JSON.stringify(doc), 1, now(), now());

    const run = await startCanvasRunForUser(canvasId, row.user_id, {});
    patchProduction(id, {
      canvas_id: canvasId,
      run_id: run?.id || null,
      stage: plan.pipelineMode === 'keyframe' ? '并行生成首帧与视频' : '生成分镜视频中',
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

/** 单条生产：若前端传入已确认/编辑的 plan，原样锁死投产 */
export async function createProduction(userId, brief, customPlan = null) {
  const id = uid('pr_');
  const ts = now();
  const validatedCustom = customPlan && Array.isArray(customPlan.shots) && customPlan.shots.length
    ? validatePlan(customPlan, brief)
    : null;
  db.prepare(
    `INSERT INTO productions(id, user_id, brief_json, plan_json, status, stage, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    userId,
    JSON.stringify(brief),
    validatedCustom ? JSON.stringify(validatedCustom) : null,
    'planning',
    validatedCustom ? '按确认分镜启动' : '规划分镜',
    ts,
    ts,
  );
  await beginProduction(id);
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
      'SELECT * FROM productions WHERE batch_id = ? ORDER BY created_at',
    ).all(batchId).map(shapeProduction),
  };
}

function directorConcurrency() {
  return Math.max(1, Math.min(3, Number(getSetting('directorConcurrency')) || 1));
}

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
  const ttsDir = path.join(CFG.dataDir, 'tmp', `tts-${id}`);
  try {
    const run = db.prepare('SELECT * FROM canvas_runs WHERE id = ?').get(row.run_id);
    if (!run) return shapeProduction(row);

    if (['failed', 'completed_with_errors'].includes(run.status) && row.status !== 'assembling') {
      const failedNode = db.prepare("SELECT error FROM node_runs WHERE run_id = ? AND status = 'failed' LIMIT 1").get(row.run_id);
      patchProduction(id, {
        status: 'failed',
        stage: run.status === 'completed_with_errors' ? '部分镜头失败' : '生成失败',
        error: failedNode?.error || run.error || '画布执行存在失败节点，可点击“仅重跑失败镜头”继续',
        finished_at: now(),
      });
    } else if (run.status === 'completed') {
      const plan = parseJson(row.plan_json, {});
      const brief = parseJson(row.brief_json, {});
      patchProduction(id, {
        status: 'assembling',
        stage: brief.voiceoverEnabled ? '合成旁白配音与字幕成片' : '合成成片中',
      });

      const storyboardId = findStoryboardId(row.canvas_id);
      if (!storyboardId) throw fail('画布中找不到分镜板节点', 500);

      const narrationFilesByOrder = {};
      const subtitlesByOrder = {};
      const shots = Array.isArray(plan.shots) ? plan.shots : [];
      let voicedCount = 0;

      if (brief.voiceoverEnabled || brief.subtitlesEnabled) {
        fs.mkdirSync(ttsDir, { recursive: true });
        for (let i = 0; i < shots.length; i += 1) {
          const line = String(shots[i]?.narration || '').trim();
          if (!line) continue;
          if (brief.subtitlesEnabled || brief.voiceoverEnabled) {
            subtitlesByOrder[i] = line;
          }
          if (brief.voiceoverEnabled) {
            try {
              const mp3Path = path.join(ttsDir, `shot-${i}.mp3`);
              const ttsOut = await synthesizeNarrationToFile(line, mp3Path, { voiceId: brief.voiceId || 'xiaoxiao' });
              if (ttsOut?.file) {
                narrationFilesByOrder[i] = ttsOut.file;
                voicedCount += 1;
              }
            } catch (ttsErr) {
              console.warn(`[director] 镜头 ${i + 1} 配音合成跳过:`, ttsErr.message);
            }
          }
        }
      }

      const exported = await exportStoryboardForUser(row.canvas_id, storyboardId, row.user_id, {
        outputSize: brief.size || 'source',
        defaultTransition: brief.transition === 'fade' ? 'fade' : 'cut',
        narrationFilesByOrder,
        subtitlesByOrder,
        burnSubtitles: Boolean(brief.subtitlesEnabled || brief.voiceoverEnabled),
        duckBgm: true,
      });
      const quality = summarizeQuality(row.run_id);
      patchProduction(id, {
        status: 'completed',
        stage: '完成',
        output_json: JSON.stringify({
          url: exported?.url,
          filename: exported?.filename,
          bytes: exported?.bytes,
          duration: exported?.duration || plan.totalSeconds || null,
          totalSeconds: Math.round(exported?.duration || plan.totalSeconds || 0),
          shotCount: shots.length,
          voicedCount,
          subtitled: Object.keys(subtitlesByOrder).length > 0,
          pipelineMode: plan.pipelineMode || 'standard',
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
    try { fs.rmSync(ttsDir, { recursive: true, force: true }); } catch { /* ignore */ }
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

export function listProductions(userId, limit = 24) {
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

export function cancelProduction(userId, id) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw fail('生产任务不存在', 404);
  if (row.run_id) {
    try { cancelCanvasRunForUser(row.run_id, userId); } catch { /* ignore */ }
  }
  patchProduction(id, {
    status: 'failed',
    stage: '已取消',
    error: '用户手动取消生产，未完成节点积分已退还',
    finished_at: now(),
  });
  return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
}

export async function retryProduction(userId, id, { failedOnly = false } = {}) {
  const row = db.prepare('SELECT * FROM productions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw fail('生产任务不存在', 404);
  if (ACTIVE.has(row.status) || row.status === 'queued') throw fail('任务仍在进行中', 409);

  if (failedOnly && row.canvas_id) {
    const newRun = await retryFailedCanvasNodesForUser(row.canvas_id, userId);
    patchProduction(id, {
      status: 'running',
      stage: '重跑失败镜头中',
      error: null,
      run_id: newRun.id,
      finished_at: null,
    });
    return shapeProduction(db.prepare('SELECT * FROM productions WHERE id = ?').get(id));
  }

  // 保留已确认的 plan_json，避免整条重排时丢失用户微调过的分镜
  patchProduction(id, {
    status: 'queued',
    stage: '排队中',
    error: null,
    output_json: null,
    canvas_id: null,
    run_id: null,
    finished_at: null,
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
  schedulerTimer = setInterval(tick, 3000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}

export function listVoices() {
  return VOICE_PRESETS;
}

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
