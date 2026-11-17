// Folds the `vite build --mode artifact` output into one HTML fragment for the Artifact viewer,
// which supplies the <!doctype>, <html>, <head> and <body> itself and only accepts inline CSS/JS.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist-artifact');
const html = readFileSync(join(distDir, 'index.html'), 'utf8');

const pick = (pattern, label) => {
  const match = pattern.exec(html);
  if (!match) throw new Error(`build-artifact: could not find ${label} in dist-artifact/index.html`);
  return match;
};

const title = pick(/<title>[\s\S]*?<\/title>/, 'title')[0];
const fonts = pick(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/, 'font stylesheet')[0];
const cssPath = pick(/<link[^>]+href="\.\/(assets\/[^"]+\.css)"[^>]*>/, 'stylesheet')[1];
const jsPath = pick(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/, 'script')[1];

const css = readFileSync(join(distDir, cssPath), 'utf8');
const js = readFileSync(join(distDir, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script');

const fragment = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  `<style>${css}</style>`,
  '<div id="root"></div>',
  `<script type="module">${js}</script>`,
  '',
].join('\n');

const out = join(distDir, 'ravin-sales-demo.html');
writeFileSync(out, fragment);
console.log(`build-artifact: wrote ${out} (${Math.round(fragment.length / 1024)} KB)`);
