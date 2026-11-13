// Kopiert die benötigten Bibliotheken aus node_modules nach vendor/ und fonts/,
// damit die App ohne Build-Schritt und ohne CDN statisch ausgeliefert werden kann.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

rmSync(join(root, 'vendor'), { recursive: true, force: true });
mkdirSync(join(root, 'vendor'), { recursive: true });
// chrono-node: nur den Modul-Graphen der deutschen Locale kopieren (statt aller Sprachen)
const chronoSrc = join(nm, 'chrono-node/dist/esm');
const seen = new Set();
const queue = [join(chronoSrc, 'locales/de/index.js')];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const code = readFileSync(file, 'utf8');
  for (const [, spec] of code.matchAll(/(?:import|export)[^'"]*?from\s*["'](\.[^"']+)["']/g)) {
    queue.push(join(dirname(file), spec));
  }
}
for (const file of seen) {
  const target = join(root, 'vendor/chrono-node', relative(chronoSrc, file));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}
console.log(`chrono-node: ${seen.size} Module (Locale de)`);
cpSync(join(nm, 'chrono-node/LICENSE.txt'), join(root, 'vendor/chrono-node/LICENSE.txt'));
cpSync(join(nm, '@azure/msal-browser/lib/msal-browser.min.js'), join(root, 'vendor/msal-browser.min.js'));
cpSync(join(nm, '@azure/msal-browser/LICENSE'), join(root, 'vendor/msal-browser.LICENSE'));

mkdirSync(join(root, 'fonts'), { recursive: true });
for (const w of [400, 600, 700, 800]) {
  const f = `nunito-sans-latin-${w}-normal.woff2`;
  cpSync(join(nm, '@fontsource/nunito-sans/files', f), join(root, 'fonts', f));
}
cpSync(join(nm, '@fontsource/nunito-sans/LICENSE'), join(root, 'fonts/LICENSE'));
console.log('vendor/ und fonts/ aktualisiert');
