import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser;
before(async () => {
  server = await createServer({
    logLevel: 'warn', server: { host: '127.0.0.1', port: 0, open: false },
    define: { 'import.meta.env.VITE_IS_OPENING_REMARKS': JSON.stringify('false') },
    plugins: [{ name: 'expose-voice-integration', enforce: 'pre', transform(code, id) {
      if (/\/HelloWorld(?:_Mobile)?\.vue$/.test(id)) return code.replace('</script>', `
        window.__voice = { voiceService, showVociceText, playSoundStatus, audioSounds, modelThinkingUUIDList,
          audioBufferSource, audioObj, soundEncode, breakFlag, breakUUID, toggleVAD, voiceTexts,
          listening, translateCallBack, audioService, mp3Player, audioUrl, playPauseSound, GetVoicePlay, play_UUID, play_Num,
          enableOpening() {
            instance.appContext.config.globalProperties.$isOpeningRemarks = 'true';
            ${id.endsWith('/HelloWorld.vue') ? 'isOpeningRemarks.value = true;' : ''}
          } };
        </script>`);
    } }],
  });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); await server?.close(); });

for (const mobile of [false, true]) for (const format of ['PCM', 'MP3']) test(`${mobile ? 'mobile' : 'desktop'} ${format} quieter interruption still requires matching voice AND three characters`, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true,
    ...(mobile ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone) Mobile' } : {}),
  });
  try {
    await context.addInitScript(() => sessionStorage.setItem('voice-client-login', '1'));
    const page = await context.newPage();
    await page.route('**/src/utils/Services/VoiceRuntime.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function createVoiceDetector(options) {
        window.__frame = (p, n, amplitude = .1) => { for(let i=0;i<n;i++) options.onFrameProcessed({isSpeech:p}, new Float32Array(512).fill(amplitude)); };
        return {start:async()=>{},pause:async()=>{},destroy:async()=>{}};
      }` }));
    await page.route('**/src/utils/Services/AiAgentService.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export default class AiAgentService { constructor(id){this.uuid=id} isMine(id){return this.uuid===id} async sendQuestion(){window.__questions=(window.__questions||0)+1} }` }));
    await page.route('**/speaker-api/v1/embedding', route => route.fulfill({ json: { embedding: [1, ...Array(191).fill(0)] } }));
    let matches = false, verifications = 0;
    const verificationFrames = [];
    await page.route('**/speaker-api/v1/verify', route => {
      verifications++;
      verificationFrames.push(Buffer.from(route.request().postDataJSON().pcm_base64, 'base64').length / 1024);
      return route.fulfill({ json: { matched: matches, score: matches ? .9 : .1 } });
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor();
    await page.evaluate(async (format) => {
      const v = window.__voice;
      window.__sent = []; window.__stops = 0;
      v.voiceService.value.sendAudioData = (id, pcm, status) => window.__sent.push({ id, status });
      window.__asr = (id, text, status = 1) => v.showVociceText(id, JSON.stringify({code:0,data:{status,result:{sn:1,ws:[{cw:[{w:text}]}]}}}));
      // ASR can finalize a short question before local VAD ends it.
      window.__frame(.95,25);
      const owner = window.__sent[0].id;
      await window.__asr(owner, '今天天气怎么样', 2);
      window.__frame(0,55);
      v.soundEncode.value = format;
      if (format === 'PCM') v.audioBufferSource.value = {stop(){window.__stops++},disconnect(){}};
      else v.audioObj.value = {pause(){window.__stops++},load(){window.__stops++}};
      v.playSoundStatus.value = true;
      window.__sent = [];
    }, format);
    // Confident speech 26dB below the first question must reach verification
    // during playback, even though it is below the remembered volume gate.
    await page.evaluate(() => window.__frame(.95,32,.005));
    await assertEventually(() => verifications === 1);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__stops), 0);
    assert.equal(await page.evaluate(() => window.__sent.length), 0);
    matches = true;
    await page.evaluate(() => window.__frame(.95,32,.005));
    await page.waitForFunction(() => window.__sent.length >= 32);
    assert.deepEqual(verificationFrames, [32, 47], 'a rejected short probe must retry the same onset with 1504ms');
    await page.evaluate(() => window.__asr(window.__sent[0].id, '等下', 1));
    assert.equal(await page.evaluate(() => window.__stops), 0);
    await page.evaluate(() => window.__asr(window.__sent[0].id, '请等下', 1));
    assert.equal(await page.evaluate(() => window.__stops), 1);
    await page.evaluate(() => window.__asr(window.__sent[0].id, '请等下', 2));
    assert.equal(await page.evaluate(() => window.__questions), 2);
    await page.evaluate(async () => {
      const v = window.__voice;
      v.audioService.value.OptionTextDataToTTS = () => {};
      v.listening.value = true;
      await v.toggleVAD();
      await v.translateCallBack(window.__sent[0].id, '停止后返回的旧内容', true);
    });
    assert.equal(await page.evaluate(() => window.__voice.audioService.value.audioTexts.length), 0,
      'late model callbacks after stop must not enqueue TTS');
    if (format === 'MP3') {
      await page.evaluate(async () => {
        window.Audio = class {
          constructor() { this.listeners = {}; this.readyState = 2; }
          addEventListener(name, callback) { this.listeners[name] = callback; }
          removeEventListener(name) { delete this.listeners[name]; }
          load() {}
          play() { return new Promise((_, reject) => { this.reject = reject; }); }
        };
        const v = window.__voice;
        await v.toggleVAD();
        v.audioSounds.value = [{ uuidNum: 1, uuidOrg: 'loading-owner', uuidFlag: 'true', SoundAll: new Blob(['audio']) }];
        v.mp3Player();
        window.__oldAudio = v.audioObj.value;
        // In mobile the pending Blob has been popped from audioSounds but is not playing yet.
        window.__frame(.95, 11);
      });
      assert.equal(await page.evaluate(() => window.__voice.voiceService.value.speaker.records.values().next().value.protected), true,
        'an MP3 awaiting media readiness is still a protected reply');
      await page.evaluate(() => {
        window.__oldAudio.listeners.loadeddata?.();
        window.__oldAudio.listeners.canplaythrough?.();
      });
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const v = window.__voice;
        window.__newAudio = new Audio();
        v.audioObj.value = window.__newAudio;
        window.__newAudio = v.audioObj.value;
        v.playSoundStatus.value = true;
        window.__oldAudio.onended?.();
        window.__oldAudio.reject?.(new DOMException('Old playback aborted', 'AbortError'));
      });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.__voice.audioObj.value === window.__newAudio && window.__voice.playSoundStatus.value), true,
        'late old media callbacks must not clear the new playback');
    }
  } finally { await context.close(); }
});

