import { clsx } from 'clsx';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ------------------------------- Button ------------------------------- */
export function Button({ variant = 'primary', size = 'md', className, loading, children, ...rest }) {
  const base =
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all duration-150 disabled:opacity-45 disabled:cursor-not-allowed select-none';
  const sizes = {
    xs: 'h-7 px-2.5 text-[11.5px] rounded-lg',
    sm: 'h-8 px-3 text-[12.5px]',
    md: 'h-10 px-4 text-[13.5px]',
    lg: 'h-11 px-5 text-[14.5px]',
  };
  const variants = {
    primary:
      'brand-gradient text-white hover:brightness-110 active:scale-[.985]',
    ghost: 'text-mist-300 hover:text-mist-100 hover:bg-ink-750/80',
    outline: 'border border-ink-600/80 bg-ink-900/40 text-mist-200 hover:border-brand-500/50 hover:text-mist-100 hover:bg-ink-800/80',
    danger: 'bg-rose-500/12 text-rose-300 border border-rose-500/30 hover:bg-rose-500/22',
    soft: 'bg-ink-750 text-mist-200 border border-ink-600/50 hover:bg-ink-700 hover:text-mist-100',
  };
  return (
    <button
      className={clsx(base, sizes[size] || sizes.md, variants[variant] || variants.primary, className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

export function Spinner({ size = 16, className }) {
  return (
    <svg
      className={clsx('animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".22" strokeWidth="2.8" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------- Input -------------------------------- */
export function Field({ label, hint, extra, children, className }) {
  return (
    <div className={clsx('block', className)}>
      {(label || extra) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label && <span className="text-[12.5px] font-medium text-mist-200">{label}</span>}
          {extra}
        </div>
      )}
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-relaxed text-mist-400">{hint}</span>}
    </div>
  );
}

const inputCls =
  'w-full rounded-xl bg-ink-900/85 border border-ink-700 px-3.5 py-2.5 text-[13px] text-mist-100 placeholder:text-mist-500 outline-none transition duration-150 focus:border-brand-500/70 focus:bg-ink-900 focus:ring-2 focus:ring-brand-500/15';

export function Input({ className, ...rest }) {
  return <input className={clsx(inputCls, className)} {...rest} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea className={clsx(inputCls, 'resize-y leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={clsx(inputCls, 'cursor-pointer', className)} {...rest}>
      {children}
    </select>
  );
}

/* -------------------------------- Badge -------------------------------- */
export function Badge({ tone = 'neutral', children, className }) {
  const tones = {
    neutral: 'bg-ink-750 text-mist-300 border border-ink-600/60',
    ok: 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/25',
    warn: 'bg-amber-500/12 text-amber-300 border border-amber-500/25',
    error: 'bg-rose-500/12 text-rose-300 border border-rose-500/25',
    brand: 'bg-brand-500/12 text-brand-300 border border-brand-500/30',
    violet: 'bg-violet-500/12 text-violet-300 border border-violet-500/25',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        tones[tone] || tones.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------- Modal -------------------------------- */
export function Modal({ open, onClose, title, subtitle, children, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/72 backdrop-blur-md transition-opacity" onClick={onClose} />
      <div className={clsx('card relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden fade-in shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-ink-700/80 bg-ink-850/60 px-5 py-3.5">
          <div>
            <h3 className="text-[15px] font-semibold text-mist-100">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[11.5px] text-mist-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 transition hover:bg-ink-700 hover:text-mist-100">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------- Toast -------------------------------- */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((msg, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((arr) => [...arr, { id, msg, tone }]);
    setTimeout(() => setItems((arr) => arr.filter((i) => i.id !== id)), 4200);
  }, []);

  const tones = {
    info: { cls: 'border-ink-600 bg-ink-800/95 text-mist-100', Icon: Info, iconCls: 'text-sky-400' },
    ok: { cls: 'border-emerald-500/35 bg-ink-850/95 text-emerald-200', Icon: CheckCircle2, iconCls: 'text-emerald-400' },
    error: { cls: 'border-rose-500/35 bg-ink-850/95 text-rose-200', Icon: AlertCircle, iconCls: 'text-rose-400' },
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-5 top-[78px] z-[70] flex w-full max-w-sm flex-col items-end gap-2">
        {items.map((i) => {
          const cfg = tones[i.tone] || tones.info;
          const Icon = cfg.Icon;
          return (
            <div
              key={i.id}
              className={clsx(
                'pointer-events-auto fade-in flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-2xl backdrop-blur-xl',
                cfg.cls,
              )}
            >
              <Icon size={16} className={clsx('mt-0.5 shrink-0', cfg.iconCls)} />
              <span className="min-w-0 flex-1 leading-snug">{i.msg}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ------------------------------- Empty ------------------------------- */
export function Empty({ icon: Icon, title, desc, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {Icon && (
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-ink-700 bg-ink-800/80 text-brand-400 shadow-inner">
          <Icon size={23} />
        </div>
      )}
      <div>
        <p className="text-[15px] font-medium text-mist-100">{title}</p>
        {desc && <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-mist-400">{desc}</p>}
      </div>
      {action}
    </div>
  );
}
