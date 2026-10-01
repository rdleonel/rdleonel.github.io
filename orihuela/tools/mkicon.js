// Gera os ícones do app em PNG. Usa o screenshot do próprio elemento SVG via
// Playwright: a captura por janela saía cortada pela metade.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'icons');

function svg(size, scale) {
  const pad = (1 - scale) / 2 * 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#19202e"/><stop offset="1" stop-color="#0b0e14"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(${pad} ${pad}) scale(${scale})">
    <rect x="86"  y="300" width="76" height="126" rx="16" fill="#d9a73a"/>
    <rect x="218" y="242" width="76" height="184" rx="16" fill="#d9a73a"/>
    <rect x="350" y="170" width="76" height="256" rx="16" fill="#d9a73a"/>
    <path d="M110 268 L246 168 L330 214 L430 96" fill="none" stroke="#f2f4f8"
          stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M352 88 L438 88 L438 174" fill="none" stroke="#f2f4f8"
          stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const jobs = [
    ['icon-512.png', 512, 0.82], ['icon-192.png', 192, 0.82],
    ['apple-touch-icon.png', 180, 0.82], ['icon-maskable-512.png', 512, 0.62],
    ['preview-60.png', 60, 0.82]
  ];
  for (const [name, size, scale] of jobs) {
    await page.setViewportSize({ width: Math.max(size, 40) + 40, height: Math.max(size, 40) + 40 });
    await page.setContent(`<style>html,body{margin:0;padding:0;background:#000}</style>` + svg(size, scale));
    const el = await page.$('svg');
    const out = path.join(OUT, name);
    await el.screenshot({ path: out, omitBackground: false });
    const d = fs.readFileSync(out);
    const w = d.readUInt32BE(16), h = d.readUInt32BE(20), ctype = d[25];
    console.log(`${name}: ${w}x${h} color=${ctype === 2 ? 'RGB' : ctype === 6 ? 'RGBA' : ctype} ${d.length}B`);
    if (w !== size || h !== size) throw new Error('tamanho errado em ' + name);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
