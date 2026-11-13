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
  'video:video>video:continuation',
  'video:video>storyboard:clip',
]);

const ACTIVE_RUN = new Set(['queued', 'submitting', 'waiting', 'processing']);
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
    if (!row.job_id) continue;
    const job = getJob(row.job_id);
    if (!job || job.status !== 'completed') continue;
    if (job.mediaFile && !fs.existsSync(path.join(MEDIA_DIR, job.mediaFile))) continue;
    if (!job.mediaUrl && !job.result?.url) continue;
    return { row, job };
  }
  return null;
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
    if (['image', 'geminiImage'].includes(imageNode?.type) && imageNode.data?.url) refs.push(imageNode.data.url);
  }
  for (const url of character.data?.refs || []) refs.push(url);
  return [...new Set(refs.filter(Boolean))];
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

function resolveVideoInput(doc, byId, node, userId) {
  const textParts = inputEdges(doc, node.id, 'prompt').map((edge) => {
    const source = byId.get(edge.source);
    return String(source?.data?.content || '').trim();
  }).filter(Boolean);
  const inline = String(node.data?.prompt || '').trim();
  if (inline) textParts.push(inline);
  const prompt = textParts.join('\n\n').trim();
  if (prompt.length < 2) throw Object.assign(new Error(`视频节点「${node.data?.label || node.id}」缺少提示词`), { status: 400 });

  const identity = resolveIdentityAnchor(doc, byId, node);
  const refs = [];
  for (const edge of inputEdges(doc, node.id, 'ref')) {
    const source = byId.get(edge.source);
    if (['image', 'geminiImage'].includes(source?.type) && source.data?.url) refs.push(source.data.url);
  }
  const identityImages = identity?.images || [];
  const identitySet = new Set(identityImages);
  const referenceImages = [...new Set(refs)].filter((url) => !identitySet.has(url));
  const images = [...identityImages, ...referenceImages];

  const continuationEdges = inputEdges(doc, node.id, 'continuation');
  const continuationFrom = continuationEdges[0]?.source || null;
  const maxBaseReferences = continuationFrom ? 6 : 10;
  if (images.length > maxBaseReferences) {
    const detail = continuationFrom
      ? '续集模式还会自动加入上一段视频、最后一帧和 2 张运动关键帧，因此身份图和普通参考图合计最多 6 张'
      : '单个视频节点最多可接入 10 张参考图';
    throw Object.assign(new Error(`视频节点「${node.data?.label || node.id}」参考素材过多：${detail}`), { status: 400 });
  }
  for (const url of images) ownedUpload(userId, url);

  const duration = CFG.videoDurations.includes(Number(node.data?.duration)) ? Number(node.data.duration) : 5;
  const size = CFG.sizes.includes(node.data?.size) ? node.data.size : '16:9';
  const input = {
    prompt: applyRealism(prompt, 'video'), images, identityImages, referenceImages,
    identitySourceNodeId: identity?.nodeId || null,
    identityLabel: identity?.label || null,
    identityDescription: identity?.description || null,
    identityInherited: !!identity?.inherited,
    duration, size, model: 'muse-video', realism: realismEnabled(), continuationFrom,
  };
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return { input, inputHash, cost: priceOf('video', input) };
}

