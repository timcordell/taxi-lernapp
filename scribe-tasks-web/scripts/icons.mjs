// Erzeugt alle App-Icons: Navy-Hintergrund mit Terrakotta-Haken.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(out, { recursive: true });

const NAVY = '#1B2A41';
const TERRACOTTA = '#C8643C';
const CREAM = '#F4EBDC';

/**
 * @param {number} scale  Größe des Motivs relativ zur Fläche (maskable braucht Rand)
 * @param {boolean} rounded  abgerundete Ecken (nur für "any"-Icons)
 */
function svg({ scale = 1, rounded = true } = {}) {
  const s = 512;
  const g = (v) => s / 2 + (v - s / 2) * scale; // Motiv um die Mitte skalieren
  const r = rounded ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${r}" fill="${NAVY}"/>
  <g stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="${g(150)}" y1="${g(150)}" x2="${g(362)}" y2="${g(150)}" stroke="${CREAM}" stroke-opacity=".28" stroke-width="${26 * scale}"/>
    <line x1="${g(150)}" y1="${g(212)}" x2="${g(300)}" y2="${g(212)}" stroke="${CREAM}" stroke-opacity=".28" stroke-width="${26 * scale}"/>
    <polyline points="${g(148)},${g(300)} ${g(228)},${g(378)} ${g(372)},${g(232)}" stroke="${TERRACOTTA}" stroke-width="${54 * scale}"/>
  </g>
</svg>`;
}

const jobs = [
  ['icon-192.png', 192, svg(), true],
  ['icon-512.png', 512, svg(), true],
  ['icon-maskable-512.png', 512, svg({ scale: 0.78, rounded: false })],
  // iOS rundet selbst ab und mag keine Transparenz
  ['apple-touch-icon.png', 180, svg({ scale: 0.9, rounded: false })],
  ['favicon-32.png', 32, svg(), true],
  // Logo für den Google-Zustimmungsbildschirm (quadratisch, 120×120)
  ['logo-120.png', 120, svg({ scale: 0.9, rounded: false })],
];

writeFileSync(join(out, 'icon.svg'), svg());
for (const [name, size, source, transparent] of jobs) {
  const img = sharp(Buffer.from(source)).resize(size, size);
  await (transparent ? img : img.flatten({ background: NAVY })).png().toFile(join(out, name));
  console.log(`icons/${name}`);
}
