/* ReelGraph Studio 账号绑定 —— content script
 *
 * 只在平台的 /bind/<code> 页面上工作：把这个一次性 code 交给 background，
 * background 读完 muse.ai 的 cookie 后回传结果，页面据此更新 UI。
 */

(() => {
  const match = location.pathname.match(/^\/bind\/([A-Za-z0-9_-]{8,})/);
  if (!match) return;
  const code = match[1];
  const api = location.origin;

  // 让页面知道扩展已就位
  document.documentElement.setAttribute('data-museapi-video-ext', '1');

  const post = (payload) => {
    window.postMessage({ source: 'museapi-video-ext', ...payload }, location.origin);
  };

  chrome.runtime.sendMessage({ type: 'MUSE_BIND', api, code }, (resp) => {
    if (chrome.runtime.lastError) {
      post({ type: 'error', message: chrome.runtime.lastError.message });
      return;
    }
    if (!resp) {
      post({ type: 'error', message: '扩展没有响应，试试重新打开这个页面' });
      return;
    }
    if (resp.ok) {
      post({
        type: 'done',
        label: resp.data?.account?.label || '',
        warning: resp.data?.warning || '',
        cookieCount: resp.cookieCount || 0,
      });
    } else {
      post({ type: 'error', message: resp.message || '绑定失败', reason: resp.error || '' });
    }
  });
})();