async function assertEventually(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 30));
  assert.ok(check());
}

for (const mobile of [false, true]) for (const format of ['PCM', 'MP3']) test(`${mobile ? 'mobile' : 'desktop'} ${format} interruption controls apply before start and lock until stop`, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true,
    ...(mobile ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 13) Mobile' } : {}),
  });
  try {
    await context.addInitScript(() => sessionStorage.setItem('voice-client-login', '1'));
    const page = await context.newPage();
    let speakerRequests = 0;
    await page.route('**/speaker-api/**', route => { speakerRequests++; return route.fulfill({ status: 503, json: {} }); });
    await page.route('**/src/utils/Services/VoiceRuntime.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function createVoiceDetector(options) {
        window.__frame = (p, n) => { for(let i=0;i<n;i++) options.onFrameProcessed({isSpeech:p}, new Float32Array(512).fill(.1)); };
        return {start:()=>new Promise(resolve=>{window.__releaseStart=resolve}),pause:async()=>{},destroy:async()=>{}};
      }` }));
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor();
    const group = page.getByRole('group', { name: '打断设置', exact: true });
    const master = group.getByRole('switch', { name: '播报打断', exact: true });
    const sameSpeaker = group.getByRole('switch', { name: '仅同一说话人可打断', exact: true });
    const count = group.getByRole('spinbutton');
    if (mobile) {
      await page.setViewportSize({ width: 360, height: 640 });
      await count.scrollIntoViewIfNeeded();
      assert.equal(await count.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el;
      }), true, 'small screens can scroll to the interruption settings without clipping');
    }
    assert.equal(await master.isChecked(), true);
    assert.equal(await sameSpeaker.isChecked(), true);
    assert.equal(await count.inputValue(), '3');
    await count.fill('5'); await count.press('Tab');
    await sameSpeaker.locator('..').click(); await master.locator('..').click();
    assert.equal(await sameSpeaker.isDisabled(), true);
    assert.equal(await count.isDisabled(), true);
    await page.evaluate(() => {
      window.__sent = []; window.__stops = 0;
      const v = window.__voice;
      v.voiceService.value.sendAudioData = (id, pcm, status) => window.__sent.push({ id, status });
      window.__asr = text => v.showVociceText(window.__sent[0].id,
        JSON.stringify({code:0,data:{status:1,result:{sn:1,ws:[{cw:[{w:text}]}]}}}));
    });
    const start = async () => {
      await page.getByRole('button', { name: mobile ? '开始语音检测' : '开始检测', exact: true }).click();
      assert.equal(await master.isDisabled(), true, 'lock even while start() is awaiting microphone setup');
      await page.evaluate(() => window.__releaseStart());
      await page.waitForFunction(() => window.__voice.listening.value);
      assert.equal(await master.isDisabled(), true);
      assert.equal(await sameSpeaker.isDisabled(), true);
      assert.equal(await count.isDisabled(), true);
    };
    const play = async () => page.evaluate(format => {
      const v = window.__voice;
      window.__stops = 0; window.__sent = [];
      v.soundEncode.value = format;
      if (format === 'PCM') v.audioBufferSource.value = { stop(){window.__stops++}, disconnect(){} };
      else v.audioObj.value = { load(){window.__stops++} };
      v.playSoundStatus.value = true;
    }, format);
    const stop = () => page.getByRole('button', { name: mobile ? '停止语音检测' : '停止检测', exact: true }).click();
    await start(); await play();
    await page.evaluate(() => { window.__voice.voiceService.value.speaker.beginOpening(); window.__frame(.95,60); window.__frame(0,55); });
    assert.equal(await page.evaluate(() => window.__sent.length), 0);
    assert.equal(await page.evaluate(() => window.__stops), 0);
    await stop();
    assert.equal(await master.isDisabled(), false);
    await master.locator('..').click();
    assert.equal(await count.inputValue(), '5', 'dependent values survive master off/on');
    assert.equal(await sameSpeaker.isChecked(), false);
    await start(); await play();
    await page.evaluate(() => window.__frame(.95,12));
    assert.ok(await page.evaluate(() => window.__sent.length > 0));
    await page.evaluate(() => window.__asr('请等一下！'));
    assert.equal(await page.evaluate(() => window.__stops), 0);
    await page.evaluate(() => window.__asr('请先等一下！'));
    assert.equal(await page.evaluate(() => window.__stops), 1);
    assert.equal(speakerRequests, 0, 'neither enrollment nor verification runs when disabled');
    await stop();
    assert.equal(await sameSpeaker.isDisabled(), false);
    await sameSpeaker.locator('..').click();
    await start();
    assert.equal(await page.evaluate(() => window.__voice.voiceService.value.speaker.interruption.requireSameSpeaker), true);
    await stop();
  } finally { await context.close(); }
});

test('VAD end diagnostics distinguish model classifications from continuing nonzero microphone audio', async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    const result = await page.evaluate(async () => {
      const { default: VoiceService } = await import('/src/utils/Services/VoiceService.js');
      const logs = [];
      const original = console.info;
      console.info = (prefix, data) => { if (prefix === '[voice]') logs.push(data); };
      try {
        const instance = { appContext: { config: { globalProperties: { $uuid: () => 'diagnostic' } } } };
        const service = new VoiceService(.7, .5, 10, 32, 400, instance, () => {}, null, null);
        service.sendAudioData = () => {};
        service.speaker.client.extract = async () => [1, 0];
        for (let i = 0; i < 25; i++) service.voiceTranslate({ isSpeech: .95 }, new Float32Array(512).fill(.1));
        // Audio still has amplitude; only the model's speech probability changes.
        for (let i = 0; i < 32; i++) service.voiceTranslate({ isSpeech: .45 }, new Float32Array(512).fill(.1));
        await new Promise(resolve => setTimeout(resolve, 0));
        service.reset();
        return logs.find(log => log.event === 'vad.end');
      } finally { console.info = original; }
    });
    assert.equal(result.chunks, 57);
    assert.equal(result.speechFrames, 25);
    assert.equal(result.nonSpeechFrames, 32);
    assert.equal(result.positiveThreshold, .7);
    assert.equal(result.negativeThreshold, .5);
    assert.equal(result.endWindowMs, 1024);
    assert.equal(result.reason, 'vad_end_threshold');
  } finally { await context.close(); }
});

test('speech above the ongoing threshold cancels a brief low-confidence gap instead of ending continuous speech', async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    const result = await page.evaluate(async () => {
      const { default: VoiceService } = await import('/src/utils/Services/VoiceService.js');
      const instance = { appContext: { config: { globalProperties: { $uuid: () => 'continuous' } } } };
      const service = new VoiceService(.7, .5, 10, 32, 400, instance, () => {}, null, null);
      const statuses = [];
      service.sendAudioData = (id, audio, status) => statuses.push(status);
      service.speaker.client.extract = async () => [1, 0];
      const feed = (probability, count) => {
        for (let i = 0; i < count; i++) service.voiceTranslate({ isSpeech: probability }, new Float32Array(512).fill(.1));
      };
      feed(.95, 12); feed(.1, 2); feed(.6, 40);
      const endedWhileSpeaking = statuses.includes(2);
      feed(.1, 31);
      const endedBeforeTimeout = statuses.includes(2);
      feed(.1, 1);
      const ends = statuses.filter(status => status === 2).length;
      service.reset();
      return { endedWhileSpeaking, endedBeforeTimeout, ends };
    });
    assert.deepEqual(result, { endedWhileSpeaking: false, endedBeforeTimeout: false, ends: 1 });
  } finally { await context.close(); }
});

for (const mobile of [false, true]) for (const format of ['PCM', 'MP3']) test(`${mobile ? 'mobile' : 'desktop'} ${format} opening can be interrupted before a speaker exists`, async () => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...(mobile ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone) Mobile' } : {}),
  });
  try {
    await context.addInitScript(() => sessionStorage.setItem('voice-client-login', '1'));
    const page = await context.newPage();
    await page.route('**/src/utils/Services/VoiceRuntime.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function createVoiceDetector(options) {
        window.__frame = (p, n) => { for(let i=0;i<n;i++) options.onFrameProcessed({isSpeech:p}, new Float32Array(512).fill(.1)); };
        return {start:async()=>{},pause:async()=>{},destroy:async()=>{}};
      }` }));
    await page.route('**/src/utils/Services/AiAgentService.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export default class AiAgentService { constructor(id){this.uuid=id} isMine(id){return this.uuid===id} async sendQuestion(){window.__questions=(window.__questions||0)+1} }` }));
    let extractions = 0, verifications = 0;
    await page.route('**/speaker-api/v1/embedding', route => {
      extractions++; return route.fulfill({ json: { embedding: [1, ...Array(191).fill(0)] } });
    });
    await page.route('**/speaker-api/v1/verify', route => {
      verifications++; return route.fulfill({ json: { matched: false, score: .1 } });
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor();
    await page.evaluate(async format => {
      const v = window.__voice;
      window.__sent = []; window.__stops = 0;
      v.voiceService.value.sendAudioData = (id, pcm, status) => window.__sent.push({ id, status });
      v.audioService.value.OptionTextDataToTTS = () => {};
      v.enableOpening();
      await v.toggleVAD(); // Exercise the actual opening greeting entry point.
      v.soundEncode.value = format;
      if (format === 'PCM') v.audioBufferSource.value = {stop(){window.__stops++},disconnect(){}};
      else v.audioObj.value = {load(){window.__stops++}};
      v.playSoundStatus.value = true;
      window.__asr = (text, status = 1) => v.showVociceText(window.__sent[0].id,
        JSON.stringify({code:0,data:{status,result:{sn:1,ws:[{cw:[{w:text}]}]}}}));
      window.__frame(.95,60);
    }, format);
    assert.ok(await page.evaluate(() => window.__sent.length > 0), 'opening speech must reach ASR without a reference speaker');
    await assertEventually(() => extractions === 1);
    assert.equal(verifications, 0);
    await page.evaluate(() => window.__asr('等，下！'));
    assert.equal(await page.evaluate(() => window.__stops), 0);
    await page.evaluate(() => window.__asr('请等一下'));
    assert.equal(await page.evaluate(() => window.__stops), 1);
    assert.equal(await page.evaluate(() => window.__voice.audioService.value.audioTexts.length), 0);
    await page.evaluate(async () => {
      window.__frame(0,55);
      await window.__asr('请等一下', 2);
      window.__sent = [];
      window.__voice.playSoundStatus.value = true;
      window.__frame(.95,60);
    });
    assert.equal(await page.evaluate(() => window.__questions), 1);
    await assertEventually(() => verifications === 2);
    assert.equal(await page.evaluate(() => window.__sent.length), 0, 'subsequent replies must require the new speaker to match');
    assert.equal(await page.evaluate(() => window.__stops), 1);
  } finally { await context.close(); }
});

