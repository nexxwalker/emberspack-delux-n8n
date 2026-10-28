// Bundle src/main.js (+three) into a single self-contained HTML that opens by double-click.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { buildBrainGraph } from './graph-build.mjs';
await buildBrainGraph(); // V3.6: bake the vault's wiki-link graph into src/braingraph.js

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  loader: { '.png': 'dataurl' }, // the contact logo also works in the standalone HTML
});
const js = res.outputFiles[0].text;
const shell = readFileSync('src/shell.html', 'utf8');
const html = shell.replace('<!--APP-->', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/command-centre-v2.html', html);

// dev variant with external script for faster iteration
mkdirSync('dist', { recursive: true });
writeFileSync('dist/app.js', js);
writeFileSync('dist/dev.html', shell.replace('<!--APP-->', '<script src="app.js"></script>'));
console.log(`built dist/command-centre-v2.html (${(html.length / 1024).toFixed(0)} KB)`);

// The account portal is self-contained, with no external font or asset requests.
const portal = await build({
  entryPoints: ['src/portal.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  loader: { '.png': 'dataurl' },
});
const portalHTML = readFileSync('src/portal.html', 'utf8')
  .replace('<!--STYLE-->', () => `<style>${readFileSync('src/portal.css', 'utf8')}</style>`)
  .replace('<!--APP-->', () => `<script>${portal.outputFiles[0].text}</script>`);
writeFileSync('dist/portal.html', portalHTML);
console.log(`built dist/portal.html (${(portalHTML.length / 1024).toFixed(0)} KB)`);
