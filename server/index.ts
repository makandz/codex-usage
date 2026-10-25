import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Importer } from './importer.ts';
import { UsageStore } from './store.ts';
import { report } from './report.ts';
import type { Range } from '../shared/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = resolve(root, 'dist');
const home = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const data = process.env.CODEX_USAGE_DATA_DIR ?? (process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'codex-usage')
  : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'codex-usage'));
const store = new UsageStore(join(data, 'usage.sqlite'));
const importer = new Importer(store, home);
const ranges = new Set<string>(['24h', '7d', '30d', '90d', 'all']);
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const requestedPort = Number(process.env.PORT ?? 4318);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid PORT.');

const server = createServer(async (req, res) => {
  const address = server.address();
  const localPort = address && typeof address === 'object' ? address.port : requestedPort;
  const hosts = new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`]);
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  if (!hosts.has(req.headers.host ?? '')) { reply(403, { error: 'Local requests only.' }); return; }
  if (req.headers.origin && ![...hosts].some(host => req.headers.origin === `http://${host}`)) {
    reply(403, { error: 'Invalid origin.' }); return;
  }
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${localPort}`);
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      void importer.refresh(); reply(202, importer.status); return;
    }
    if (req.method !== 'GET') { reply(405, { error: 'Method not allowed.' }); return; }
    if (url.pathname === '/api/usage') {
      const range = url.searchParams.get('range') ?? '30d';
      if (!ranges.has(range)) { reply(400, { error: 'Invalid date range.' }); return; }
      reply(200, report(store, range as Range, importer.status)); return;
    }
    if (url.pathname.startsWith('/api/')) { reply(404, { error: 'Unknown endpoint.' }); return; }
    const path = resolve(assets, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(assets + sep) || !existsSync(path) || !(await stat(path)).isFile()) {
      reply(404, { error: 'Not found.' }); return;
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!res.headersSent) reply(500, { error: 'Could not load usage. See the terminal for details.' });
    else res.destroy();
  }
});

server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`\n  Codex Usage  ${url}\n  Data: ${data}\n  Press Ctrl+C to stop.\n`);
  void importer.refresh();
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const browser = spawn(command, [url], { stdio: 'ignore' });
    browser.on('error', () => console.log(`Open ${url} in your browser.`));
    browser.unref();
  }
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close(); server.closeAllConnections();
  await importer.current;
  store.close();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
