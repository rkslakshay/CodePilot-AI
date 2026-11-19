import { createApp } from './app.js';
import { openDatabase, closeDatabase, getDbPath } from './database/db.js';
import { config } from './config.js';
import { detectRuntimes } from './execution/runtimes.js';
import { sandboxStatus } from './execution/sandbox.js';
import { getLibrary } from './services/library.js';
import { log } from './utils/logger.js';

openDatabase();
const runtimes = detectRuntimes();
const sandbox = sandboxStatus(); // builds/self-tests the Windows sandbox and protects the data folder
getLibrary(); // warm the algorithm library cache

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  log.info(`${config.appName} API listening on http://${config.host}:${config.port}`);
  log.info(`Database: ${getDbPath()}`);
  log.info(`Execution isolation: ${sandbox.level}${sandbox.dataProtected ? ' (data folder protected)' : ''}`);
  log.info(`Runtimes: ${runtimes.map((r) => `${r.label} ${r.available ? '✓' : '✗'}`).join('  ')}`);
  if (config.production) log.info(`Open http://localhost:${config.port} in your browser.`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') log.error(`Port ${config.port} is already in use. Set CODEPILOT_PORT to use another port.`);
  else log.error(e);
  process.exit(1);
});

const shutdown = () => {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
