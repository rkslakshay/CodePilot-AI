import { forwardRef, useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:brightness-110 shadow-[0_0_0_1px_rgb(255_255_255/0.06)_inset,0_6px_20px_-8px_var(--primary)]',
  secondary: 'bg-elevated text-fg border border-border hover:border-border-strong hover:bg-elevated/80',
  outline: 'border border-border text-fg hover:bg-elevated hover:border-border-strong',
  ghost: 'text-muted hover:text-fg hover:bg-elevated',
  danger: 'bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20',
  success: 'bg-success-soft text-success border border-success/30 hover:bg-success/20',
};
const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg justify-center',
  'icon-sm': 'h-7 w-7 rounded-md justify-center',
};
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, iconRight: IconR, className, children, disabled, type = 'button', ...rest }, ref) {
  const isz = size === 'xs' || size === 'icon-sm' ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('inline-flex shrink-0 select-none items-center font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50', VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {loading ? <Loader2 size={isz} className="animate-spin" /> : Icon ? <Icon size={isz} strokeWidth={2} /> : null}
      {children}
      {IconR && !loading ? <IconR size={isz} strokeWidth={2} /> : null}
    </button>
  );
});

// ---------------------------------------------------------------- Tooltip
export function Tooltip({ label, children, side = 'top', className }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'right' | 'left'; className?: string }) {
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  }[side];
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span role="tooltip" className={cn('pointer-events-none absolute z-50 hidden w-max max-w-xs rounded-md border border-border bg-elevated px-2 py-1 text-xs text-fg shadow-lg animate-[tt-in_150ms_ease-out_200ms_both] group-hover/tt:block group-focus-within/tt:block', pos)}>
        {label}
      </span>
    </span>
  );
}

export function IconButton({ icon: Icon, label, side, size = 'icon', variant = 'ghost', ...rest }: Omit<ButtonProps, 'children' | 'icon'> & { icon: LucideIcon; label: string; side?: 'top' | 'bottom' | 'right' | 'left' }) {
  return (
    <Tooltip label={label} side={side}>
      <Button aria-label={label} size={size} variant={variant} icon={Icon} {...rest} />
    </Tooltip>
  );
}

// ---------------------------------------------------------------- Card
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 rounded-xl border border-border bg-card shadow-panel', className)} {...rest} />;
}
export function CardHeader({ title, subtitle, icon: Icon, actions, className }: { title: ReactNode; subtitle?: ReactNode; icon?: LucideIcon; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Icon size={15} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[13.5px] font-semibold text-fg">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
type Tone = 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
const TONES: Record<Tone, string> = {
  neutral: 'bg-elevated text-muted border-border',
  primary: 'bg-primary-soft text-primary border-primary/25',
  secondary: 'bg-secondary-soft text-secondary border-secondary/25',
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
};
export function Badge({ tone = 'neutral', className, children, icon: Icon }: { tone?: Tone; className?: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-4', TONES[tone], className)}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- form controls
const controlBase = 'rounded-lg border border-border bg-panel text-fg placeholder:text-subtle transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60';
/** Full width unless the caller sets its own width (clsx does not resolve conflicting utilities). */
const control = (className?: string) => cn(/(^|\s)w-/.test(className ?? '') ? '' : 'w-full', controlBase);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control(className), 'h-9 px-3 text-sm', className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control(className), 'min-h-[80px] resize-y px-3 py-2 text-sm leading-relaxed', className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(control(className), 'h-9 cursor-pointer appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8 pl-3 text-sm', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23929bad' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; id?: string }) {
  const gen = useId();
  return (
    <button
      id={id ?? gen}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50', checked ? 'border-primary bg-primary' : 'border-border-strong bg-elevated')}
    >
      <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: LucideIcon }[]; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex rounded-lg border border-border bg-panel p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
            value === o.value ? 'bg-elevated text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon && <o.icon size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({ value, onChange, tabs, className, right }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; icon?: LucideIcon; count?: number }[]; className?: string; right?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 border-b border-border', className)}>
      <div role="tablist" className="-mb-px flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn('inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium whitespace-nowrap transition-colors', value === t.value ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.icon && <t.icon size={14} />}
            {t.label}
            {t.count !== undefined && <span className="rounded bg-elevated px-1.5 text-[11px] text-muted">{t.count}</span>}
          </button>
        ))}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5 pb-1">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- feedback
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-primary', className)} aria-label="Loading" />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}
export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-border bg-elevated text-muted">
        <Icon size={22} />
      </div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Alert({ tone = 'info', title, children, icon: Icon, className, action }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'primary'; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; className?: string; action?: ReactNode }) {
  const t = { info: 'border-info/25 bg-info-soft text-info', warning: 'border-warning/25 bg-warning-soft text-warning', danger: 'border-danger/25 bg-danger-soft text-danger', success: 'border-success/25 bg-success-soft text-success', primary: 'border-primary/25 bg-primary-soft text-primary' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border px-3.5 py-3', t, className)}>
      {Icon && <Icon size={17} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1 text-[13px]">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('leading-relaxed text-fg/85', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function Stat({ label, value, icon: Icon, hint, tone = 'primary' }: { label: string; value: ReactNode; icon: LucideIcon; hint?: ReactNode; tone?: 'primary' | 'secondary' | 'info' | 'warning' }) {
  const t = { primary: 'bg-primary-soft text-primary', secondary: 'bg-secondary-soft text-secondary', info: 'bg-info-soft text-info', warning: 'bg-warning-soft text-warning' }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg', t)}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </Card>
  );
}

export function PageHeader({ title, description, icon: Icon, actions }: { title: string; description?: ReactNode; icon?: LucideIcon; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary-soft text-primary">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = true, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[13px] font-semibold text-fg">
        <span className="flex items-center gap-2">
          <span className={cn('text-muted transition-transform', open ? 'rotate-90' : '')}>›</span>
          {title}
        </span>
        {right}
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}