for (const mobile of [false, true]) for (const opening of [false, true]) for (const frames of (opening ? [25, 60] : [32, 60])) test(`${mobile ? 'mobile' : 'desktop'} ${opening ? 'opening' : 'reply'} ${frames * 32}ms interruption preserves quiet onset through actual ASR packets`, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(async ({ mobile, opening, frames }) => {
      window.__packets = []; window.__verified = [];
      window.WebSocket = class {
        static OPEN = 1;
        constructor() { this.readyState = 1; queueMicrotask(() => this.onopen?.()); }
        send(packet) { window.__packets.push(JSON.parse(packet)); }
        close() { this.readyState = 3; }
      };
      const { default: VoiceService } = await import('/src/utils/Services/VoiceService.js');
      const { default: XfWebSocketTool } = await import('/src/utils/WebSocket/XfWebSocketTool.js');
      const { OFFICE_VAD_PARAMETERS, NOISY_VAD_PARAMETERS, toVoiceServiceParams } = await import('/src/utils/Services/VadEnvironments.js');
      XfWebSocketTool.prototype.getAuthUrl = () => 'ws://test';
      let replying = false;
      const instance = { appContext: { config: { globalProperties: { $uuid: () => 'candidate' } } } };
      const service = window.__service = new VoiceService(...toVoiceServiceParams(mobile ? NOISY_VAD_PARAMETERS : OFFICE_VAD_PARAMETERS),
        instance, () => {}, null, null, { isReplyActive: () => replying });
      service.speaker.client = {
        extract: async () => [1, 0],
        verify: async pcm => { window.__verified.push(pcm[0] | pcm[1] << 8); return true; },
      };
      if (opening) service.speaker.beginOpening();
      else {
        for (let i = 0; i < 47; i++) service.speaker.push('owner', new Uint8Array(1024), i ? 1 : 0, true);
        service.speaker.push('owner', new Uint8Array(1024), 2, false);
        service.speaker.activateQuestion('owner');
        await new Promise(resolve => setTimeout(resolve, 0));
        service.webSockets.slice().forEach(socket => socket.close());
      }
      window.__packets = []; replying = true;
      // Quiet onset followed by a short or long spoken phrase.
      for (let i = 0; i < 24; i++) service.voiceTranslate({ isSpeech: .1 }, new Float32Array(512).fill(.01));
      for (let i = 0; i < frames; i++) service.voiceTranslate({ isSpeech: .95 }, new Float32Array(512).fill(.15));
      for (let i = 0; i < 55; i++) service.voiceTranslate({ isSpeech: 0 }, new Float32Array(512));
    }, { mobile, opening, frames });
    await page.waitForFunction(() => window.__packets.at(-1)?.data.status === 2);
    const result = await page.evaluate((frames) => ({
      starts: window.__packets.filter(packet => packet.data.status === 0).length,
      samples: window.__packets.filter(packet => packet.data.audio).map(packet => {
        const bytes = atob(packet.data.audio); return bytes.charCodeAt(0) | bytes.charCodeAt(1) << 8;
      }).slice(0, 24 + frames),
      verified: window.__verified,
    }), frames);
    assert.equal(result.starts, 1);
    assert.deepEqual(result.samples, [...Array(24).fill(327), ...Array(frames).fill(4915)], 'quiet onset and voiced frames must arrive once, in order');
    assert.deepEqual(result.verified, opening ? [] : [4915], 'quiet onset must not contaminate the speaker verification window');
    await page.evaluate(() => window.__service.reset());
  } finally { await context.close(); }
});

