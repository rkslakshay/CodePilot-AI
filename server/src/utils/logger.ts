const quiet = process.env.NODE_ENV === 'test' || process.env.VITEST;
const ts = () => new Date().toISOString().slice(11, 19);
export const log = {
  info: (...a: unknown[]) => !quiet && console.log(`[${ts()}]`, ...a),
  warn: (...a: unknown[]) => !quiet && console.warn(`[${ts()}] WARN`, ...a),
  error: (...a: unknown[]) => console.error(`[${ts()}] ERROR`, ...a),
};
