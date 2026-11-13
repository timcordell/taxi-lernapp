// Erzeugt precache-manifest.js: Liste aller App-Shell-Dateien + Inhalts-Hash als
// Cache-Version. Bei jeder Änderung an einer Datei bekommt die App einen neuen Cache.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['index.html', 'config.js', 'manifest.webmanifest', 'css', 'js', 'vendor', 'fonts', 'icons'];
const SKIP = /(\.map|\.d\.ts|LICENSE(\.txt)?|\.LICENSE|\.svg)$/;

function walk(path) {
  const full = join(root, path);
  if (statSync(full).isDirectory()) return readdirSync(full).flatMap((f) => walk(join(path, f)));
  return SKIP.test(path) ? [] : [path];
}

const files = INCLUDE.flatMap(walk).map((f) => f.split(sep).join('/')).sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
hash.update(readFileSync(join(root, 'sw.js')));
const version = hash.digest('hex').slice(0, 12);

const list = ['./', ...files.map((f) => `./${f}`)];
writeFileSync(join(root, 'precache-manifest.js'),
  `// Automatisch erzeugt von scripts/precache.mjs – nicht von Hand bearbeiten.\n`
  + `self.PRECACHE_VERSION = '${version}';\n`
  + `self.PRECACHE_FILES = ${JSON.stringify(list, null, 2)};\n`);
console.log(`precache-manifest.js: ${list.length} Dateien, Version ${version}`);