test('early ASR final retires VoiceService sender while local VAD still has frames', async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(async () => {
      window.__packets = [];
      window.WebSocket = class {
        static OPEN = 1;
        constructor() { this.readyState = 1; window.__socket = this; queueMicrotask(() => this.onopen?.()); }
        send(packet) { window.__packets.push(JSON.parse(packet)); }
        close() { this.readyState = 3; }
      };
      const { default: VoiceService } = await import('/src/utils/Services/VoiceService.js');
      const { default: XfWebSocketTool } = await import('/src/utils/WebSocket/XfWebSocketTool.js');
      XfWebSocketTool.prototype.getAuthUrl = () => 'ws://test';
      window.__service = new VoiceService(.55, .35, 7, 38, 250, null, (id) => {
        window.__service.getWebSocketShiftByUUID(id)?.close();
        window.__service.speaker.finish(id);
      }, null, null);
      window.__service.speaker.push('early-final', new Uint8Array(1024), 0, true);
    });
    await page.waitForFunction(() => window.__packets.length === 1);
    await page.evaluate(() => {
      window.__socket.onmessage({ data: JSON.stringify({ code: 0, data: { status: 2 } }) });
      // ASR can finish before the configured 38 silence frames end at the client.
      for (let i = 0; i < 38; i++) window.__service.speaker.push('early-final', new Uint8Array(1024), 1, false);
      window.__service.speaker.push('early-final', new Uint8Array(1024), 2, false);
    });
    await page.waitForTimeout(2300);
    assert.equal(await page.evaluate(() => window.__packets.length), 1);
    assert.equal(await page.evaluate(() => window.__service.webSockets.length), 0);
    assert.equal(errors.some(line => /循环200次|未检测到结束|发送队列/.test(line)), false);
    await page.evaluate(() => window.__service.reset());
  } finally { await context.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} TTS disconnect skips partial and empty failed segments without blocking later replies`, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true,
    ...(mobile ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone) Mobile' } : {}),
  });
  try {
    await context.addInitScript(() => sessionStorage.setItem('voice-client-login', '1'));
    const page = await context.newPage();
    await page.route('**/src/utils/Services/VoiceRuntime.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function createVoiceDetector() { return {start:async()=>{},pause:async()=>{},destroy:async()=>{}}; }` }));
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor();
    const result = await page.evaluate(async () => {
      window.__ttsSockets = [];
      window.WebSocket = class {
        static OPEN = 1;
        constructor() { this.readyState = 1; window.__ttsSockets.push(this); queueMicrotask(() => this.onopen?.()); }
        send() {}
        close() { this.readyState = 3; }
      };
      const { default: XfWebSocketTool } = await import('/src/utils/WebSocket/XfWebSocketTool.js');
      XfWebSocketTool.prototype.getAuthUrl = () => 'ws://test';
      const v = window.__voice;
      v.playSoundStatus.value = true; // Keep polling from consuming test segments.
      v.soundEncode.value = 'MP3';
      const owner = '11111111-1111-4111-8111-111111111111';
      for (let i = 1; i <= 3; i++) v.audioService.value.OptionTextDataToTTS(`${owner}${i},${i === 3}`, '合成内容');
      await new Promise(resolve => setTimeout(resolve, 30));
      const [first, second, third] = window.__ttsSockets;
      const emit = (socket, status) => socket.onmessage({data: JSON.stringify({code:0,data:{status,audio:'AAA='}})});
      emit(first, 1);
      emit(second, 2);
      first.onclose({code:1006});
      third.onclose({code:1006}); // Failure before the first audio response must also be skipped.
      const next = v.GetVoicePlay();
      if (next) { v.play_UUID.value = next.uuidOrg; v.play_Num.value = next.uuidNum; }
      const after = v.GetVoicePlay();
      return { next: next?.uuidNum, complete: next?.SoundAll instanceof Blob, after: after?.uuidNum ?? null,
        remaining: v.audioSounds.value.length, sockets: v.audioService.value.webSockets.length,
        owner: v.play_UUID.value, number: v.play_Num.value };
    });
    assert.deepEqual(result, { next: 2, complete: true, after: null, remaining: 0, sockets: 0, owner: '', number: 0 });
  } finally { await context.close(); }
});

