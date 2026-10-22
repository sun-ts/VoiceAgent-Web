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
        window.__sentAudio.push({ status, volume: this.volumeFilter, parameters: [this.positiveSpeechThreshold,
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

test('volume filtering uses an initial reference, a configurable lower bound, reset, and playback bypass', async () => {
  const { page, context } = await openPage();
  try {
    const result = await page.evaluate(async () => {
      const { default: VoiceService } = await import('/src/utils/Services/VoiceService.js');
      let active = false, id = 0;
      const service = new VoiceService(.7, .5, 1, 2, 0,
        { appContext: { config: { globalProperties: { $uuid: () => String(++id) } } } },
        () => {}, null, null, { isReplyActive: () => active });
      service.speaker.configureInterruption({ enabled: true, requireSameSpeaker: false });
      const sent = [];
      service.sendAudioData = (id, pcm, status) => sent.push(status);
      service.configureVolumeFilter({ enabled: true, lowerDb: 4 });
      const speak = amplitude => {
        sent.length = 0;
        service.voiceTranslate({ isSpeech: .95 }, new Float32Array(512).fill(amplitude));
        service.voiceTranslate({ isSpeech: 0 }, new Float32Array(512));
        service.voiceTranslate({ isSpeech: 0 }, new Float32Array(512));
        return sent.includes(0);
      };
      const accepted = [.1, .05, .4, .08, .2].map(speak);
      active = true;
      const playbackQuiet = speak(.001);
      active = false;
      service.reset();
      const afterReset = speak(.01);
      service.configureVolumeFilter({ enabled: true, lowerDb: 0 });
      const zeroBound = [.1, .09, .1, .2].map(speak);
      service.configureVolumeFilter({ enabled: false, lowerDb: 0 });
      const disabled = [.001, .8].map(speak);
      // VAD remains authoritative even when volume filtering is off.
      sent.length = 0;
      service.voiceTranslate({ isSpeech: .1 }, new Float32Array(512).fill(.8));
      return { accepted, playbackQuiet, afterReset, disabled, zeroBound, nonSpeechSent: sent.length };
    });
    assert.deepEqual(result, { accepted: [true, false, true, true, true], playbackQuiet: true,
      afterReset: true, disabled: [true, true], zeroBound: [true, false, true, true], nonSpeechSent: 0 });
  } finally { await context.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} setting help is available without inline explanations`, async () => {
  const { page, context } = await openPage(mobile);
  try {
    const help = page.getByRole('button', { name: '播报打断说明', exact: true });
    if (mobile) await help.click(); else await help.hover();
    await page.getByRole('tooltip').filter({ hasText: '开场白' }).waitFor();
    await help.press('Escape');
    await page.getByRole('tooltip').filter({ hasText: '开场白' }).waitFor({ state: 'hidden' });
    if (!mobile) {
      await help.blur(); await page.mouse.move(1000, 800); await help.focus();
      await page.getByRole('tooltip').filter({ hasText: '开场白' }).waitFor();
      await help.press('Escape');
      await page.getByRole('tooltip').filter({ hasText: '开场白' }).waitFor({ state: 'hidden' });
    }
    const volume = page.getByRole('group', { name: '音量筛选', exact: true });
    const enable = volume.getByRole('switch', { name: '启用初始音量筛选', exact: true });
    const lower = volume.getByRole('spinbutton', { name: '允许降低 (dB)', exact: true });
    await lower.fill('6'); await lower.press('Tab');
    await page.getByRole('button', { name: mobile ? '开始语音检测' : '开始检测', exact: true }).click();
    assert.equal(await enable.isDisabled(), true);
    assert.equal(await lower.isDisabled(), true);
    await page.evaluate(() => window.__emitFrames(.95, 10));
    assert.deepEqual(await page.evaluate(() => window.__sentAudio[0].volume), { enabled: true, lowerDb: 6 });
    await page.getByRole('button', { name: mobile ? '停止语音检测' : '停止检测', exact: true }).click();
    await enable.locator('..').click();
    assert.equal(await lower.isDisabled(), true);
    assert.equal(await enable.isDisabled(), false);
  } finally { await context.close(); }
});
