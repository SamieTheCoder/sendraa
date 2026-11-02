// Renders the Strip mark (brand/sendraa-brand.html, "logo-strip") into the
// app icon, splash and favicon PNGs, in the Telegram scheme.
//
//   node brand/icons/render.mjs
//
// Uses headless Microsoft Edge or Chrome through the DevTools protocol, so no
// image tooling has to be installed. Output goes to apps/mobile/assets/images.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = new URL('../../apps/mobile/assets/images/', import.meta.url).pathname;

// Telegram scheme.
const YELLOW = '#F5C400';
const INK = '#16130E';

// The mark exactly as drawn on the brand board: a strip cut on the left and
// pointed on the right, with the counter line, tilted -8°.
const mark = (fill, counter, counterOpacity = 0.9) => `
  <g transform="rotate(-8 32 22)">
    <path d="M3 13h43l14 9-14 9H3l7-9z" fill="${fill}"/>
    <rect x="15" y="20.6" width="22" height="2.8" rx="1.4" fill="${counter}" opacity="${counterOpacity}"/>
  </g>`;

/**
 * One square SVG. `scale` is the mark width as a share of the canvas, centred
 * optically: the strip's point carries more visual weight, so it sits a touch left.
 */
const svg = ({ size, bg, fill, counter, scale, radius = 0, counterOpacity }) => {
  const w = size * scale;
  const k = w / 64;
  const x = (size - w) / 2 - size * 0.01;
  const y = (size - 44 * k) / 2;
  const background = bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${background}<g transform="translate(${x} ${y}) scale(${k})">${mark(fill, counter, counterOpacity)}</g></svg>`;
};

/**
 * The bare mark, white with the counter line cut out, on a transparent canvas trimmed to the strip.
 * The app tints it (Image tintColor), so one file serves ink-on-yellow and yellow-on-ink.
 */
const bareMark = (scale) => {
  const w = 64 * scale;
  const h = 44 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 64 44">
    <defs><mask id="cut"><rect width="64" height="44" fill="#fff"/>
      <g transform="rotate(-8 32 22)"><rect x="15" y="20.6" width="22" height="2.8" rx="1.4" fill="#000"/></g></mask></defs>
    <g mask="url(#cut)"><g transform="rotate(-8 32 22)"><path d="M3 13h43l14 9-14 9H3l7-9z" fill="#FFFFFF"/></g></g></svg>`;
};

// iOS masks the corners itself, so iOS icons are full-bleed squares.
const files = {
  // In-app mark, tinted at runtime. 3x of a 64×44 point design.
  'mark.png': bareMark(3),
  // Light: ink strip on telegraph yellow.
  'icon.png': svg({ size: 1024, bg: YELLOW, fill: INK, counter: YELLOW, scale: 0.62 }),
  // Dark: yellow strip on ink.
  'icon-dark.png': svg({ size: 1024, bg: INK, fill: YELLOW, counter: INK, scale: 0.62 }),
  // Tinted: iOS recolours a greyscale image, so it is white on transparent black.
  'icon-tinted.png': svg({ size: 1024, bg: '#000000', fill: '#FFFFFF', counter: '#000000', scale: 0.62, counterOpacity: 1 }),
  // Android adaptive icon: the foreground must stay inside the central 66% safe zone.
  'android-icon-foreground.png': svg({ size: 1024, fill: INK, counter: YELLOW, scale: 0.46 }),
  'android-icon-background.png': svg({ size: 1024, bg: YELLOW, fill: 'none', counter: 'none', scale: 0.01 }),
  'android-icon-monochrome.png': svg({ size: 1024, fill: '#FFFFFF', counter: '#000000', scale: 0.46, counterOpacity: 1 }),
  // Splash: the mark alone; the background colour comes from app.json.
  'splash-icon.png': svg({ size: 512, fill: INK, counter: YELLOW, scale: 0.9 }),
  'splash-icon-dark.png': svg({ size: 512, fill: YELLOW, counter: INK, scale: 0.9 }),
  // Favicon: a rounded tile, since browsers do not mask.
  'favicon.png': svg({ size: 192, bg: YELLOW, fill: INK, counter: YELLOW, scale: 0.7, radius: 42 }),
};

const BROWSERS = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = BROWSERS.find(existsSync);
if (!browser) throw new Error('Needs Microsoft Edge or Google Chrome to render.');

const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'icons-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {
    // not up yet
  }
}
if (!target) {
  proc.kill();
  throw new Error('Browser did not start.');
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
for (const [name, markup] of Object.entries(files)) {
  const size = Number(/width="(\d+)"/.exec(markup)[1]);
  const height = Number(/height="(\d+)"/.exec(markup)[1]);
  await send('Emulation.setDeviceMetricsOverride', { width: size, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`;
  await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  await sleep(250);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height, scale: 1 } });
  writeFileSync(join(OUT, name), Buffer.from(shot.data, 'base64'));
  console.log(`${name} ${size}×${height}`);
}
ws.close();
proc.kill();
