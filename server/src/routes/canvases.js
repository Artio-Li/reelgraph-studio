import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { CFG, MEDIA_DIR } from '../config.js';
import {
  db, uid, now, createJob, getJob, updateJob, addCredits, priceOf,
} from '../db.js';
import * as muse from '../muse.js';
import { applyRealism, realismEnabled } from '../realism.js';
import { generateCanvasImage, generateCanvasPrompt } from '../canvasAI.js';
import { analyzeCanvasIdentity } from '../canvasAI.js';
import { analyzeVideoQuality, extractIdentityFrames } from '../canvasQuality.js';
import {
  buildContinuationInstruction, buildIdentityLockInstruction, continuationReferences, mergeVideoClips,
} from '../canvasMedia.js';

const r = Router();
const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 200;
const MAX_EDGES = 500;

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.heic': 'image/heic', '.avif': 'image/avif',
};

const ALLOWED_LINKS = new Set([
  'text:text>video:prompt',
  'image:image>video:ref',
  'geminiImage:image>video:ref',
  'character:images>video:ref',
  'image:image>character:image',
  'geminiImage:image>character:image',
  'text:text>geminiImage:prompt',
  'geminiPrompt:text>geminiImage:prompt',
  'geminiPrompt:text>video:prompt',
  'image:image>geminiImage:ref',
  'geminiImage:image>geminiImage:ref',
  'video:video>video:continuation',
  'video:video>storyboard:clip',
]);

