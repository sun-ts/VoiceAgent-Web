import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLog } from '../src/utils/Services/VoiceDiagnostics.js';
import SpeakerClient from '../src/utils/Services/SpeakerClient.js';
import { log as vadLog } from '../src/utils/Services/VadLogger.js';

function runtimeConfig(t, initial = {}) {
  const values = new Map(Object.entries(initial));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : delete globalThis.localStorage);
  return values;
}

test('module selection filters each stage and distinguishes ASR from TTS transport', t => {
  runtimeConfig(t, { 'voice-log-modules': 'ASR, interrupt', 'voice-log-level': 'debug' });
  const entries = [];
  for (const level of ['info', 'warn', 'debug', 'error']) t.mock.method(console, level, (...args) => entries.push(args[1]));
  for (const module of ['capture', 'vad', 'speaker', 'asr', 'llm', 'tts', 'playback', 'interrupt']) voiceLog(`${module}.test`);
  voiceLog('asr_tts.open', { stage: 'ASR' }, 'debug');
  voiceLog('asr_tts.socket_error', { stage: 'TTS' }, 'error');
  assert.deepEqual(entries.map(entry => entry.event), ['asr.test', 'interrupt.test', 'asr_tts.open']);
  assert.deepEqual(entries.map(entry => entry.module), ['asr', 'interrupt', 'asr']);
});

test('module and level changes take effect immediately and both filters must pass', t => {
  const config = runtimeConfig(t, { 'voice-log-modules': 'speaker', 'voice-log-level': 'warn' });
  const entries = [];
  for (const level of ['info', 'warn', 'debug', 'error']) t.mock.method(console, level, (...args) => entries.push(args[1]));
  voiceLog('speaker.start');
  voiceLog('asr.failed', {}, 'error');
  voiceLog('speaker.failed', {}, 'warn');
  config.set('voice-log-modules', 'tts'); config.set('voice-log-level', 'debug');
  voiceLog('asr_tts.open', { stage: 'TTS' }, 'debug');
  config.set('voice-log-level', 'off');
  voiceLog('tts.failed', {}, 'error');
  assert.deepEqual(entries.map(entry => entry.event), ['speaker.failed', 'asr_tts.open']);
});

test('all enables every module while off and empty disable even errors', t => {
  const config = runtimeConfig(t);
  const entries = [];
  t.mock.method(console, 'error', (...args) => entries.push(args[1]));
  for (const selection of ['*', 'all', 'off', '', 'none']) {
    config.set('voice-log-modules', selection);
    voiceLog('playback.failed', {}, 'error');
  }
  assert.equal(entries.length, 2);
});

test('denied storage and invalid levels cannot break the voice pipeline', t => {
  runtimeConfig(t);
  t.mock.method(globalThis.localStorage, 'getItem', () => { throw new Error('blocked'); });
  const entries = [];
  t.mock.method(console, 'info', (...args) => entries.push(args[1]));
  voiceLog('vad.test', {}, 'unknown');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].module, 'vad');
});

test('VAD library adapter obeys the same module and level switches', t => {
  const config = runtimeConfig(t, { 'voice-log-modules': 'asr', 'voice-log-level': 'debug' });
  const entries = [];
  t.mock.method(console, 'debug', (...args) => entries.push(args[1]));
  vadLog.debug('Loading VAD...');
  assert.equal(entries.length, 0);
  config.set('voice-log-modules', 'vad');
  vadLog.debug('Loading VAD...');
  assert.equal(entries[0].module, 'vad');
  assert.equal(entries[0].reason, 'Loading VAD...');
});

test('Vite defaults apply until browser storage overrides them, and removal restores defaults', async t => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
    server: { middlewareMode: true }, define: {
      'import.meta.env.VITE_VOICE_LOG_MODULES': JSON.stringify('tts'),
      'import.meta.env.VITE_VOICE_LOG_LEVEL': JSON.stringify('warn'),
    } });
  try {
    const transformed = await server.transformRequest('/src/utils/Services/VoiceDiagnostics.js');
    const { voiceLog: builtLog } = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`);
    const config = runtimeConfig(t);
    const entries = [];
    for (const level of ['info', 'debug', 'warn', 'error']) t.mock.method(console, level, (...args) => entries.push(args[1]));
    builtLog('tts.start'); builtLog('asr.failed', {}, 'error'); builtLog('tts.failed', {}, 'warn');
    config.set('voice-log-modules', 'asr'); config.set('voice-log-level', 'debug');
    builtLog('tts.failed', {}, 'warn'); builtLog('asr.start', {}, 'debug');
    config.clear(); builtLog('tts.failed', {}, 'warn');
    assert.deepEqual(entries.map(entry => entry.event), ['tts.failed', 'asr.start', 'tts.failed']);
  } finally { await server.close(); }
});

test('diagnostics retain correlation metadata but never log audio, vector or transcript', t => {
  const entries = [];
  t.mock.method(console, 'info', (...args) => entries.push(args));
  voiceLog('speaker.test', { utteranceId: 'u1', requestId: 'r1', durationMs: 1024,
    pcm_base64: 'private-pcm', embedding: [1, 0], text: 'private-question', url: 'secret-url' });
  assert.equal(entries[0][1].requestId, 'r1');
  assert.equal(entries[0][1].durationMs, 1024);
  assert.ok(!JSON.stringify(entries).includes('private'));
  assert.ok(!JSON.stringify(entries).includes('secret-url'));
});

test('HTTP verification uses same request ID in outgoing header and result log', async t => {
  const entries = [];
  t.mock.method(console, 'info', (...args) => entries.push(args[1]));
  let header;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    header = options.headers['X-Request-ID'];
    assert.equal(JSON.parse(options.body).sample_rate, 16000);
    return new Response(JSON.stringify({ matched: true, score: .85, threshold: .6 }), { status: 200 });
  });
  const client = new SpeakerClient({ baseUrl: '/speaker-api' });
  assert.equal(await client.verify(new Uint8Array(32768), [1, 0], undefined, { utteranceId: 'u1', window: 2 }), true);
  const result = entries.find(item => item.event === 'speaker.http_result');
  assert.equal(result.requestId, header);
  assert.equal(result.utteranceId, 'u1');
  assert.equal(result.window, 2);
  assert.equal(result.score, .85);
  assert.equal(result.durationMs, 1024);
});
