import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Bot, ChevronsLeft, ChevronsRight, Command, Cpu, Menu as MenuIcon, Moon, Search, Sun, User, X, Database, Sparkles, Settings as SettingsIcon, FolderPlus } from 'lucide-react';
import { NAV } from './nav';
import { useAi, useSettings, useUi } from '@/store';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { Kbd, Tooltip } from '../ui/primitives';
import { Menu, MenuItem, toast } from '../ui/overlay';

export function AppShell() {
  const { settings, update } = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const { mobileNav, setMobileNav, setPalette } = useUi();
  const loc = useLocation();
  const refreshAi = useAi((s) => s.refresh);

  useEffect(() => setMobileNav(false), [loc.pathname, setMobileNav]);
  useEffect(() => {
    void refreshAi();
    const t = setInterval(() => void refreshAi(), 30000);
    return () => clearInterval(t);
  }, [refreshAi, settings.aiProvider, settings.ollamaUrl, settings.ollamaModel]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setPalette]);

  const current = NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)));

  return (
    <div className="flex h-full">
      {mobileNav && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileNav(false)} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar transition-[width,transform] duration-200 lg:static lg:translate-x-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-[240px]',
          'w-[240px]',
          mobileNav ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        <div className={cn('flex h-14 items-center gap-2.5 border-b border-border px-4', collapsed && 'lg:justify-center lg:px-0')}>
          <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0" />
          <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
            <p className="truncate text-[14px] font-semibold tracking-tight">CodePilot AI</p>
            <p className="truncate text-[10.5px] text-subtle">Programming companion</p>
          </div>
          <button className="ml-auto text-muted lg:hidden" aria-label="Close navigation" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
          {NAV.map((n, i) => (
            <div key={n.to}>
              {i === 8 && <div className="my-2 border-t border-border" />}
              <NavLink
                to={n.to}
                end={n.to === '/'}
                title={collapsed ? n.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-primary-soft text-fg' : 'text-muted hover:bg-elevated hover:text-fg',
                    collapsed && 'lg:justify-center lg:px-0',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <n.icon size={17} className={cn('shrink-0', isActive ? 'text-primary' : '')} />
                    <span className={cn('truncate', collapsed && 'lg:hidden')}>{n.label}</span>
                  </>
                )}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="hidden border-t border-border p-2.5 lg:block">
          <button
            onClick={() => update({ sidebarCollapsed: !collapsed }).catch(() => undefined)}
            className={cn('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-muted hover:bg-elevated hover:text-fg', collapsed && 'justify-center px-0')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      <a href="#main-content" className="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to main content
      </a>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={current?.label ?? 'CodePilot AI'} />
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
          <div key={loc.pathname} className="mx-auto w-full max-w-[1600px] p-4 animate-fade-in sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}

function Topbar({ title }: { title: string }) {
  const { settings, update } = useSettings();
  const setMobileNav = useUi((s) => s.setMobileNav);
  const setPalette = useUi((s) => s.setPalette);
  const nav = useNavigate();
  const [profile, setProfile] = useState('Local Developer');
  useEffect(() => {
    api.get<{ name?: string }>('/profile').then((p) => setProfile(p?.name || 'Local Developer')).catch(() => undefined);
  }, []);
  const dark = settings.theme !== 'light';
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur sm:px-6">
      <button className="text-muted lg:hidden" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
        <MenuIcon size={20} />
      </button>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-subtle">
          Local workspace <span className="mx-1">/</span> <span className="font-medium text-fg">{title}</span>
        </p>
      </div>
      <button
        onClick={() => setPalette(true)}
        className="ml-auto hidden h-8 w-[300px] items-center gap-2 rounded-lg border border-border bg-panel px-3 text-[13px] text-subtle transition-colors hover:border-border-strong md:flex"
        aria-label="Open command palette"
      >
        <Search size={14} /> Search tools & commands…
        <span className="ml-auto flex gap-0.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <button className="ml-auto text-muted md:hidden" aria-label="Search" onClick={() => setPalette(true)}>
        <Search size={18} />
      </button>
      <AiStatusPill />
      <Tooltip label={dark ? 'Switch to light theme' : 'Switch to dark theme'} side="bottom">
        <button aria-label="Toggle theme" onClick={() => update({ theme: dark ? 'light' : 'dark' }).catch(() => undefined)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-fg">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </Tooltip>
      <Menu
        trigger={(_o, toggle) => (
          <button onClick={toggle} aria-label="Workspace menu" className="flex h-8 items-center gap-2 rounded-lg pr-1 pl-1 hover:bg-elevated">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary to-secondary text-[11px] font-semibold text-primary-fg">{profile.slice(0, 2).toUpperCase()}</span>
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="border-b border-border px-2.5 py-2">
              <p className="text-[13px] font-medium">{profile}</p>
              <p className="text-[11px] text-subtle">Local profile · data stays on this computer</p>
            </div>
            <MenuItem icon={FolderPlus} onClick={() => { close(); nav('/workspace'); }}>My workspace</MenuItem>
            <MenuItem icon={Database} onClick={() => { close(); nav('/settings#data'); }}>Data & backups</MenuItem>
            <MenuItem icon={SettingsIcon} onClick={() => { close(); nav('/settings'); }}>Settings</MenuItem>
            <MenuItem icon={User} onClick={() => { close(); nav('/settings#profile'); }}>Edit profile</MenuItem>
          </>
        )}
      </Menu>
    </header>
  );
}

function AiStatusPill() {
  const status = useAi((s) => s.status);
  const mode = useSettings((s) => s.settings.aiProvider);
  const nav = useNavigate();
  let label = 'Offline mode';
  let tone = 'bg-elevated text-muted border-border';
  let tip = 'Using the offline rule-based engine. Enable Local AI (Ollama) in Settings.';
  let Icon = Cpu;
  if (mode === 'ollama') {
    Icon = Bot;
    if (!status) {
      label = 'Checking AI…';
    } else if (!status.reachable) {
      label = 'Ollama offline';
      tone = 'bg-warning-soft text-warning border-warning/30';
      tip = status.error ?? 'Ollama is not reachable';
    } else if (!status.modelInstalled) {
      label = 'No model selected';
      tone = 'bg-warning-soft text-warning border-warning/30';
      tip = 'Choose an installed model in Settings';
    } else {
      label = status.selectedModel;
      tone = 'bg-success-soft text-success border-success/30';
      tip = `Local AI connected (Ollama ${status.version})`;
    }
  }
  return (
    <Tooltip label={tip} side="bottom">
      <button onClick={() => nav('/settings#ai')} className={cn('hidden h-7 max-w-[180px] items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium sm:flex', tone)} aria-label={`AI status: ${label}`}>
        <span className="relative flex h-1.5 w-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', mode === 'ollama' && status?.modelInstalled ? 'bg-success' : mode === 'ollama' ? 'bg-warning' : 'bg-subtle')} />
        </span>
        <Icon size={13} />
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  );
}

function CommandPalette() {
  const { paletteOpen, setPalette } = useUi();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const { settings, update } = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const cmds = [
      ...NAV.map((n) => ({ id: n.to, label: `Go to ${n.label}`, hint: n.description, icon: n.icon, run: () => nav(n.to), keys: `${n.label} ${n.keywords}` })),
      { id: 'theme', label: `Switch to ${settings.theme === 'light' ? 'dark' : 'light'} theme`, hint: 'Appearance', icon: settings.theme === 'light' ? Moon : Sun, run: () => update({ theme: settings.theme === 'light' ? 'dark' : 'light' }), keys: 'theme dark light' },
      { id: 'new-project', label: 'Create a new project', hint: 'My Workspace', icon: FolderPlus, run: () => nav('/workspace?new=1'), keys: 'new project create' },
      { id: 'quiz', label: 'Start an MCQ quiz', hint: 'Learning Hub', icon: Sparkles, run: () => nav('/learning'), keys: 'quiz mcq test' },
      { id: 'demo', label: 'Load demonstration data', hint: 'Dashboard', icon: Database, run: async () => { await api.post('/demo/load'); toast.success('Demo data loaded'); nav('/'); }, keys: 'demo sample data' },
      ...['bubble-sort', 'binary-search', 'merge-sort', 'quick-sort', 'bfs', 'dijkstra', 'bst', 'kadane'].map((a) => ({ id: `alg-${a}`, label: `Visualise ${a.replace(/-/g, ' ')}`, hint: 'Algorithm Studio', icon: Command, run: () => nav(`/studio?algo=${a}`), keys: `${a} algorithm visualize` })),
    ];
    const t = q.toLowerCase().trim();
    return t ? cmds.filter((c) => `${c.label} ${c.keys}`.toLowerCase().includes(t)) : cmds;
  }, [q, nav, settings.theme, update]);
  useEffect(() => {
    if (paletteOpen) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [paletteOpen]);
  if (!paletteOpen) return null;
  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    setPalette(false);
    void it.run();
  };
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setPalette(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-scale-in">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') run(sel);
              else if (e.key === 'Escape') setPalette(false);
            }}
            placeholder="Type a command or tool name…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            aria-label="Command"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matching commands</li>}
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === sel}>
              <button onMouseEnter={() => setSel(i)} onClick={() => run(i)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === sel ? 'bg-primary-soft' : '')}>
                <it.icon size={16} className={i === sel ? 'text-primary' : 'text-muted'} />
                <span className="flex-1 text-[13px] text-fg">{it.label}</span>
                <span className="text-[11px] text-subtle">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
