import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ------------------------------- Button ------------------------------- */
export function Button({ variant = 'primary', size = 'md', className, loading, children, ...rest }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all disabled:opacity-45 disabled:cursor-not-allowed select-none';
  const sizes = {
    sm: 'h-8 px-3 text-[13px]',
    md: 'h-10 px-4 text-sm',
    lg: 'h-11 px-5 text-[15px]',
  };
  const variants = {
    primary:
      'brand-gradient text-white shadow-lg shadow-brand-600/25 hover:brightness-110 active:scale-[.985]',
    ghost: 'text-mist-300 hover:text-white hover:bg-ink-700/70',
    outline: 'border border-ink-600 text-mist-200 hover:border-ink-500 hover:bg-ink-800',
    danger: 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25',
    soft: 'bg-ink-700 text-mist-200 hover:bg-ink-600',
  };
  return (
    <button
      className={clsx(base, sizes[size], variants[variant], className)}
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
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------- Input -------------------------------- */
export function Field({ label, hint, children, className }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-mist-300">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-mist-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl bg-ink-900 border border-ink-700 px-3.5 py-2.5 text-sm text-mist-200 placeholder:text-ink-500 outline-none transition focus:border-brand-500/70 focus:ring-2 focus:ring-brand-500/15';

export function Input({ className, ...rest }) {
  return <input className={clsx(inputCls, className)} {...rest} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea className={clsx(inputCls, 'resize-none leading-relaxed', className)} {...rest} />;
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
    neutral: 'bg-ink-700 text-mist-300',
    ok: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
    warn: 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
    error: 'bg-rose-500/15 text-rose-300 border border-rose-500/25',
    brand: 'bg-brand-500/15 text-brand-400 border border-brand-500/30',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------- Modal -------------------------------- */
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('card relative w-full fade-in shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
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
    info: 'border-ink-600 bg-ink-800 text-mist-200',
    ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    error: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-5 top-[84px] z-[60] flex w-full max-w-sm flex-col items-end gap-2">
        {items.map((i) => (
          <div
            key={i.id}
            className={clsx('fade-in w-full rounded-xl border px-4 py-2.5 text-sm shadow-xl', tones[i.tone])}
          >
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ------------------------------- Empty ------------------------------- */
export function Empty({ icon: Icon, title, desc, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      {Icon && (
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 text-mist-400">
          <Icon size={24} />
        </div>
      )}
      <div>
        <p className="text-[15px] font-medium text-mist-200">{title}</p>
        {desc && <p className="mt-1 text-[13px] text-mist-400">{desc}</p>}
      </div>
      {action}
    </div>
  );
}