const ACTIVE_RUN = new Set(['queued', 'submitting', 'waiting', 'processing']);
const EXECUTABLE_NODE_TYPES = new Set(['geminiPrompt', 'geminiImage', 'video']);
const advancingRuns = new Set();
let schedulerTimer = null;

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function defaultDoc() {
  return {
    version: 3,
    nodes: [{
      id: uid('n_'),
      type: 'text',
      position: { x: 180, y: 180 },
      data: { label: '镜头提示词', content: '在这里输入画面描述' },
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function cleanDoc(raw) {
  const doc = raw && typeof raw === 'object' ? raw : defaultDoc();
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const edges = Array.isArray(doc.edges) ? doc.edges : (Array.isArray(doc.links) ? doc.links : []);
  if (nodes.length > MAX_NODES) throw Object.assign(new Error(`画布节点不能超过 ${MAX_NODES} 个`), { status: 400 });
  if (edges.length > MAX_EDGES) throw Object.assign(new Error(`画布连线不能超过 ${MAX_EDGES} 条`), { status: 400 });
  const ids = new Set();
  for (const node of nodes) {
    if (!node?.id || !node?.type || ids.has(node.id)) {
      throw Object.assign(new Error('画布包含无效或重复节点'), { status: 400 });
    }
    ids.add(node.id);
  }
  for (const edge of edges) {
    if (!edge?.id || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw Object.assign(new Error('画布包含无效连线'), { status: 400 });
    }
  }
  const out = {
    version: 3,
    nodes,
    edges,
    viewport: doc.viewport && typeof doc.viewport === 'object'
      ? doc.viewport
      : { x: 0, y: 0, zoom: 1 },
  };
  const encoded = JSON.stringify(out);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_DOC_BYTES) {
    throw Object.assign(new Error('画布数据不能超过 2MB'), { status: 413 });
  }
  return out;
}

function shapeCanvas(row, withDoc = true) {
  return {
    id: row.id,
    name: row.name,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(withDoc ? { doc: parseJson(row.doc_json, defaultDoc()) } : {}),
  };
}

function ownCanvas(id, userId) {
  const row = db.prepare('SELECT * FROM canvases WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw Object.assign(new Error('画布不存在'), { status: 404 });
  return row;
}

function inputEdges(doc, nodeId, handle) {
  return doc.edges
    .filter((edge) => edge.target === nodeId && (!handle || edge.targetHandle === handle))
    .sort((a, b) => Number(a.data?.order || 0) - Number(b.data?.order || 0));
}

function validateGraph(doc) {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(doc.nodes.map((node) => [node.id, []]));
  const seen = new Set();
  const continuationTargets = new Set();
  for (const edge of doc.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const signature = `${source?.type}:${edge.sourceHandle}>${target?.type}:${edge.targetHandle}`;
    if (!ALLOWED_LINKS.has(signature)) {
      throw Object.assign(new Error(`不允许的连线：${signature}`), { status: 400 });
    }
    const duplicate = `${edge.source}:${edge.sourceHandle}:${edge.target}:${edge.targetHandle}`;
    if (seen.has(duplicate)) throw Object.assign(new Error('画布存在重复连线'), { status: 400 });
    seen.add(duplicate);
    if (edge.targetHandle === 'continuation') {
      if (continuationTargets.has(edge.target)) {
        throw Object.assign(new Error('每个视频节点只能接入一个“续集参考”视频'), { status: 400 });
      }
      continuationTargets.add(edge.target);
    }
    outgoing.get(edge.source).push(edge.target);
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = (id) => {
    if (visiting.has(id)) throw Object.assign(new Error('画布不能包含循环连线'), { status: 400 });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of outgoing.get(id) || []) walk(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) walk(id);
  return byId;
}

function ownedUpload(userId, url) {
  const value = String(url || '');
  const filename = path.basename(value);
  if (value.startsWith('/media/')) {
    const job = db.prepare(
      "SELECT * FROM jobs WHERE media_file = ? AND user_id = ? AND type = 'image' AND status = 'completed'"
    ).get(filename, userId);
    const file = path.join(MEDIA_DIR, filename);
    if (!job || !fs.existsSync(file)) {
      throw Object.assign(new Error('生成图片不存在或不属于当前用户'), { status: 400 });
    }
    return { filename, mime: MIME[path.extname(filename).toLowerCase()] || 'image/png', file, url: value };
  }
  if (!value.startsWith('/uploads/')) {
    throw Object.assign(new Error('画布参考图必须是当前账号上传或生成的图片'), { status: 400 });
  }
  const row = db.prepare('SELECT * FROM uploads WHERE filename = ? AND user_id = ?').get(filename, userId);
  if (!row || !row.mime?.startsWith('image/')) {
    throw Object.assign(new Error('参考图不存在、不属于当前用户或不是图片'), { status: 400 });
  }
  const file = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(file)) throw Object.assign(new Error('参考图文件已丢失'), { status: 400 });
  return { ...row, file, url: value };
}

function ownedAudio(userId, url) {
  const value = String(url || '');
  if (!value.startsWith('/uploads/')) {
    throw Object.assign(new Error('背景音乐必须是当前账号上传的音频'), { status: 400 });
  }
  const filename = path.basename(value);
  const row = db.prepare('SELECT * FROM uploads WHERE filename = ? AND user_id = ?').get(filename, userId);
  if (!row || !row.mime?.startsWith('audio/')) {
    throw Object.assign(new Error('背景音乐不存在、不属于当前用户或不是音频'), { status: 400 });
  }
  const file = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(file)) throw Object.assign(new Error('背景音乐文件已丢失'), { status: 400 });
  return { ...row, file, url: value };
}

function toReference(userId, url) {
  const upload = ownedUpload(userId, url);
  const ext = path.extname(upload.filename).toLowerCase();
  const mime = MIME[ext] || upload.mime || 'application/octet-stream';
  return { url: `data:${mime};base64,${fs.readFileSync(upload.file).toString('base64')}` };
}

function findCached(userId, canvasId, nodeId, inputHash) {
  const rows = db.prepare(
    `SELECT * FROM node_runs
     WHERE user_id = ? AND canvas_id = ? AND node_id = ? AND input_hash = ? AND status = 'completed'
     ORDER BY created_at DESC LIMIT 8`
  ).all(userId, canvasId, nodeId, inputHash);
  for (const row of rows) {
    const output = parseJson(row.output_json, null);
    if (row.node_type === 'geminiPrompt') {
      if (output?.content) return { row, job: null, output };
      continue;
    }
    if (!row.job_id) continue;
    const job = getJob(row.job_id);
    if (!job || job.status !== 'completed') continue;
    if (job.mediaFile && !fs.existsSync(path.join(MEDIA_DIR, job.mediaFile))) continue;
    if (!job.mediaUrl && !job.result?.url && !output?.mediaUrl) continue;
    return { row, job, output: output || { mediaUrl: job.mediaUrl || job.result?.url, jobId: job.id } };
  }
  return null;
}

function uniqueRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = ref.nodeId ? `node:${ref.nodeId}` : `url:${ref.url}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textRef(node) {
  return {
    nodeId: node.id,
    type: node.type,
    text: String(node.data?.content || '').trim(),
  };
}

function imageRef(node) {
  return {
    nodeId: node.id,
    type: node.type,
    url: node.data?.url || null,
  };
}

function executableDependencies(refs = []) {
  return [...new Set(refs
    .filter((ref) => EXECUTABLE_NODE_TYPES.has(ref.type))
    .map((ref) => ref.nodeId))];
}

function continuationComponentIds(doc, byId, startId) {
  const adjacent = new Map();
  for (const node of doc.nodes) {
    if (node.type === 'video') adjacent.set(node.id, new Set());
  }
  for (const edge of doc.edges) {
    if (edge.sourceHandle !== 'video' || edge.targetHandle !== 'continuation') continue;
    if (byId.get(edge.source)?.type !== 'video' || byId.get(edge.target)?.type !== 'video') continue;
    adjacent.get(edge.source)?.add(edge.target);
    adjacent.get(edge.target)?.add(edge.source);
  }
  const found = new Set();
  const pending = [startId];
  while (pending.length) {
    const id = pending.pop();
    if (found.has(id)) continue;
    found.add(id);
    for (const next of adjacent.get(id) || []) pending.push(next);
  }
  return found;
}

function characterImages(doc, byId, character) {
  const refs = [];
  for (const imageEdge of inputEdges(doc, character.id, 'image')) {
    const imageNode = byId.get(imageEdge.source);
    if (['image', 'geminiImage'].includes(imageNode?.type)) refs.push(imageRef(imageNode));
  }
  for (const url of character.data?.refs || []) refs.push({ nodeId: null, type: 'image', url });
  return uniqueRefs(refs.filter((ref) => ref.nodeId || ref.url));
}

function resolveIdentityAnchor(doc, byId, node) {
  const component = continuationComponentIds(doc, byId, node.id);
  const anchorEdges = doc.edges.filter((edge) => (
    edge.sourceHandle === 'images'
    && edge.targetHandle === 'ref'
    && component.has(edge.target)
    && byId.get(edge.source)?.type === 'character'
  ));
  const anchorIds = [...new Set(anchorEdges.map((edge) => edge.source))];
  if (anchorIds.length > 1) {
    throw Object.assign(new Error(`续集链「${node.data?.label || node.id}」接入了多个人物身份锚点；同一条续集链只能锁定一个人物`), { status: 400 });
  }
  if (!anchorIds.length) return null;
  const anchor = byId.get(anchorIds[0]);
  const images = characterImages(doc, byId, anchor);
  if (!images.length) {
    throw Object.assign(new Error(`人物身份锚点「${anchor.data?.label || anchor.id}」还没有接入参考图`), { status: 400 });
  }
  if (images.length > 4) {
    throw Object.assign(new Error(`人物身份锚点「${anchor.data?.label || anchor.id}」最多接入 4 张同一人物参考图`), { status: 400 });
  }
  const directlyConnected = anchorEdges.some((edge) => edge.source === anchor.id && edge.target === node.id);
  return {
    nodeId: anchor.id,
    label: String(anchor.data?.label || '人物身份锚点').trim().slice(0, 80),
    description: String(anchor.data?.description || '').trim().slice(0, 300),
    images,
    inherited: !directlyConnected,
  };
}

function hashInput(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function resolvePromptInput(node) {
  const input = {
    provider: node.data?.provider || 'gemini',
    model: node.data?.model || '',
    keywords: String(node.data?.keywords || '').trim(),
    template: String(node.data?.template || ''),
    purpose: String(node.data?.purpose || '视频提示词'),
    duration: Number(node.data?.duration) || 10,
    aspectRatio: node.data?.size || '9:16',
    style: String(node.data?.style || '写实真人质感，真实物理光学表现'),
    dependencies: [],
  };
  if (input.keywords.length < 2) {
    throw Object.assign(new Error(`AI 提示词节点「${node.data?.label || node.id}」缺少关键词或需求`), { status: 400 });
  }
  return { input, inputHash: hashInput(input), cost: 0 };
}

function resolveImageInput(doc, byId, node, userId) {
  const promptRefs = inputEdges(doc, node.id, 'prompt').map((edge) => textRef(byId.get(edge.source)));
  const inlinePrompt = String(node.data?.prompt || '').trim();
  const hasPromptSource = promptRefs.some((ref) => ref.text || ref.type === 'geminiPrompt');
  if (!hasPromptSource && inlinePrompt.length < 2) {
    throw Object.assign(new Error(`AI 图片节点「${node.data?.label || node.id}」缺少提示词`), { status: 400 });
  }
  const referenceRefs = uniqueRefs(inputEdges(doc, node.id, 'ref').map((edge) => imageRef(byId.get(edge.source))));
  for (const ref of referenceRefs) {
    if (ref.url) ownedUpload(userId, ref.url);
    else if (ref.type !== 'geminiImage') {
      throw Object.assign(new Error(`AI 图片节点「${node.data?.label || node.id}」接入了空图片`), { status: 400 });
    }
  }
  const dependencies = executableDependencies([...promptRefs, ...referenceRefs]);
  const input = {
    provider: node.data?.provider || 'gemini',
    model: node.data?.model || '',
    promptRefs,
    inlinePrompt,
    referenceRefs,
    size: CFG.sizes.includes(node.data?.size) ? node.data.size : '9:16',
    resolution: ['1K', '2K', '4K'].includes(node.data?.resolution) ? node.data.resolution : '1K',
    realism: realismEnabled(),
    dependencies,
  };
  return { input, inputHash: hashInput(input), cost: priceOf('image', input) };
}

function resolveVideoInput(doc, byId, node, userId) {
  const promptRefs = inputEdges(doc, node.id, 'prompt').map((edge) => textRef(byId.get(edge.source)));
  const inlinePrompt = String(node.data?.prompt || '').trim();
  const hasPromptSource = promptRefs.some((ref) => ref.text || ref.type === 'geminiPrompt');
  if (!hasPromptSource && inlinePrompt.length < 2) {
    throw Object.assign(new Error(`视频节点「${node.data?.label || node.id}」缺少提示词`), { status: 400 });
  }

  const identity = resolveIdentityAnchor(doc, byId, node);
  const referenceRefs = uniqueRefs(inputEdges(doc, node.id, 'ref')
    .map((edge) => byId.get(edge.source))
    .filter((source) => ['image', 'geminiImage'].includes(source?.type))
    .map(imageRef));
  const identityRefs = identity?.images || [];
  const identityKeys = new Set(identityRefs.map((ref) => ref.nodeId ? `node:${ref.nodeId}` : `url:${ref.url}`));
  const otherRefs = referenceRefs.filter((ref) => !identityKeys.has(ref.nodeId ? `node:${ref.nodeId}` : `url:${ref.url}`));
  const allRefs = [...identityRefs, ...otherRefs];

  const continuationFrom = inputEdges(doc, node.id, 'continuation')[0]?.source || null;
  const maxBaseReferences = continuationFrom ? 6 : 10;
  if (allRefs.length > maxBaseReferences) {
    const detail = continuationFrom
      ? '续集模式还会自动加入上一段视频、最后一帧和 2 张运动关键帧，因此身份图和普通参考图合计最多 6 张'
      : '单个视频节点最多可接入 10 张参考图';
    throw Object.assign(new Error(`视频节点「${node.data?.label || node.id}」参考素材过多：${detail}`), { status: 400 });
  }
  for (const ref of allRefs) {
    if (ref.url) ownedUpload(userId, ref.url);
    else if (ref.type !== 'geminiImage') {
      throw Object.assign(new Error(`视频节点「${node.data?.label || node.id}」接入了空图片`), { status: 400 });
    }
  }

  const dependencies = executableDependencies([...promptRefs, ...allRefs]);
  if (continuationFrom) dependencies.push(continuationFrom);
  const duration = CFG.videoDurations.includes(Number(node.data?.duration)) ? Number(node.data.duration) : 5;
  const size = CFG.sizes.includes(node.data?.size) ? node.data.size : '16:9';
  const input = {
    promptRefs,
    inlinePrompt,
    identityRefs,
    referenceRefs: otherRefs,
    identitySourceNodeId: identity?.nodeId || null,
    identityLabel: identity?.label || null,
    identityDescription: identity?.description || null,
    identityInherited: !!identity?.inherited,
    duration,
    size,
    model: 'muse-video',
    realism: realismEnabled(),
    continuationFrom,
    dependencies: [...new Set(dependencies)],
    qualityControl: node.data?.qualityControl !== false,
    identityCheck: identityRefs.length > 0 && node.data?.identityCheck !== false,
    qualityThreshold: Math.min(95, Math.max(50, Number(node.data?.qualityThreshold) || 75)),
    qualityMaxRetries: Math.min(2, Math.max(0,
      node.data?.qualityMaxRetries == null ? 1 : Number(node.data.qualityMaxRetries),
    )),
    qualityAttempt: 0,
  };
  return { input, inputHash: hashInput(input), cost: priceOf('video', input) };
}

function resolveNodeInput(doc, byId, node, userId) {
  if (node.type === 'geminiPrompt') return resolvePromptInput(node);
  if (node.type === 'geminiImage') return resolveImageInput(doc, byId, node, userId);
  if (node.type === 'video') return resolveVideoInput(doc, byId, node, userId);
  throw Object.assign(new Error(`节点「${node.data?.label || node.id}」不是可执行节点`), { status: 400 });
}

function planRun(canvasRow, userId, { targetNodeIds = [], force = false } = {}) {
  const doc = cleanDoc(parseJson(canvasRow.doc_json, defaultDoc()));
  const byId = validateGraph(doc);
  const requested = Array.isArray(targetNodeIds) && targetNodeIds.length
    ? [...new Set(targetNodeIds)]
    : doc.nodes.filter((node) => EXECUTABLE_NODE_TYPES.has(node.type)).map((node) => node.id);
  if (!requested.length) throw Object.assign(new Error('画布中还没有可执行节点'), { status: 400 });

  const resolved = new Map();
  const getResolved = (nodeId) => {
    if (resolved.has(nodeId)) return resolved.get(nodeId);
    const node = byId.get(nodeId);
    if (!node || !EXECUTABLE_NODE_TYPES.has(node.type)) {
      throw Object.assign(new Error('运行目标不是可执行节点'), { status: 400 });
    }
    const value = resolveNodeInput(doc, byId, node, userId);
    resolved.set(nodeId, value);
    return value;
  };

  const selected = new Set();
  const includeAncestors = (nodeId) => {
    if (selected.has(nodeId)) return;
    const item = getResolved(nodeId);
    for (const dependency of item.input.dependencies || []) includeAncestors(dependency);
    selected.add(nodeId);
  };
  requested.forEach(includeAncestors);

  const items = [];
  const emitted = new Set();
  const emit = (nodeId) => {
    if (emitted.has(nodeId) || !selected.has(nodeId)) return;
    const value = getResolved(nodeId);
    for (const dependency of value.input.dependencies || []) emit(dependency);
    const node = byId.get(nodeId);
    const dynamicDependency = (value.input.dependencies || []).length > 0;
    const cached = force || dynamicDependency
      ? null
      : findCached(userId, canvasRow.id, node.id, value.inputHash);
    items.push({ node, ...value, cached });
    emitted.add(nodeId);
  };
  selected.forEach(emit);
  return {
    items,
    force: !!force,
    total: items.length,
    cached: items.filter((item) => item.cached).length,
    toGenerate: items.filter((item) => !item.cached).length,
    estimatedCost: items.filter((item) => !item.cached).reduce((sum, item) => sum + item.cost, 0),
    maxRetryCost: items.filter((item) => !item.cached && item.node.type === 'video')
      .reduce((sum, item) => sum + item.cost * Number(item.input.qualityMaxRetries || 0), 0),
    identityAnchored: items.filter((item) => item.input.identityRefs?.length).length,
    inheritedIdentityAnchors: items.filter((item) => item.input.identityRefs?.length && item.input.identityInherited).length,
    typeCounts: items.reduce(
      (counts, item) => ({ ...counts, [item.node.type]: (counts[item.node.type] || 0) + 1 }),
      {},
    ),
  };
}

function insertNodeRun({ runId, canvasId, userId, item, status, jobId = null, cachedFrom = null, output = null, error = null }) {
  const id = uid('nr_');
  const ts = now();
  db.prepare(
    `INSERT INTO node_runs(id, run_id, canvas_id, user_id, node_id, node_type, status,
      input_hash, input_json, job_id, cached_from, output_json, error, created_at, updated_at, finished_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, runId, canvasId, userId, item.node.id, item.node.type, status,
    item.inputHash, JSON.stringify(item.input), jobId, cachedFrom,
    output ? JSON.stringify(output) : null, error, ts, ts,
    ['completed', 'failed'].includes(status) ? ts : null,
  );
  return id;
}

function refundJob(job, userId, reason) {
  if (!job || job.refunded) return;
  addCredits(userId, Number(job.cost || 0), reason, job.id);
  updateJob(job.id, { refunded: 1 });
}

async function inspectCompletedVideo(run, row, job, input, rows, existingOutput) {
  let report;
  try {
    let mediaFile = job.mediaFile;
    if (!mediaFile && job.result?.url) {
      const landed = await muse.downloadMedia(job.result.url, job.id, 'video');
      mediaFile = landed.fileName;
      updateJob(job.id, { media_file: mediaFile });
    }
    if (!mediaFile) throw new Error('生成视频没有可读取的本地文件');
    const file = path.join(MEDIA_DIR, mediaFile);
    const technical = await analyzeVideoQuality(file, {
      expectedDuration: input.duration,
      threshold: input.qualityThreshold,
    });
    let identity = null;
    if (input.identityCheck && input.identityRefs?.length) {
      try {
        const identityUrls = materializeImageUrls(input.identityRefs, rows);
        const references = identityUrls.map((url) => toReference(run.user_id, url));
        const frames = await extractIdentityFrames(file, 5);
        identity = await analyzeCanvasIdentity({
          references, frames, provider: input.qualityProvider || 'gemini',
        });
      } catch (error) {
        identity = { unavailable: true, issues: [`人脸相似度检测暂不可用：${String(error.message || error).slice(0, 160)}`] };
      }
    }
    const identityScore = Number(identity?.faceSimilarity);
    const score = Number.isFinite(identityScore)
      ? Math.round(technical.score * 0.45 + identityScore * 0.55)
      : technical.score;
    const issues = [...technical.issues, ...(identity?.issues || [])];
    const passed = score >= input.qualityThreshold && identity?.identityDrift !== true;
    report = { ...technical, score, threshold: input.qualityThreshold, passed, issues, identity };
  } catch (error) {
    report = {
      score: null, passed: true, threshold: input.qualityThreshold,
      issues: [`自动质检未完成：${String(error.message || error).slice(0, 200)}`],
      unavailable: true, checkedAt: now(),
    };
  }

  const attempt = Math.max(0, Number(input.qualityAttempt) || 0);
  const history = [...(existingOutput.qualityHistory || [])];
  const currentMediaUrl = job.mediaUrl || job.result?.url;
  history.push({ attempt: attempt + 1, mediaUrl: currentMediaUrl, quality: report });
  const canRetry = !report.passed && !report.unavailable && attempt < Number(input.qualityMaxRetries || 0);
  if (canRetry) {
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(run.user_id);
    if (Number(user?.credits || 0) >= Number(job.cost || 0)) {
      if (job.mediaFile) {
        const source = path.join(MEDIA_DIR, job.mediaFile);
        const ext = path.extname(job.mediaFile) || '.mp4';
        const archived = `${job.id}-attempt-${attempt + 1}${ext}`;
        fs.copyFileSync(source, path.join(MEDIA_DIR, archived));
        history[history.length - 1].mediaUrl = `/media/${archived}`;
      }
      addCredits(run.user_id, -Number(job.cost || 0), '画布视频质检自动重试', job.id);
      const feedback = report.issues.length
        ? report.issues.join('；')
        : '上一版综合质量未达到通过分数';
      const nextInput = {
        ...input,
        qualityAttempt: attempt + 1,
        qualityFeedback: feedback,
        qualityPreviousScore: report.score,
      };
      updateJob(job.id, {
        upstream_id: null, status: 'queued', progress: 0, result: null,
        error: null, media_file: null, finished_at: null, refunded: 0,
      });
      db.prepare("UPDATE node_runs SET status = 'queued', input_json = ?, output_json = ?, error = NULL, updated_at = ?, finished_at = NULL WHERE id = ?")
        .run(JSON.stringify(nextInput), JSON.stringify({ ...existingOutput, mediaUrl: null, quality: report, qualityHistory: history }), now(), row.id);
      return 'retry';
    }
    report.issues.push('积分不足，未执行自动重试');
  }
  db.prepare("UPDATE node_runs SET status = 'completed', output_json = ?, error = NULL, updated_at = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify({ ...existingOutput, mediaUrl: currentMediaUrl, jobId: job.id, quality: report, qualityHistory: history }), now(), now(), row.id);
  return 'completed';
}

async function syncNodeJobs(runId) {
  const rows = db.prepare('SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at').all(runId);
  for (const row of rows) {
    if (!row.job_id || !['queued', 'processing'].includes(row.status)) continue;
    const job = getJob(row.job_id);
    if (!job) continue;
    const input = parseJson(row.input_json, {});
    const existingOutput = parseJson(row.output_json, {});
    if (job.status === 'completed' && row.node_type === 'video' && (input.qualityControl || input.identityCheck)) {
      await inspectCompletedVideo(
        db.prepare('SELECT * FROM canvas_runs WHERE id = ?').get(runId),
        row, job, input, rows, existingOutput,
      );
      continue;
    }
    const status = job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : job.status;
    const terminal = ['completed', 'failed'].includes(status);
    const completedOutput = {
      ...existingOutput,
      mediaUrl: job.mediaUrl || job.result?.url,
      jobId: job.id,
    };
    db.prepare(
      'UPDATE node_runs SET status = ?, output_json = ?, error = ?, updated_at = ?, finished_at = ? WHERE id = ?'
    ).run(
      status,
      terminal && status === 'completed' ? JSON.stringify(completedOutput) : row.output_json,
      status === 'failed' ? job.error : null,
      now(), terminal ? now() : null, row.id,
    );
  }
}

function outputOf(row) {
  return parseJson(row?.output_json, {});
}

function dependencyRow(allRows, nodeId) {
  return allRows.find((row) => row.node_id === nodeId) || null;
}

function ensureDependencies(input, allRows) {
  for (const nodeId of input.dependencies || []) {
    const row = dependencyRow(allRows, nodeId);
    if (!row) throw new Error(`依赖节点 ${nodeId} 不在本次工作流中`);
    if (row.status === 'failed') throw new Error(`上游节点执行失败：${row.error || nodeId}`);
    if (row.status !== 'completed') return false;
  }
  return true;
}

function materializeText(ref, allRows) {
  if (ref?.type === 'geminiPrompt') {
    const content = outputOf(dependencyRow(allRows, ref.nodeId))?.content;
    if (!content) throw new Error(`AI 提示词节点 ${ref.nodeId} 没有生成文本`);
    return String(content).trim();
  }
  return String(ref?.text || '').trim();
}

function materializePrompt(input, allRows) {
  if (input.prompt && !input.promptRefs) return String(input.prompt).trim();
  const parts = (input.promptRefs || []).map((ref) => materializeText(ref, allRows)).filter(Boolean);
  if (String(input.inlinePrompt || '').trim()) parts.push(String(input.inlinePrompt).trim());
  const prompt = parts.join('\n\n').trim();
  if (prompt.length < 2) throw new Error('工作流没有得到有效提示词');
  return prompt;
}

function materializeImageUrl(ref, allRows) {
  if (ref?.type === 'geminiImage') {
    const url = outputOf(dependencyRow(allRows, ref.nodeId))?.mediaUrl;
    if (url) return url;
  }
  if (ref?.url) return ref.url;
  throw new Error(`图片节点 ${ref?.nodeId || ''} 没有可用结果`);
}

function materializeImageUrls(refs, allRows) {
  return [...new Set((refs || []).map((ref) => materializeImageUrl(ref, allRows)).filter(Boolean))];
}

async function prepareVideoPayload(run, input, allRows) {
  const prompt = applyRealism(materializePrompt(input, allRows), 'video');
  const identityImages = input.identityRefs
    ? materializeImageUrls(input.identityRefs, allRows)
    : (Array.isArray(input.identityImages) ? input.identityImages : []);
  const referenceImages = input.referenceRefs
    ? materializeImageUrls(input.referenceRefs, allRows)
    : (Array.isArray(input.referenceImages)
      ? input.referenceImages
      : (identityImages.length ? [] : (Array.isArray(input.images) ? input.images : [])));
  const identityReferences = identityImages.map((url) => toReference(run.user_id, url));
  const otherReferences = referenceImages.map((url) => toReference(run.user_id, url));
  const payload = {
    prompt,
    model: input.model,
    duration: input.duration,
    size: input.size,
  };

  if (!input.continuationFrom) {
    payload.images = [...identityReferences, ...otherReferences];
    const identityInstruction = buildIdentityLockInstruction({
      startIndex: 1,
      count: identityReferences.length,
      label: input.identityLabel,
      description: input.identityDescription,
    });
    if (identityInstruction) payload.prompt = `${identityInstruction}\n\n【本段内容】\n${prompt}`;
  }

  if (input.continuationFrom) {
    const previousRow = allRows.find((row) => row.node_id === input.continuationFrom);
    if (!previousRow) throw new Error('续集依赖的上一段视频不在本次运行中');
    if (previousRow.status === 'failed') {
      throw new Error('上一段视频生成失败，本续集节点未执行');
    }
    if (previousRow.status !== 'completed') return null;
    const previousJob = getJob(previousRow.job_id);
    if (!previousJob) throw new Error('上一段视频任务不存在，无法作为续集参考');
    let mediaFile = previousJob.mediaFile;
    if (!mediaFile && previousJob.result?.url) {
      const landed = await muse.downloadMedia(previousJob.result.url, `${previousJob.id}-continuation`, 'video');
      mediaFile = landed.fileName;
      updateJob(previousJob.id, { media_file: mediaFile });
    }
    if (!mediaFile) throw new Error('上一段视频未保存到本地，无法作为续集参考');
    const previousFile = path.join(MEDIA_DIR, mediaFile);
    const references = await continuationReferences(previousFile);
    const motionFrames = references.motionFrames || [];
    const identityInstruction = buildIdentityLockInstruction({
      startIndex: 2 + motionFrames.length,
      count: identityReferences.length,
      label: input.identityLabel,
      description: input.identityDescription,
    });
    payload.prompt = [
      buildContinuationInstruction({ motionFrameCount: motionFrames.length }),
      identityInstruction,
      `【本段后续内容】\n${prompt}`,
    ].filter(Boolean).join('\n\n');
    payload.images = [references.lastFrame, ...motionFrames, ...identityReferences, ...otherReferences];
    payload.videos = [references.video];
  }

  if (input.qualityFeedback) {
    payload.prompt = `${payload.prompt}\n\n【自动质检重试修正｜最高优先级】\n上一版存在：${String(input.qualityFeedback).slice(0, 600)}。本次必须针对这些问题修正，保持原有人物、服装、场景和动作设计不变；不得复制上一版的缺陷。${input.identityRefs?.length ? '尤其必须严格恢复身份参考中的同一张脸，禁止平均脸、换脸和帧间五官漂移。' : ''}`;
  }

  return { payload, prompt, identityImages, referenceImages };
}

async function submitNodeRun(run, nodeRow, allRows) {
  const input = parseJson(nodeRow.input_json, {});
  if (!ensureDependencies(input, allRows)) return false;

  if (nodeRow.node_type === 'geminiPrompt') {
    const out = await generateCanvasPrompt(input);
    db.prepare("UPDATE node_runs SET status = 'completed', output_json = ?, error = NULL, updated_at = ?, finished_at = ? WHERE id = ?")
      .run(JSON.stringify({ content: out.content, model: out.model, provider: out.provider, usage: out.usage || null }), now(), now(), nodeRow.id);
    return true;
  }

  const job = getJob(nodeRow.job_id);
  if (!job || job.upstreamId || !['queued', 'waiting'].includes(job.status)) return false;

  if (nodeRow.node_type === 'geminiImage') {
    const prompt = applyRealism(materializePrompt(input, allRows), 'image');
    const imageUrls = materializeImageUrls(input.referenceRefs || [], allRows);
    const references = imageUrls.map((url) => toReference(run.user_id, url));
    updateJob(job.id, {
      prompt,
      params: { ...job.params, images: imageUrls, provider: input.provider, model: input.model, size: input.size, resolution: input.resolution },
      status: 'processing',
      progress: 20,
    });
    db.prepare("UPDATE node_runs SET status = 'processing', updated_at = ? WHERE id = ?").run(now(), nodeRow.id);
    const out = await generateCanvasImage({ ...input, prompt, images: references, jobId: job.id });
    const output = {
      mediaUrl: out.url,
      jobId: job.id,
      model: out.model,
      provider: input.provider,
      note: out.note || '',
    };
    updateJob(job.id, {
      status: 'completed', progress: 100, media_file: out.fileName,
      result: JSON.stringify({ url: out.url, localUrl: out.url, bytes: out.bytes, mime: out.mime, model: out.model, note: out.note, usage: out.usage }),
      error: null, finished_at: now(),
    });
    db.prepare("UPDATE node_runs SET status = 'completed', output_json = ?, error = NULL, updated_at = ?, finished_at = ? WHERE id = ?")
      .run(JSON.stringify(output), now(), now(), nodeRow.id);
    return true;
  }

  if (nodeRow.node_type !== 'video') throw new Error(`不支持执行节点类型：${nodeRow.node_type}`);
  const prepared = await prepareVideoPayload(run, input, allRows);
  if (!prepared) return false;
  updateJob(job.id, {
    prompt: prepared.prompt,
    params: {
      ...job.params,
      images: [...prepared.identityImages, ...prepared.referenceImages],
      identityReferenceCount: prepared.identityImages.length,
    },
  });

  const out = await muse.createVideo(prepared.payload);
  const upstreamId = out?.id || out?.task_id;
  if (!upstreamId) throw new Error('上游未返回任务 ID');
  updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 15 });
  db.prepare("UPDATE node_runs SET status = 'processing', updated_at = ? WHERE id = ?").run(now(), nodeRow.id);
  return true;
}

function finalizeRun(runId) {
  const run = db.prepare('SELECT * FROM canvas_runs WHERE id = ?').get(runId);
  const rows = db.prepare('SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at').all(runId);
  const active = rows.some((row) => ACTIVE_RUN.has(row.status));
  const failed = rows.filter((row) => row.status === 'failed').length;
  const completed = rows.filter((row) => row.status === 'completed').length;
  const actualCost = rows.reduce((sum, row) => {
    if (row.cached_from) return sum;
    const job = row.job_id ? getJob(row.job_id) : null;
    if (!job) return sum;
    const input = parseJson(row.input_json, {});
    const attempts = 1 + Math.max(0, Number(input.qualityAttempt) || 0);
    const chargedAttempts = Math.max(0, attempts - (job.refunded ? 1 : 0));
    return sum + Number(job.cost || 0) * chargedAttempts;
  }, 0);
  let status = active ? 'processing' : failed && completed ? 'completed_with_errors' : failed ? 'failed' : 'completed';
  if (!rows.length) status = 'failed';
  if (status !== run.status || actualCost !== run.actual_cost) {
    db.prepare('UPDATE canvas_runs SET status = ?, actual_cost = ?, updated_at = ?, finished_at = ? WHERE id = ?')
      .run(status, actualCost, now(), active ? null : now(), runId);
  }
  return shapeRun(db.prepare('SELECT * FROM canvas_runs WHERE id = ?').get(runId), rows);
}

async function advanceCanvasRun(runId, userId = null) {
  const run = userId
    ? db.prepare('SELECT * FROM canvas_runs WHERE id = ? AND user_id = ?').get(runId, userId)
    : db.prepare('SELECT * FROM canvas_runs WHERE id = ?').get(runId);
  if (!run) throw Object.assign(new Error('运行记录不存在'), { status: 404 });
  if (advancingRuns.has(runId)) return finalizeRun(runId);
  advancingRuns.add(runId);
  try {
    await syncNodeJobs(runId);
    let rows = db.prepare('SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at').all(runId);
    for (const row of rows) {
      if (!['queued', 'waiting'].includes(row.status)) continue;
      try {
        await submitNodeRun(run, row, rows);
      } catch (error) {
        const job = getJob(row.job_id);
        const message = String(error.message || error).slice(0, 500);
        if (job) {
          updateJob(job.id, { status: 'failed', error: message, finished_at: now() });
          refundJob(job, run.user_id, '画布任务创建失败退还');
        }
        db.prepare("UPDATE node_runs SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE id = ?")
          .run(message, now(), now(), row.id);
      }
      rows = db.prepare('SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at').all(runId);
    }
    await syncNodeJobs(runId);
    return finalizeRun(runId);
  } finally {
    advancingRuns.delete(runId);
  }
}

function shapeNodeRuns(nodeRows) {
  return nodeRows.map((row) => {
    const job = row.job_id ? getJob(row.job_id) : null;
    const output = parseJson(row.output_json, null);
    const input = parseJson(row.input_json, {});
    return {
      id: row.id,
      nodeId: row.node_id,
      status: row.status,
      inputHash: row.input_hash,
      jobId: row.job_id,
      cached: !!row.cached_from,
      progress: job?.progress || (row.status === 'completed' ? 100 : 0),
      mediaUrl: output?.mediaUrl || job?.mediaUrl || job?.result?.url || null,
      content: output?.content || null,
      model: output?.model || job?.result?.model || null,
      provider: output?.provider || job?.params?.provider || null,
      quality: output?.quality || null,
      qualityHistory: output?.qualityHistory || [],
      error: row.error || job?.error || null,
      continuationFrom: input.continuationFrom || null,
    };
  });
}

function shapeRun(run, nodeRows) {
  return {
    id: run.id,
    canvasId: run.canvas_id,
    status: run.status,
    force: !!run.force,
    estimatedCost: run.estimated_cost,
    actualCost: run.actual_cost,
    error: run.error,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    finishedAt: run.finished_at,
    nodeRuns: shapeNodeRuns(nodeRows),
  };
}

function latestNodeState(canvasId, userId) {
  const rows = db.prepare(
    `SELECT nr.* FROM node_runs nr
     WHERE nr.canvas_id = ? AND nr.user_id = ?
       AND nr.created_at = (
         SELECT MAX(newer.created_at) FROM node_runs newer
         WHERE newer.canvas_id = nr.canvas_id AND newer.user_id = nr.user_id AND newer.node_id = nr.node_id
       )
     ORDER BY nr.created_at`
  ).all(canvasId, userId);
  return shapeNodeRuns(rows);
}

r.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM canvases WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json({ canvases: rows.map((row) => shapeCanvas(row, false)) });
});

