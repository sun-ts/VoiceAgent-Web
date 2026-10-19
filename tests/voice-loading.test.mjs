import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer, loadEnv, preview } from 'vite';

const modelPath = '/models/silero_vad_v5.onnx';
const wasmPath = '/onnxruntime/ort-wasm-simd-threaded.wasm';
let server, browser, origin;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
});

async function openPage({ authenticated = true, mobile = false } = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...(mobile ? {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    } : {}),
  });
  await context.addInitScript((authenticated) => {
    if (authenticated) sessionStorage.setItem('voice-client-login', '1');
    window.__micRequests = 0;
    window.__audioContexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.__audioContexts.push(this);
      }
    };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.__micRequests++;
      return get(...args);
    };
  }, authenticated);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { page, context, errors };
}

test('login loads only its small entry bundle; successful login starts voice loading', async () => {
  const { page, context, errors } = await openPage({ authenticated: false });
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '语音交互系统登录' }).waitFor();
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({
      path: new URL(r.name).pathname, bytes: r.decodedBodySize,
    })));
    assert.equal(resources.some(r => /silero|ort-wasm|HelloWorld|AudioService|\/vad-/.test(r.path)), false);
    const scripts = resources.filter(r => r.path.endsWith('.js'));
    assert.ok(scripts.reduce((total, r) => total + r.bytes, 0) < 300000, 'login JS must stay below 300 KB uncompressed');
    assert.equal(await page.evaluate(() => document.querySelectorAll('link[data-voice-asset]').length), 0);

    const env = loadEnv('production', process.cwd(), 'VITE_LOGIN_');
    assert.ok(env.VITE_LOGIN_USERNAME && env.VITE_LOGIN_PASSWORD, 'configure login credentials for the browser check');
    await page.getByLabel('用户名', { exact: true }).fill(env.VITE_LOGIN_USERNAME);
    await page.getByLabel('密码', { exact: true }).fill(env.VITE_LOGIN_PASSWORD);
    const captcha = (await page.locator('.captcha-char').allTextContents()).join('');
    await page.getByLabel('验证码', { exact: true }).fill(captcha);
    await page.getByRole('button', { name: '进入控制台' }).click();
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor({ timeout: 30000 });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} starts model and WASM together, reuses downloads and waits before enabling voice`, async () => {
    const { page, context, errors } = await openPage({ mobile });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const requests = [];
    try {
      await page.route(/\/(models\/silero_vad_v5\.onnx|onnxruntime\/ort-wasm-simd-threaded\.wasm)$/, async route => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        await gate;
        await route.fulfill({ path: resolve('dist', path.slice(1)), contentType: path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' });
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const preparing = page.getByRole('button', { name: '语音引擎准备中…', exact: true });
      await preparing.waitFor();
      assert.equal(await preparing.isDisabled(), true);
      const deadline = Date.now() + 10000;
      while (new Set(requests).size < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(new Set(requests).size, 2, 'WASM must be requested before the model response is released');
      release();
      await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor({ timeout: 30000 });
      assert.equal(await page.getByRole('button', { name: mobile ? '开始语音检测' : '开始检测', exact: true }).isEnabled(), true);
      for (const path of [modelPath, wasmPath]) assert.equal(requests.filter(r => r === path).length, 1);
      assert.equal(await page.evaluate(() => window.__micRequests), 0, 'initialization must not open the microphone');
      assert.deepEqual(errors, []);
      await page.getByRole('button', { name: '退出登录', exact: true }).click();
      await page.getByRole('heading', { name: '语音交互系统登录' }).waitFor();
      await page.waitForLoadState('networkidle');
      assert.deepEqual(errors, [], 'logout before starting the microphone must dispose the detector safely');
      assert.equal(await page.evaluate(() => window.__audioContexts.every(context => context.state === 'closed')), true);
    } finally { release(); await context.close(); }
  });
}

for (const path of [modelPath, wasmPath, '/onnxruntime/ort-wasm-simd-threaded.mjs']) {
  test(`${path} failure keeps start disabled and reload retries successfully`, async () => {
    const { page, context, errors } = await openPage();
    let fail = true;
    try {
      await page.route(`**${path}`, route => fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue());
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByText('语音引擎加载失败，请检查网络后重新加载', { exact: true }).first().waitFor({ timeout: 30000 });
      assert.equal(await page.getByRole('button', { name: '开始检测', exact: true }).isDisabled(), true);
      fail = false;
      await page.getByRole('button', { name: '重新加载', exact: true }).click();
      await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor({ timeout: 30000 });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('browsers without modulepreload still initialize using a dynamic module import', async () => {
  const { page, context, errors } = await openPage({ mobile: true });
  try {
    await page.addInitScript(() => {
      const supports = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function (token) {
        return token === 'modulepreload' ? false : supports.call(this, token);
      };
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: '开始语音检测', exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('logout during initialization stays on login and never requests the microphone', async () => {
  const { page, context, errors } = await openPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.route(`**${modelPath}`, async route => {
      await gate;
      await route.fulfill({ path: resolve('dist', modelPath.slice(1)), contentType: 'application/octet-stream' });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '语音引擎准备中…', exact: true }).waitFor();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    release();
    await page.getByRole('heading', { name: '语音交互系统登录' }).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(() => window.__micRequests), 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => window.__audioContexts.every(context => context.state === 'closed')), true);
  } finally { release(); await context.close(); }
});

test('a slow WASM download does not leave an unused ONNX preload or fetch the model twice', async () => {
  const { page, context, errors } = await openPage();
  const warnings = [];
  let modelRequests = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  try {
    await page.route(`**${wasmPath}`, async route => {
      await gate;
      await route.fulfill({ path: resolve('dist', wasmPath.slice(1)), contentType: 'application/wasm' });
    });
    await page.route(`**${modelPath}`, async route => {
      modelRequests++;
      // Reuse must also work when HTTP caching is disabled.
      await route.fulfill({ path: resolve('dist', modelPath.slice(1)), headers: { 'cache-control': 'no-store' } });
    });
    const modelLoaded = page.waitForResponse(response => new URL(response.url()).pathname === modelPath);
    await page.goto(origin);
    await (await modelLoaded).finished();
    // Chrome checks for unused preloads several seconds after the load event.
    await page.waitForTimeout(8000);
    assert.deepEqual(warnings.filter(text => text.includes('silero_vad_v5.onnx') && text.includes('preload')), []);
    release();
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor({ timeout: 30000 });
    assert.equal(modelRequests, 1);
    assert.deepEqual(errors, []);
  } finally { release(); await context.close(); }
});

test('development dependency optimization shares the model download with app source', async () => {
  const dev = await createServer({
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, open: false },
    optimizeDeps: { force: true },
  });
  const { page, context, errors } = await openPage();
  let modelRequests = 0;
  try {
    await dev.listen();
    await page.route(`**${modelPath}`, route => {
      modelRequests++;
      return route.fulfill({ path: resolve('public', modelPath.slice(1)), headers: { 'cache-control': 'no-store' } });
    });
    await page.goto(dev.resolvedUrls.local[0]);
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor({ timeout: 30000 });
    assert.equal(modelRequests, 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await dev.close(); }
});
