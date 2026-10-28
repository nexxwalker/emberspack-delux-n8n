// Delux crew — cut a clean public release from this working copy.
//
//   node scripts/release.mjs                 → assembles dist/release/ (inspect it)
//   node scripts/release.mjs --push          → … and pushes `main` + a new tag to the public repo,
//                                              then creates a GitHub pre-release with a zip
//
// The working copy is the private source of truth (NOTES.md, shots, the vault-backed local config).
// The release is a fresh assembly: whitelisted files only, the Brain graph rebuilt from the SAMPLE
// brain (never from a private vault), the release .gitignore, and the publisher’s configured Git identity.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../config.mjs';

// Publishing requires an explicit destination; no personal repository or identity is baked in.
const REPOSITORY = process.env.RELEASE_REPOSITORY || '';
const PUBLIC = `git@github.com:${REPOSITORY}.git`;
const BRANCH = 'main'; // the repo page IS the product page
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TAG = 'v' + pkg.version;
const push = process.argv.includes('--push');
const OUT = path.join(ROOT, 'dist', 'release');
if (push && !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(REPOSITORY)) {
  throw new Error('Set RELEASE_REPOSITORY to the GitHub owner/repository to publish.');
}

const FILES = [
  'src',
  'assets/mcp/tiles',
  'assets/mcp/bake.py',
  'assets/mcp/rebake.py',
  'assets/ember-spark.png',
  'brain',
  'scripts/release.mjs',
  'scripts/build-vercel.mjs',
  'vercel.json',
  'accounts.mjs',
  'accounts.test.mjs',
  'theme.test.mjs',
  'build.mjs',
  'graph-build.mjs',
  'serve.mjs',
  'config.mjs',
  'mcp.mjs',
  'roster.mjs',
  'check.mjs',
  'setup',
  'package.json',
  'package-lock.json',
  'office.config.json',
  'office.agents.json',
  'skills.mjs',
  'skills',
  'learn.mjs',
  'onboard.mjs',
  'routines.mjs',
  'usage.mjs',
  'teams.mjs',
  'CLAUDE.md',
  'README.md',
  'SKILLS.md',
  'CHANGELOG.md',
  'LICENSE',
  'assets/readme-hero.jpg',
  'assets/readme-calendar.jpg',
];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
};

console.log('→ rebuilding the Brain graph from the SAMPLE brain');
run('node', ['build.mjs'], { cwd: ROOT, env: { ...process.env, AO_BRAIN: './brain' } });

console.log('→ assembling', path.relative(ROOT, OUT));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    console.log('  (skip, missing)', f);
    continue;
  }
  fs.cpSync(src, path.join(OUT, f), {
    recursive: true,
    filter: (p) => !/(^|\/)(Agents Office|\.DS_Store|node_modules)(\/|$)/.test(p),
  });
}
const ignore = fs.existsSync(path.join(ROOT, '.gitignore.release')) ? '.gitignore.release' : '.gitignore';
fs.copyFileSync(path.join(ROOT, ignore), path.join(OUT, '.gitignore'));
fs.mkdirSync(path.join(OUT, 'dist'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist', 'command-centre-v2.html'), path.join(OUT, 'dist', 'command-centre-v2.html')); // the built office page
fs.copyFileSync(path.join(ROOT, 'dist', 'portal.html'), path.join(OUT, 'dist', 'portal.html'));
// the shipped braingraph.js must come from the sample brain — guard against a private vault leaking
const bg = fs.readFileSync(path.join(OUT, 'src', 'braingraph.js'), 'utf8');
if (!/MOC-Sales/.test(bg) || /sahni|territool/i.test(bg))
  throw new Error('braingraph.js does not look like the sample brain — refusing to release');
for (const m of fs.readFileSync(path.join(ROOT, 'serve.mjs'), 'utf8').matchAll(/from '\.\/([\w-]+\.mjs)'/g))
  if (!fs.existsSync(path.join(OUT, m[1])))
    throw new Error(`serve.mjs imports ${m[1]} but it is not in the release whitelist — add it to FILES`); // beta.2 of 3.2 shipped without teams.mjs
console.log('  files:', fs.readdirSync(OUT).join(' '));

if (!push) {
  console.log(`✓ Release assembled in ${path.relative(ROOT, OUT)}. Add --push to publish ${BRANCH} + ${TAG}.`);
  process.exit(0);
}

console.log('→ cloning the public repo');
const AUTHOR = ['user.name', 'user.email'].map((key) => run('git', ['config', '--get', key], { cwd: ROOT }).trim());
if (AUTHOR.some((value) => !value)) throw new Error('Configure Git user.name and user.email before publishing.');
const TMP = fs.mkdtempSync('/tmp/delux-crew-release-');
run('git', ['clone', '-q', PUBLIC, path.join(TMP, 'pub')]);
const pub = path.join(TMP, 'pub');
run('git', ['config', 'user.name', AUTHOR[0]], { cwd: pub });
run('git', ['config', 'user.email', AUTHOR[1]], { cwd: pub });
const hasBranch =
  spawnSync('git', ['ls-remote', '--heads', 'origin', BRANCH], { cwd: pub, encoding: 'utf8' }).stdout.trim() !== '';
run('git', hasBranch ? ['checkout', '-q', BRANCH] : ['checkout', '-q', '-b', BRANCH], { cwd: pub });
for (const ent of fs.readdirSync(pub))
  if (ent !== '.git') fs.rmSync(path.join(pub, ent), { recursive: true, force: true });
fs.cpSync(OUT, pub, { recursive: true });
run('git', ['add', '-A'], { cwd: pub });
if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: pub }).status === 0)
  console.log('  public branch already matches — tagging the current commit');
else run('git', ['commit', '-q', '-m', `Delux crew ${TAG}`], { cwd: pub });
// tags are never force-moved (the repo's rules refuse it): bump package.json to cut a new one
const tagged =
  spawnSync('git', ['ls-remote', '--tags', 'origin', TAG], { cwd: pub, encoding: 'utf8' }).stdout.trim() !== '';
if (!tagged) run('git', ['tag', TAG, '-m', TAG], { cwd: pub });
console.log('→ pushing', BRANCH, tagged ? `(${TAG} already exists)` : TAG);
run('git', ['push', '-q', '-u', 'origin', BRANCH], { cwd: pub });
if (!tagged) run('git', ['push', '-q', 'origin', TAG], { cwd: pub });
console.log('→ zip + GitHub pre-release');
const zip = path.join(TMP, `delux-crew-${TAG}.zip`);
run('zip', ['-qr', zip, '.', '-x', '.git/*'], { cwd: pub });
const notes = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n## ')[1] || TAG;
const rel = spawnSync('gh', ['release', 'view', TAG, '-R', REPOSITORY], { encoding: 'utf8' });
if (rel.status === 0)
  console.log(`  release ${TAG} already exists and is immutable — bump package.json to ship a new zip`);
else
  run('gh', [
    'release',
    'create',
    TAG,
    zip,
    '--prerelease',
    '--title',
    `Delux crew ${TAG}`,
    '--notes',
    '## ' + notes,
    '--target',
    BRANCH,
    '-R',
    REPOSITORY,
  ]);
if (rel.status === 0) spawnSync('gh', ['release', 'edit', TAG, '--target', BRANCH, '-R', REPOSITORY]);
console.log(
  `✓ Published ${BRANCH} @ ${TAG} → https://github.com/${REPOSITORY}/tree/${BRANCH}  ·  https://github.com/${REPOSITORY}/releases/tag/${TAG}`,
);