r.post('/', requireAuth, (req, res) => {
  const id = uid('cv_');
  const ts = now();
  const name = String(req.body?.name || '默认画布').trim().slice(0, 80) || '默认画布';
  const doc = cleanDoc(req.body?.doc || defaultDoc());
  db.prepare('INSERT INTO canvases(id, user_id, name, doc_json, rev, created_at, updated_at) VALUES(?,?,?,?,1,?,?)')
    .run(id, req.user.id, name, JSON.stringify(doc), ts, ts);
  res.status(201).json({ canvas: shapeCanvas(ownCanvas(id, req.user.id)) });
});

r.get('/:id', requireAuth, async (req, res) => {
  const canvas = shapeCanvas(ownCanvas(req.params.id, req.user.id));
  const latest = db.prepare('SELECT id FROM canvas_runs WHERE canvas_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(req.params.id, req.user.id);
  res.json({
    canvas,
    latestRun: latest ? await advanceCanvasRun(latest.id, req.user.id) : null,
    nodeState: latestNodeState(req.params.id, req.user.id),
  });
});

r.put('/:id', requireAuth, (req, res) => {
  const row = ownCanvas(req.params.id, req.user.id);
  const rev = Number(req.body?.rev);
  if (rev !== row.rev) return res.status(409).json({ error: '画布已在其他窗口被修改，请刷新后重试', canvas: shapeCanvas(row) });
  const doc = cleanDoc(req.body?.doc);
  const name = String(req.body?.name || row.name).trim().slice(0, 80) || row.name;
  const changed = db.prepare(
    'UPDATE canvases SET name = ?, doc_json = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND user_id = ? AND rev = ?'
  ).run(name, JSON.stringify(doc), now(), row.id, req.user.id, rev);
  if (!changed.changes) return res.status(409).json({ error: '画布版本冲突，请刷新后重试' });
  res.json({ canvas: shapeCanvas(ownCanvas(row.id, req.user.id)) });
});

r.delete('/:id', requireAuth, (req, res) => {
  const row = ownCanvas(req.params.id, req.user.id);
  const running = db.prepare("SELECT COUNT(*) n FROM canvas_runs WHERE canvas_id = ? AND status IN ('queued','submitting','processing')").get(row.id).n;
  if (running) return res.status(409).json({ error: '画布仍有任务运行，暂时不能删除' });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM node_runs WHERE canvas_id = ?').run(row.id);
    db.prepare('DELETE FROM canvas_runs WHERE canvas_id = ?').run(row.id);
    db.prepare('DELETE FROM canvases WHERE id = ?').run(row.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ deleted: true, id: row.id });
});

