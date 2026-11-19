import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The e2e server serves client/dist; fail early with a clear message if it has not been built. */
export default function globalSetup() {
  const dist = join(__dirname, '..', 'client', 'dist', 'index.html');
  if (!existsSync(dist)) throw new Error('client/dist is missing. Run `npm run build -w client` (or `npm run e2e`, which builds first).');
  const src = join(__dirname, '..', 'client', 'src');
  const newest = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(join(d, e.name)) : statSync(join(d, e.name)).mtimeMs), 0);
  if (newest(src) > statSync(dist).mtimeMs) console.warn('[e2e] client/src is newer than client/dist — run `npm run build -w client` to test the latest UI.');
}