function planRun(canvasRow, userId, { targetNodeIds = [], force = false } = {}) {
  const doc = cleanDoc(parseJson(canvasRow.doc_json, defaultDoc()));
  const byId = validateGraph(doc);
  const requested = Array.isArray(targetNodeIds) && targetNodeIds.length
    ? [...new Set(targetNodeIds)]
    : doc.nodes.filter((node) => node.type === 'video').map((node) => node.id);
  if (!requested.length) throw Object.assign(new Error('画布中还没有视频节点'), { status: 400 });

  const selected = new Set();
  const includeAncestors = (nodeId) => {
    const node = byId.get(nodeId);
    if (!node || node.type !== 'video') throw Object.assign(new Error('运行目标不是视频节点'), { status: 400 });
    if (selected.has(nodeId)) return;
    for (const edge of inputEdges(doc, nodeId, 'continuation')) includeAncestors(edge.source);
    selected.add(nodeId);
  };
  requested.forEach(includeAncestors);

  const items = [];
  const emitted = new Set();
  const emit = (nodeId) => {
    if (emitted.has(nodeId) || !selected.has(nodeId)) return;
    for (const edge of inputEdges(doc, nodeId, 'continuation')) emit(edge.source);
    const node = byId.get(nodeId);
    const resolved = resolveVideoInput(doc, byId, node, userId);
    // 续集的缓存必须同时绑定上一段实际媒体。为避免错误复用，续集节点始终重新生成。
    const cached = force || resolved.input.continuationFrom
      ? null
      : findCached(userId, canvasRow.id, node.id, resolved.inputHash);
    items.push({ node, ...resolved, cached });
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
    identityAnchored: items.filter((item) => item.input.identityImages?.length).length,
    inheritedIdentityAnchors: items.filter((item) => item.input.identityImages?.length && item.input.identityInherited).length,
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

function syncNodeJobs(runId) {
  const rows = db.prepare('SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at').all(runId);
  for (const row of rows) {
    if (!row.job_id || !['queued', 'processing'].includes(row.status)) continue;
    const job = getJob(row.job_id);
    if (!job) continue;
    const status = job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : job.status;
    const terminal = ['completed', 'failed'].includes(status);
    db.prepare(
      'UPDATE node_runs SET status = ?, output_json = ?, error = ?, updated_at = ?, finished_at = ? WHERE id = ?'
    ).run(
      status,
      terminal && status === 'completed' ? JSON.stringify({ mediaUrl: job.mediaUrl || job.result?.url, jobId: job.id }) : row.output_json,
      status === 'failed' ? job.error : null,
      now(), terminal ? now() : null, row.id,
    );
  }
}

async function submitNodeRun(run, nodeRow, allRows) {
  const job = getJob(nodeRow.job_id);
  if (!job || job.upstreamId || !['queued', 'waiting'].includes(job.status)) return false;
  const input = parseJson(nodeRow.input_json, {});
  const payload = {
    prompt: input.prompt,
    model: input.model,
    duration: input.duration,
    size: input.size,
  };
  const identityImages = Array.isArray(input.identityImages) ? input.identityImages : [];
  const referenceImages = Array.isArray(input.referenceImages)
    ? input.referenceImages
    : (identityImages.length ? [] : (Array.isArray(input.images) ? input.images : []));
  const identityReferences = identityImages.map((url) => toReference(run.user_id, url));
  const otherReferences = referenceImages.map((url) => toReference(run.user_id, url));

  if (!input.continuationFrom) {
    payload.images = [...identityReferences, ...otherReferences];
    const identityInstruction = buildIdentityLockInstruction({
      startIndex: 1,
      count: identityReferences.length,
      label: input.identityLabel,
      description: input.identityDescription,
    });
    if (identityInstruction) payload.prompt = `${identityInstruction}\n\n【本段内容】\n${input.prompt}`;
  }

  if (input.continuationFrom) {
    const previousRow = allRows.find((row) => row.node_id === input.continuationFrom);
    if (!previousRow) throw new Error('续集依赖的上一段视频不在本次运行中');
    if (previousRow.status === 'failed') {
      const message = '上一段视频生成失败，本续集节点未执行';
      updateJob(job.id, { status: 'failed', error: message, finished_at: now() });
      refundJob(job, run.user_id, '续集依赖失败退还');
      db.prepare("UPDATE node_runs SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE id = ?")
        .run(message, now(), now(), nodeRow.id);
      return false;
    }
    if (previousRow.status !== 'completed') return false;
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
      `【本段后续内容】\n${input.prompt}`,
    ].filter(Boolean).join('\n\n');
    payload.images = [references.lastFrame, ...motionFrames, ...identityReferences, ...otherReferences];
    payload.videos = [references.video];
  }

  const out = await muse.createVideo(payload);
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
    return sum + (job && !job.refunded ? Number(job.cost || 0) : 0);
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
    syncNodeJobs(runId);
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
    syncNodeJobs(runId);
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
    clips.push({ nodeId: source.id, label: source.data?.label || '视频片段', job, file: path.join(MEDIA_DIR, job.mediaFile) });
  }
  if (!clips.length) return res.status(400).json({ error: '分镜板没有可导出的视频片段' });

  const filename = `storyboard-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.mp4`;
  const outputFile = path.join(MEDIA_DIR, filename);
  const meta = await mergeVideoClips(clips.map((clip) => clip.file), outputFile);
  res.status(201).json({
    export: {
      url: `/media/${filename}`,
      filename,
      bytes: meta.bytes,
      clips: clips.map((clip) => ({ nodeId: clip.nodeId, label: clip.label, url: clip.job.mediaUrl })),
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
      balance: req.user.credits,
      identityAnchored: plan.identityAnchored,
      inheritedIdentityAnchors: plan.inheritedIdentityAnchors,
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
        jobId: item.cached.job.id, cachedFrom: item.cached.row.id,
        output: { mediaUrl: item.cached.job.mediaUrl || item.cached.job.result?.url, jobId: item.cached.job.id },
      });
      continue;
    }

    const job = createJob(req.user.id, 'video', item.input.prompt, {
      duration: item.input.duration, size: item.input.size, images: item.input.images,
      realism: item.input.realism,
      continuationFrom: item.input.continuationFrom,
      identitySourceNodeId: item.input.identitySourceNodeId,
      identityReferenceCount: item.input.identityImages?.length || 0,
      identityInherited: item.input.identityInherited,
      canvasId: row.id, canvasRunId: runId, canvasNodeId: item.node.id,
    }, item.cost);
    addCredits(req.user.id, -item.cost, '画布视频节点', job.id);
    const status = item.input.continuationFrom ? 'waiting' : 'queued';
    if (status === 'waiting') updateJob(job.id, { status: 'waiting' });
    insertNodeRun({
      runId, canvasId: row.id, userId: req.user.id, item, status, jobId: job.id,
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
