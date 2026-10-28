// Publish only the self-contained frontend pages, using the bundled sample brain.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, ['build.mjs'], {
  cwd: root,
  env: { ...process.env, AO_BRAIN: './brain' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const output = new URL('../dist/vercel/', import.meta.url);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const portal = readFileSync(new URL('../dist/portal.html', import.meta.url), 'utf8');
const office = readFileSync(new URL('../dist/command-centre-v2.html', import.meta.url), 'utf8');
writeFileSync(new URL('index.html', output), portal);
writeFileSync(new URL('command-centre-v2.html', output), office);
writeFileSync(new URL('dark.html', output), office.replace('<body>', '<body class="dark">'));
console.log('Built Vercel frontend in dist/vercel');
