import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser;
before(async () => {
  server = await createServer({
    logLevel: 'warn', server: { host: '127.0.0.1', port: 0, open: false },
    define: { 'import.meta.env.VITE_IS_OPENING_REMARKS': JSON.stringify('false') },
  });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); await server?.close(); });

async function openPage(mobile = false) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' } : {}),
  });
  await context.addInitScript(() => {
    sessionStorage.setItem('voice-client-login', '1');
    window.__sentAudio = [];
  });
  const page = await context.newPage();
  // Replace microphone/model inference only. Exercise the real page and
  // VoiceService with controlled probabilities; capture ASR output locally.
  await page.route('**/src/utils/Services/VoiceRuntime.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      export async function createVoiceDetector(options) {
        window.__emitFrames = (probability, count) => {
          for (let i = 0; i < count; i++) options.onFrameProcessed(
            { isSpeech: probability }, new Float32Array(512).fill(0.05));
        };
        return { start: async () => {}, pause: async () => {}, destroy: async () => {} };
      }
    `,
  }));
  await page.route('**/src/utils/Services/VoiceService.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      VoiceService.prototype.sendAudioData = async function(uuid, audio, status) {
        window.__sentAudio.push({ status, parameters: [this.positiveSpeechThreshold,
          this.negativeSpeechThreshold, this.preSpeechPadFrame, this.redemptionFrame, this.cacheSpeechMs] });
      };
    ` });
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor();
  return { page, context };
}

async function selectEnvironment(page, label) {
  await page.locator('.vad-params-form .el-select__wrapper').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test('web presets fill the controls, manual edits become custom, and the chosen profile reaches VoiceService', async () => {
  const { page, context } = await openPage();
  try {
    const fields = page.locator('.vad-params-form').getByRole('spinbutton');
    const values = () => fields.evaluateAll(inputs => inputs.map(input => Number(input.value)));
    assert.deepEqual(await values(), [0.55, 0.35, 200, 250, 1200]);
    await selectEnvironment(page, '嘈杂环境');
    assert.deepEqual(await values(), [0.7, 0.5, 300, 400, 1000]);
    await fields.nth(0).fill('0.75');
    await fields.nth(0).press('Tab');
    await page.locator('.vad-params-form .el-select__selected-item').filter({ hasText: '自定义' }).waitFor();
    await selectEnvironment(page, '安静环境');
    assert.deepEqual(await values(), [0.5, 0.3, 150, 250, 900]);
    await selectEnvironment(page, '会议室');
    assert.deepEqual(await values(), [0.5, 0.3, 200, 350, 1600]);
    await page.getByRole('button', { name: '开始检测', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: '使用环境' }).isDisabled(), true);
    for (const field of await fields.all()) assert.equal(await field.isDisabled(), true);
    await page.evaluate(() => window.__emitFrames(0.6, 7));
    assert.deepEqual(await page.evaluate(() => window.__sentAudio[0].parameters), [0.5, 0.3, 7, 50, 350]);
    await page.evaluate(() => window.__emitFrames(0.1, 38));
    assert.equal(await page.evaluate(() => window.__sentAudio.some(item => item.status === 2)), false);
    await page.evaluate(() => window.__emitFrames(0.1, 12));
    assert.equal(await page.evaluate(() => window.__sentAudio.at(-1).status), 2);
    await page.getByRole('button', { name: '停止检测', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: '使用环境' }).isEnabled(), true);
    await selectEnvironment(page, '办公室');
    await page.getByRole('button', { name: '开始检测', exact: true }).click();
    await page.evaluate(() => { window.__sentAudio = []; window.__emitFrames(0.6, 7); });
    assert.deepEqual(await page.evaluate(() => window.__sentAudio[0].parameters), [0.55, 0.35, 7, 38, 250]);
    await page.getByRole('button', { name: '停止检测', exact: true }).click();
  } finally { await context.close(); }
});

test('mobile defaults to noisy settings and rejects lower-confidence frames', async () => {
  const { page, context } = await openPage(true);
  try {
    await page.getByText('嘈杂环境', { exact: true }).waitFor();
    await page.getByRole('button', { name: '开始语音检测', exact: true }).click();
    await page.evaluate(() => window.__emitFrames(0.6, 20));
    assert.equal(await page.evaluate(() => window.__sentAudio.length), 0);
    await page.evaluate(() => window.__emitFrames(0.9, 9));
    assert.equal(await page.evaluate(() => window.__sentAudio.length), 0);
    await page.evaluate(() => window.__emitFrames(0.9, 1));
    assert.deepEqual(await page.evaluate(() => window.__sentAudio[0].parameters), [0.7, 0.5, 10, 32, 400]);
    await page.getByRole('button', { name: '停止语音检测', exact: true }).click();
  } finally { await context.close(); }
});
