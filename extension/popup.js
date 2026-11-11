/* ReelGraph Studio 账号绑定 —— popup 手动兜底
 * 如果 /bind 页面自动流程走不通，可以在这里手动填平台地址 + 绑定码。
 */

const $ = (id) => document.getElementById(id);
const CFG_KEY = 'muse_studio_bind_cfg';

const log = (msg, cls = '') => {
  const el = $('log');
  el.textContent = msg;
  el.className = cls;
};

(async () => {
  try {
    const saved = (await chrome.storage.local.get(CFG_KEY))[CFG_KEY] || {};
    if (saved.api) $('api').value = saved.api;
    if (saved.label) $('label').value = saved.label;
  } catch (e) { /* ignore */ }
})();

$('go').addEventListener('click', async () => {
  const api = $('api').value.trim().replace(/\/+$/, '');
  const code = $('code').value.trim();
  const label = $('label').value.trim();

  if (!api) return log('请先填平台地址', 'err');
  if (!code) return log('请先填绑定码', 'err');

  $('go').disabled = true;
  log('正在读取 muse.ai 的 Cookie…');

  try { await chrome.storage.local.set({ [CFG_KEY]: { api, label } }); } catch (e) { /* ignore */ }

  chrome.runtime.sendMessage({ type: 'MUSE_BIND', api, code, label }, (resp) => {
    $('go').disabled = false;
    if (chrome.runtime.lastError) return log('扩展错误：' + chrome.runtime.lastError.message, 'err');
    if (!resp) return log('扩展没有响应，重新打开这个弹窗试试', 'err');
    if (resp.ok) {
      const a = resp.data?.account || {};
      log(
        `✓ 绑定成功\n账号：${a.label || '—'}\nCookie：${resp.cookieCount} 条` +
        (resp.data?.warning ? `\n注意：${resp.data.warning}` : ''),
        'ok'
      );
    } else {
      log(`✗ ${resp.message || '绑定失败'}`, 'err');
    }
  });
});
