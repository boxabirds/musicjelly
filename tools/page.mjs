// Opens the page in headless Chrome for the tests. Chrome is driven through a pipe, so no debugging port is opened.
// Two ways to reach the page:
//   - by default, no web server: every request to the made-up address below is answered from the files in this folder.
//     The browser does not let a test answer the request for a sound worklet, so the piano cannot load this way and the
//     tests that need it say so (`served` is false);
//   - MJ_URL=http://localhost:8765/mj/ (any address the folder is really served at): everything loads, sound included.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), ORIGIN = 'https://musicjelly.test';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const READY_TIMEOUT_MS = 60000, SERVED = process.env.MJ_URL || '';
// A pretend Web MIDI for the page, put in before it loads: headless Chrome has none. window.__fakeMidi can plug a
// keyboard in, unplug it, and send a message from it, and the page hears all of it through the real Web MIDI calls.
function fakeMidi(names) {
  const inputs = new Map(), access = { inputs, onstatechange: null };
  const F = window.__fakeMidi = {
    plug(name) { const port = { name, type: 'input', state: 'connected', onmidimessage: null }; inputs.set(name, port); access.onstatechange?.({ port }); },
    unplug(name) { const port = inputs.get(name); if (!port) return; port.state = 'disconnected'; inputs.delete(name); access.onstatechange?.({ port }); },
    send(name, bytes) { const port = inputs.get(name); if (port && port.onmidimessage) { port.onmidimessage({ data: Uint8Array.from(bytes), timeStamp: performance.now() }); return true; } return false; },
  };
  names.forEach(n => F.plug(n));
  navigator.requestMIDIAccess = async () => access;
}
// keyboards: the names of the MIDI keyboards plugged in when the page opens
export async function openPage({ width = 1280, height = 720, query = '', keyboards = ['Test Keys'] } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage(), problems = [];
  await page.addInitScript(fakeMidi, keyboards);
  page.on('pageerror', e => problems.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });      // says which file, which the console's own message does not
  if (!SERVED) await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.fulfill({ status: 204, body: '' });      // fonts from the network are not needed to test
    const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto((SERVED || ORIGIN + '/') + (query ? '?' + query : ''));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: READY_TIMEOUT_MS });
  return { browser, page, problems, served: !!SERVED, state: () => page.evaluate(() => window.__mj.state()) };
}
