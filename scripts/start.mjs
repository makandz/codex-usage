import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

/** Find the latest modification in a file or source directory. */
async function latestModification(path) {
  const info = await stat(path);
  if (!info.isDirectory()) {
    return info.mtimeMs;
  }
  const children = await readdir(path);
  const timestamps = await Promise.all(children.map(child => latestModification(join(path, child))));
  return Math.max(info.mtimeMs, ...timestamps);
}

/** Run the installed build script, forwarding its output and exit status. */
async function runBuild() {
  const build = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  return new Promise(resolve => {
    build.on('exit', resolve);
    build.on('error', error => {
      console.error(error.message);
      resolve(1);
    });
  });
}

/** Rebuild on first launch or when sources are newer than either build output. */
async function buildIfNeeded() {
  let built = 0;
  try {
    const frontend = await stat('dist/index.html');
    const backend = await stat('build/server/index.js');
    built = Math.min(frontend.mtimeMs, backend.mtimeMs);
  } catch {
    // Missing build output is expected on the first launch.
  }
  const sources = [
    'src',
    'server',
    'shared',
    'public',
    'scripts/build.mjs',
    'index.html',
    'vite.config.ts',
    'package.json',
    'tsconfig.json',
    'tsconfig.server.json',
  ];
  const timestamps = await Promise.all(sources.map(latestModification));
  if (Math.max(...timestamps) <= built) {
    return;
  }
  console.log('Building Codex Usage…');
  const code = await runBuild();
  if (code !== 0) {
    process.exit(typeof code === 'number' ? code : 1);
  }
}

await buildIfNeeded();
await import('../build/server/index.js');
