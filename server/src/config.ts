import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  appName: 'CodePilot AI',
  version: '3.0.0',
  host: '127.0.0.1',
  port: Number(process.env.CODEPILOT_PORT ?? 4317),
  dbPath: process.env.CODEPILOT_DB ?? join(serverRoot, 'data', 'codepilot.db'),
  backupDir: process.env.CODEPILOT_BACKUP_DIR ?? join(serverRoot, 'data', 'backups'),
  clientDist: resolve(serverRoot, '..', 'client', 'dist'),
  production: process.env.NODE_ENV === 'production',
  serverRoot,
};