for (const mobile of [false, true]) for (const action of ['pagehide', 'stop']) test(`${mobile ? 'mobile' : 'desktop'} ${action} clears capture even when VAD pause fails`, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true,
    ...(mobile ? { userAgent: 'Mozilla/5.0 (iPhone) Mobile' } : {}),
  });
  try {
    await context.addInitScript(() => sessionStorage.setItem('voice-client-login', '1'));
    const page = await context.newPage();
    await page.route('**/src/utils/Services/VoiceRuntime.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function createVoiceDetector(options) {
        window.__lateFrame = () => options.onFrameProcessed({isSpeech:.95}, new Float32Array(512).fill(.1));
        return { start:async()=>{}, pause:async()=>{throw Error('device gone')}, destroy:async()=>{} };
      }` }));
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText('语音引擎已就绪', { exact: true }).first().waitFor();
    const result = await page.evaluate(async action => {
      const v = window.__voice;
      await v.toggleVAD();
      const service = v.voiceService.value;
      service.sendAudioData = () => {};
      service.speaker.push('pending', new Uint8Array(1024), 0, true);
      const record = service.speaker.records.get('pending');
      let closed = 0;
      service.webSockets.push({ close(){closed++} });
      service.linkedList.push(new Uint8Array(1024));
      if (action === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else await v.toggleVAD();
      for (let i = 0; i < 30; i++) window.__lateFrame();
      return { records: service.speaker.records.size, aborted: record.signal.aborted,
        sockets: service.webSockets.length, buffered: service.linkedList.length, listening: v.listening.value, closed };
    }, action);
    assert.deepEqual(result, { records: 0, aborted: true, sockets: 0, buffered: 0, listening: false, closed: 1 });
  } finally { await context.close(); }
});

test('idle expiry closes ASR and resets capture so new speech starts a fresh utterance', async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    const result = await page.evaluate(async () => {
      const { default: VoiceService } = await import('/src/utils/Services/VoiceService.js');
      const service = new VoiceService(.55, .35, 7, 38, 250,
        {appContext:{config:{globalProperties:{$uuid:()=> 'new'}}}}, () => {}, null, null);
      service.sendAudioData = () => {};
      service.speaker.push('old', new Uint8Array(1024), 0, true);
      let closed = 0;
      service.webSockets.push({isMine: id => id === 'old', close: () => {closed++}});
      service.uuidAsr = 'old'; service.isSend = service.isTrigger = true;
      service.linkedList.push(new Uint8Array(1024));
      service.speaker.records.get('old').lastFrameAt -= 11000;
      service.speaker.expireRecords();
      const clean = { closed, sockets: service.webSockets.length, buffered: service.linkedList.length,
        id: service.uuidAsr, sending: service.isSend, records: service.speaker.records.size };
      for (let i = 0; i < 25; i++) service.voiceTranslate({isSpeech:.95}, new Float32Array(512).fill(.1));
      const recovered = service.speaker.has('new');
      service.reset();
      return {clean, recovered};
    });
    assert.deepEqual(result, {clean: {closed: 1, sockets: 0, buffered: 0, id: '', sending: false, records: 0}, recovered: true});
  } finally { await context.close(); }
});
