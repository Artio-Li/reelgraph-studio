import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles, CheckCircle2, AlertTriangle, Loader2, Copy, ArrowRight, Puzzle } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, useToast, Spinner } from '../components/ui.jsx';

/**
 * 绑定页：/bind/<code>
 *
 * 两种进入方式：
 *  1. 已装扩展：content.js 自动读取 muse.ai cookie 并提交，页面只需轮询状态。
 *  2. 没装扩展：页面提示安装，并保留「粘贴 Cookie」兜底入口。
 */
export default function Bind() {
  const { code } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState('waiting'); // waiting | done | error | expired | missing
  const [message, setMessage] = useState('');
  const [extDetected, setExtDetected] = useState(false);
  const [account, setAccount] = useState(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  // 监听扩展回传的结果
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.source !== 'museapi-video-ext') return;
      if (d.type === 'done') {
        setStatus('done');
        setMessage(d.warning || '绑定成功');
        setAccount({ label: d.label });
      } else if (d.type === 'error') {
        setStatus('error');
        setMessage(d.message || '绑定失败');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 轮询绑定码状态（扩展直接 POST 后，服务端状态会变化）
  useEffect(() => {
    if (!code) return undefined;

    const checkExt = () => {
      if (document.documentElement.getAttribute('data-museapi-video-ext') === '1') setExtDetected(true);
    };
    const t = setTimeout(checkExt, 600);

    const poll = async () => {
      try {
        const out = await api.bindStatus(code);
        if (out.status === 'done') {
          setStatus('done');
          setMessage(out.message || '绑定成功');
          setAccount((a) => a || { label: out.label });
          return;
        }
        if (out.status === 'expired') {
          setStatus('expired');
          setMessage('绑定码已过期，请回到平台重新生成');
          return;
        }
      } catch (e) {
        if (e.status === 404) {
          setStatus('missing');
          setMessage('绑定码不存在，可能是链接复制不全');
        }
      }
      timer.current = setTimeout(poll, 2000);
    };
    poll();

    return () => {
      clearTimeout(t);
      clearTimeout(timer.current);
    };
  }, [code]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('复制失败，请手动选中', 'error');
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-ink-950 px-4 py-10">
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-brand-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />

      <div className="relative w-full max-w-[440px] fade-in">
        <div className="mb-6 flex flex-col items-center gap-2.5">
          <div className="grid h-12 w-12 place-items-center rounded-2xl brand-gradient shadow-xl shadow-brand-600/30">
            <Sparkles size={22} className="text-white" />
          </div>
          <h1 className="text-[19px] font-semibold tracking-tight text-white">绑定 muse.ai 账号</h1>
          <p className="text-[12.5px] text-mist-400">浏览器扩展会自动读取登录态，无需 F12</p>
        </div>

        <div className="card p-6">
          {/* 绑定码 */}
          <div className="mb-4 rounded-xl bg-ink-900 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">绑定码</span>
              <button
                onClick={copyCode}
                className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300"
              >
                <Copy size={11} /> {copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-[13px] text-mist-200">{code}</p>
          </div>

          {/* 状态 */}
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
            {status === 'waiting' && (
              <div className="flex items-start gap-3">
                <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-brand-400" />
                <div>
                  <p className="text-[13px] font-medium text-mist-200">
                    {extDetected ? '已连接扩展，正在读取 muse.ai 登录态…' : '等待浏览器扩展…'}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-mist-400">
                    {extDetected
                      ? '如果一直停在这里，多半是这个浏览器没登录 muse.ai。登录后刷新本页。'
                      : '这个页面需要「ReelGraph Studio 绑定」扩展才能自动读取。没装的话看下面的说明。'}
                  </p>
                </div>
              </div>
            )}

            {status === 'done' && (
              <div className="flex items-start gap-3">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-[13px] font-medium text-emerald-300">绑定成功</p>
                  {account?.label && (
                    <p className="mt-1 text-[11.5px] text-mist-400">账号：{account.label}</p>
                  )}
                  {message && <p className="mt-1 text-[11.5px] text-mist-400">{message}</p>}
                  <Button size="sm" className="mt-3" onClick={() => nav('/accounts')}>
                    去账号管理 <ArrowRight size={13} />
                  </Button>
                </div>
              </div>
            )}

            {(status === 'error' || status === 'expired' || status === 'missing') && (
              <div className="flex items-start gap-3">
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose-400" />
                <div>
                  <p className="text-[13px] font-medium text-rose-300">
                    {status === 'expired' ? '绑定码已过期' : status === 'missing' ? '绑定码无效' : '绑定失败'}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-mist-400">{message}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => nav('/accounts')}>
                    回账号管理重试
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 没装扩展时的说明 */}
          {!extDetected && status === 'waiting' && (
            <div className="mt-4 rounded-xl border border-ink-700 p-3.5">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-mist-200">
                <Puzzle size={13} className="text-brand-400" /> 没装扩展？
              </p>
              <ol className="mt-2 space-y-1 pl-4 text-[11.5px] leading-relaxed text-mist-400" style={{ listStyle: 'decimal' }}>
                <li>下载扩展包并解压</li>
                <li>Chrome 打开 <code className="rounded bg-ink-700 px-1">chrome://extensions</code>，打开右上角「开发者模式」</li>
                <li>点「加载已解压的扩展程序」，选解压出来的文件夹</li>
                <li>回到本页刷新，扩展会自动完成绑定</li>
              </ol>
              <a href="/download/reelgraph-studio-extension.zip" download>
                <Button size="sm" variant="soft" className="mt-3 w-full">下载扩展包</Button>
              </a>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-500">
          扩展只读取 muse.ai 的 Cookie 并提交到本平台，不上传任何第三方
        </p>
      </div>
    </div>
  );
}
