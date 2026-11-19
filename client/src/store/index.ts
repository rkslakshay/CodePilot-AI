import { create } from 'zustand';
import { api } from '@/lib/api';
import type { AiStatus, Lang, Settings } from '@/lib/types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'violet',
  defaultLanguage: 'python',
  editorFontSize: 14,
  editorTheme: 'codepilot-dark',
  tabSize: 4,
  wordWrap: false,
  minimap: false,
  aiProvider: 'offline',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',
  aiTemperature: 0.2,
  aiTimeoutSec: 180,
  aiMaxTokens: 2048,
  executionEnabled: false,
  executionTimeoutMs: 5000,
  explanationMode: 'beginner',
  sidebarCollapsed: false,
};

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<Settings>;
  setLocal: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const s = await api.get<Settings>('/settings');
      set({ settings: s, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    const prev = get().settings;
    set({ settings: { ...prev, ...patch } });
    try {
      const s = await api.put<Settings>('/settings', patch);
      set({ settings: s });
      return s;
    } catch (e) {
      set({ settings: prev });
      throw e;
    }
  },
  setLocal: (patch) => set({ settings: { ...get().settings, ...patch } }),
}));

interface AiState {
  status: AiStatus | null;
  checking: boolean;
  refresh: (force?: boolean) => Promise<void>;
}
export const useAi = create<AiState>((set) => ({
  status: null,
  checking: false,
  refresh: async (force = false) => {
    set({ checking: true });
    try {
      const s = await api.get<AiStatus>(`/ai/status${force ? '?refresh=1' : ''}`);
      set({ status: s });
    } catch {
      /* keep previous */
    } finally {
      set({ checking: false });
    }
  },
}));

/** Hand-off of code between tools ("Open in Explainer", "Run in Compiler", restore from history…). */
export interface Handoff {
  target: 'generator' | 'converter' | 'explainer' | 'compiler' | 'studio' | 'workspace';
  code: string;
  language: Lang;
  stdin?: string;
  extra?: Record<string, unknown>;
  at: number;
}
interface HandoffState {
  handoff: Handoff | null;
  send: (h: Omit<Handoff, 'at'>) => void;
  take: (target: Handoff['target']) => Handoff | null;
}
export const useHandoff = create<HandoffState>((set, get) => ({
  handoff: null,
  send: (h) => set({ handoff: { ...h, at: Date.now() } }),
  take: (target) => {
    const h = get().handoff;
    if (h && h.target === target) {
      set({ handoff: null });
      return h;
    }
    return null;
  },
}));

interface UiState {
  paletteOpen: boolean;
  setPalette: (v: boolean) => void;
  mobileNav: boolean;
  setMobileNav: (v: boolean) => void;
}
export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  setPalette: (v) => set({ paletteOpen: v }),
  mobileNav: false,
  setMobileNav: (v) => set({ mobileNav: v }),
}));
