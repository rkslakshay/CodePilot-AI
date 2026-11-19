import { z } from 'zod';
import { getDb, PROFILE_ID } from '../database/db.js';

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?\/?$/i;

export const SettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  accent: z.enum(['violet', 'teal', 'blue', 'amber']),
  defaultLanguage: z.enum(['c', 'cpp', 'java', 'python', 'javascript']),
  editorFontSize: z.number().int().min(10).max(28),
  editorTheme: z.enum(['codepilot-dark', 'vs-dark', 'vs', 'hc-black']),
  tabSize: z.number().int().min(2).max(8),
  wordWrap: z.boolean(),
  minimap: z.boolean(),
  aiProvider: z.enum(['offline', 'ollama']),
  ollamaUrl: z.string().regex(LOCAL_HOST, 'Only local Ollama addresses (localhost / 127.0.0.1) are allowed'),
  ollamaModel: z.string().max(200),
  aiTemperature: z.number().min(0).max(1.5),
  aiTimeoutSec: z.number().int().min(15).max(600),
  aiMaxTokens: z.number().int().min(256).max(8192),
  executionEnabled: z.boolean(),
  executionTimeoutMs: z.number().int().min(1000).max(15000),
  explanationMode: z.enum(['beginner', 'advanced']),
  sidebarCollapsed: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

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
  // Code execution is OFF until the user explicitly enables it after reading the safety notice.
  executionEnabled: false,
  executionTimeoutMs: 5000,
  explanationMode: 'beginner',
  sidebarCollapsed: false,
};

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings WHERE profile_id = ?').all(PROFILE_ID) as { key: string; value: string }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt value */
    }
  }
  const parsed = SettingsSchema.safeParse(out);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const merged = SettingsSchema.parse({ ...getSettings(), ...patch });
  const stmt = getDb().prepare(
    `INSERT INTO settings (profile_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  for (const k of Object.keys(patch) as (keyof Settings)[]) stmt.run(PROFILE_ID, k, JSON.stringify(merged[k]));
  return merged;
}

export function resetSettings(): Settings {
  getDb().prepare('DELETE FROM settings WHERE profile_id = ?').run(PROFILE_ID);
  return getSettings();
}

export function getProfile() {
  return getDb().prepare('SELECT id, name, created_at AS createdAt FROM profiles WHERE id = ?').get(PROFILE_ID) as { id: number; name: string; createdAt: string };
}

export function renameProfile(name: string) {
  getDb().prepare("UPDATE profiles SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, PROFILE_ID);
  return getProfile();
}
