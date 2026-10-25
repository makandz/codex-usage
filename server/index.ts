import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Importer } from './importer.ts';
import { UsageStore } from './store.ts';
import { renderSnapshot } from './snapshot.ts';

/** Resolve the platform's storage location, honoring an explicit data directory. */
function dataDirectory(): string {
  if (process.env.CODEX_USAGE_DATA_DIR !== undefined) {
    return resolve(process.env.CODEX_USAGE_DATA_DIR);
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'codex-usage');
  }

  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return resolve(dataHome, 'codex-usage');
}

/** Import usage and replace the dashboard only after the new snapshot has been written. */
async function generateDashboard(root: string, home: string, directory: string): Promise<string> {
  const store = new UsageStore(join(directory, 'usage.sqlite'));
  const filename = join(directory, 'dashboard.html');

  try {
    const importer = new Importer(store, home);
    console.log('Importing Codex usage…');
    await importer.refresh();

    if (importer.status.error) {
      console.warn(`Import failed: ${importer.status.error}. Showing saved usage.`);
    }

    const template = await readFile(join(root, 'dist/index.html'), 'utf8');
    const html = renderSnapshot(template, store, importer.status);
    const temporary = `${filename}.${process.pid}.tmp`;
    await writeFile(temporary, html, { mode: 0o600 });
    await rename(temporary, filename);
    return filename;
  } finally {
    store.close();
  }
}

/** Open the snapshot with the system browser without keeping the CLI process alive. */
function openDashboard(filename: string): void {
  let command = 'xdg-open';

  if (process.platform === 'darwin') {
    command = 'open';
  } else if (process.platform === 'win32') {
    command = 'explorer.exe';
  }

  const browser = spawn(command, [filename], { stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${filename} in your browser.`));
  browser.unref();
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const home = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const filename = await generateDashboard(root, home, dataDirectory());
console.log(`\n  Codex Usage  ${filename}\n  Run pnpm start again to update this snapshot.\n`);

if (!process.argv.includes('--no-open')) {
  openDashboard(filename);
}