r.post('/:id/storyboards/:nodeId/export', requireAuth, async (req, res) => {
  const canvasRow = ownCanvas(req.params.id, req.user.id);
  const doc = cleanDoc(parseJson(canvasRow.doc_json, defaultDoc()));
  const byId = validateGraph(doc);
  const board = byId.get(req.params.nodeId);
  if (!board || board.type !== 'storyboard') {
    return res.status(404).json({ error: '分镜板节点不存在' });
  }
  const clipEdges = inputEdges(doc, board.id, 'clip');
  if (!clipEdges.length) return res.status(400).json({ error: '请先把视频节点按顺序连接到分镜板' });

  const clips = [];
  for (const edge of clipEdges) {
    const source = byId.get(edge.source);
    if (!source || source.type !== 'video') continue;
    const nodeRun = db.prepare(
      `SELECT * FROM node_runs
       WHERE canvas_id = ? AND user_id = ? AND node_id = ? AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`
    ).get(canvasRow.id, req.user.id, source.id);
    const job = nodeRun?.job_id ? getJob(nodeRun.job_id) : null;
    if (!job?.mediaFile || !fs.existsSync(path.join(MEDIA_DIR, job.mediaFile))) {
      return res.status(409).json({ error: `视频节点「${source.data?.label || source.id}」还没有可导出的成片` });
    }
    clips.push({
      nodeId: source.id,
      label: source.data?.label || '视频片段',
      job,
      file: path.join(MEDIA_DIR, job.mediaFile),
      trimStart: Math.max(0, Number(edge.data?.trimStart) || 0),
      trimEnd: Math.max(0, Number(edge.data?.trimEnd) || 0),
      volume: Math.max(0, Math.min(2, Number.isFinite(Number(edge.data?.volume)) ? Number(edge.data.volume) : 1)),
      transition: edge.data?.transition === 'fade' ? 'fade' : 'cut',
      transitionDuration: Math.max(0.1, Math.min(1.5, Number(edge.data?.transitionDuration) || 0.35)),
    });
  }
  if (!clips.length) return res.status(400).json({ error: '分镜板没有可导出的视频片段' });

  const filename = `storyboard-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.mp4`;
  const outputFile = path.join(MEDIA_DIR, filename);
  const bgm = board.data?.bgmUrl ? ownedAudio(req.user.id, board.data.bgmUrl) : null;
  const meta = await mergeVideoClips(clips, outputFile, {
    outputSize: ['source', '16:9', '9:16', '1:1'].includes(board.data?.outputSize) ? board.data.outputSize : 'source',
    bgmFile: bgm?.file || null,
    bgmVolume: Math.max(0, Math.min(2, Number(board.data?.bgmVolume) || 0.25)),
  });
  res.status(201).json({
    export: {
      url: `/media/${filename}`,
      filename,
      bytes: meta.bytes,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      clips: clips.map((clip) => ({
        nodeId: clip.nodeId, label: clip.label, url: clip.job.mediaUrl,
        trimStart: clip.trimStart, trimEnd: clip.trimEnd, volume: clip.volume,
        transition: clip.transition, transitionDuration: clip.transitionDuration,
      })),
    },
  });
});

