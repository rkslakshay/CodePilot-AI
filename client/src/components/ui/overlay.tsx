import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Button } from './primitives';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- Dialog
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not([aria-label="Close"])')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cn('relative flex max-h-[90vh] w-full flex-col rounded-2xl border border-border bg-card shadow-2xl animate-scale-in', w)}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-elevated hover:text-fg">
            <X size={16} />
          </button>
        </div>
        {children && <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        {!children && !footer && <div className="h-4" />}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Confirm (promise based)
interface ConfirmOpts {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}
interface ConfirmState {
  opts: (ConfirmOpts & { resolve: (v: boolean) => void }) | null;
  ask: (o: ConfirmOpts) => Promise<boolean>;
  close: (v: boolean) => void;
}
const useConfirmStore = create<ConfirmState>((set, get) => ({
  opts: null,
  ask: (o) => new Promise<boolean>((resolve) => set({ opts: { ...o, resolve } })),
  close: (v) => {
    get().opts?.resolve(v);
    set({ opts: null });
  },
}));
export const confirmAction = (o: ConfirmOpts) => useConfirmStore.getState().ask(o);

export function ConfirmHost() {
  const { opts, close } = useConfirmStore();
  return (
    <Dialog
      open={!!opts}
      onClose={() => close(false)}
      title={opts?.title ?? ''}
      description={opts?.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={opts?.tone === 'primary' ? 'primary' : 'danger'} onClick={() => close(true)} data-autofocus>
            {opts?.confirmLabel ?? 'Delete'}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------- Toasts
type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}
interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  remove: (id: number) => void;
}
let tid = 0;
const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = ++tid;
    set({ items: [...get().items.slice(-3), { ...t, id }] });
    setTimeout(() => get().remove(id), t.tone === 'error' ? 6500 : 3500);
  },
  remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));
export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useToasts.getState().push({ tone: 'error', title, description }),
  info: (title: string, description?: string) => useToasts.getState().push({ tone: 'info', title, description }),
  warning: (title: string, description?: string) => useToasts.getState().push({ tone: 'warning', title, description }),
};

export function Toaster() {
  const { items, remove } = useToasts();
  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const color = { success: 'text-success', error: 'text-danger', info: 'text-info', warning: 'text-warning' };
  return createPortal(
    <div className="pointer-events-none fixed right-4 bottom-4 z-[200] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {items.map((t) => {
        const I = icon[t.tone];
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex gap-3 rounded-xl border border-border bg-elevated px-3.5 py-3 shadow-2xl animate-fade-in">
            <I size={17} className={cn('mt-0.5 shrink-0', color[t.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.description}</p>}
            </div>
            <button aria-label="Dismiss" onClick={() => remove(t.id)} className="self-start text-subtle hover:text-fg">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Menu
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div role="menu" className={cn('absolute top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-border bg-elevated p-1 shadow-2xl animate-scale-in', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ icon: Icon, children, onClick, danger }: { icon?: React.ComponentType<{ size?: number }>; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-card', danger ? 'text-danger' : 'text-fg')}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}
