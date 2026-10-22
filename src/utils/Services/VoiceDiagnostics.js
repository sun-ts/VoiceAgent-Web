const levels = { debug: 10, info: 20, warn: 30, error: 40, off: 100 };
const modules = new Set(['capture', 'vad', 'speaker', 'asr', 'llm', 'tts', 'playback', 'interrupt']);

function setting(key, fallback) {
  try { return globalThis.localStorage?.getItem(key) ?? fallback; } catch { return fallback; }
}

function normalizeLevel(level) {
  const value = String(level).trim().toLowerCase();
  return Object.hasOwn(levels, value) ? value : 'info';
}

function moduleFor(event, fields) {
  const prefix = event.split('.')[0];
  if (prefix === 'asr_tts') {
    const stage = String(fields.stage).toLowerCase();
    return ['asr', 'tts'].includes(stage) ? stage : 'other';
  }
  return modules.has(prefix) ? prefix : 'other';
}
// Metadata only: never PCM, embeddings, transcript or signed URLs.
const fieldsAllowed = new Set(['utteranceId', 'requestId', 'stage', 'reason', 'window', 'chunks',
  'durationMs', 'elapsedMs', 'status', 'code', 'score', 'threshold', 'matched', 'protected',
  'referenceReady', 'characters', 'queued', 'sentFrames', 'receivedFrames', 'idleMs', 'errorType',
  'count', 'endpoint', 'speechFrames', 'nonSpeechFrames', 'positiveThreshold', 'negativeThreshold', 'endWindowMs',
  'enabled', 'requireSameSpeaker', 'minCharacters']);

export function voiceLog(event, fields = {}, level = 'info') {
  const configured = normalizeLevel(setting('voice-log-level', import.meta.env?.VITE_VOICE_LOG_LEVEL || 'info'));
  level = normalizeLevel(level);
  if (level === 'off' || levels[level] < levels[configured]) return;
  const module = moduleFor(event, fields);
  const selected = new Set(setting('voice-log-modules', import.meta.env?.VITE_VOICE_LOG_MODULES ?? '*')
    .toLowerCase().split(',').map(value => value.trim()).filter(Boolean));
  if (selected.has('off') || selected.has('none') ||
      (!selected.has('*') && !selected.has('all') && !selected.has(module))) return;
  const safe = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
    fieldsAllowed.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 160) : value]));
  console[level]('[voice]', { time: new Date().toISOString(), event, module, ...safe });
}