r.post('/:id/runs/preview', requireAuth, (req, res) => {
  const row = ownCanvas(req.params.id, req.user.id);
  const plan = planRun(row, req.user.id, req.body || {});
  res.json({
    preview: {
      total: plan.total,
      cached: plan.cached,
      toGenerate: plan.toGenerate,
      estimatedCost: plan.estimatedCost,
      maxRetryCost: plan.maxRetryCost,
      balance: req.user.credits,
      identityAnchored: plan.identityAnchored,
      inheritedIdentityAnchors: plan.inheritedIdentityAnchors,
      typeCounts: plan.typeCounts,
    },
  });
});

r.post('/:id/runs', requireAuth, async (req, res) => {
  const row = ownCanvas(req.params.id, req.user.id);
  const active = db.prepare(
    "SELECT COUNT(*) n FROM canvas_runs WHERE canvas_id = ? AND status IN ('queued','submitting','processing')"
  ).get(row.id).n;
  if (active) return res.status(409).json({ error: '这个画布已有任务在运行，请完成后再提交' });
  const plan = planRun(row, req.user.id, req.body || {});
  const fresh = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (fresh.credits < plan.estimatedCost) {
    return res.status(402).json({ error: `积分不足，本次需要 ${plan.estimatedCost}，当前 ${fresh.credits}` });
  }

  const runId = uid('cr_');
  const ts = now();
  db.prepare(
    `INSERT INTO canvas_runs(id, canvas_id, user_id, status, target_nodes, force, estimated_cost,
      actual_cost, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(
    runId, row.id, req.user.id, 'submitting', JSON.stringify(plan.items.map((item) => item.node.id)),
    plan.force ? 1 : 0, plan.estimatedCost, 0, ts, ts,
  );

  for (const item of plan.items) {
    if (item.cached) {
      insertNodeRun({
        runId, canvasId: row.id, userId: req.user.id, item, status: 'completed',
        jobId: item.cached.job?.id || null, cachedFrom: item.cached.row.id,
        output: item.cached.output || (item.cached.job ? {
          mediaUrl: item.cached.job.mediaUrl || item.cached.job.result?.url,
          jobId: item.cached.job.id,
        } : null),
      });
      continue;
    }

    let job = null;
    if (item.node.type !== 'geminiPrompt') {
      const jobType = item.node.type === 'geminiImage' ? 'image' : 'video';
      const previewPrompt = item.input.inlinePrompt || item.node.data?.keywords || item.node.data?.label || '画布工作流节点';
      job = createJob(req.user.id, jobType, previewPrompt, {
        duration: item.input.duration,
        size: item.input.size,
        realism: item.input.realism,
        provider: item.input.provider,
        model: item.input.model,
        continuationFrom: item.input.continuationFrom,
        identitySourceNodeId: item.input.identitySourceNodeId,
        identityReferenceCount: item.input.identityRefs?.length || 0,
        identityInherited: item.input.identityInherited,
        canvasId: row.id, canvasRunId: runId, canvasNodeId: item.node.id,
      }, item.cost);
      if (item.cost > 0) addCredits(req.user.id, -item.cost, `画布${jobType === 'image' ? '图片' : '视频'}节点`, job.id);
    }
    const status = item.input.dependencies?.length ? 'waiting' : 'queued';
    if (status === 'waiting' && job) updateJob(job.id, { status: 'waiting' });
    insertNodeRun({
      runId, canvasId: row.id, userId: req.user.id, item, status, jobId: job?.id || null,
    });
  }
  res.status(201).json({ run: await advanceCanvasRun(runId, req.user.id) });
});

r.get('/:id/runs', requireAuth, async (req, res) => {
  ownCanvas(req.params.id, req.user.id);
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
  const rows = db.prepare('SELECT * FROM canvas_runs WHERE canvas_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(req.params.id, req.user.id, limit);
  res.json({ runs: await Promise.all(rows.map((row) => advanceCanvasRun(row.id, req.user.id))) });
});

r.get('/runs/:runId/status', requireAuth, async (req, res) => {
  res.json({ run: await advanceCanvasRun(req.params.runId, req.user.id) });
});

export function startCanvasScheduler() {
  if (schedulerTimer) return schedulerTimer;
  const tick = async () => {
    const runs = db.prepare("SELECT id FROM canvas_runs WHERE status IN ('queued','submitting','processing') ORDER BY created_at LIMIT 30").all();
    await Promise.allSettled(runs.map((run) => advanceCanvasRun(run.id)));
  };
  schedulerTimer = setInterval(() => { tick().catch((error) => console.error('[canvas] 调度失败:', error.message)); }, 2500);
  schedulerTimer.unref?.();
  tick().catch((error) => console.error('[canvas] 初始调度失败:', error.message));
  return schedulerTimer;
}

export default r;
