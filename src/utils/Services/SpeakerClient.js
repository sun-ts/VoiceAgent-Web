import { voiceLog } from './VoiceDiagnostics.js';
import { v4 as uuidv4 } from 'uuid';

function base64(pcm) {
  let binary = '';
  for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
  return btoa(binary);
}

export default class SpeakerClient {
  constructor({ baseUrl = import.meta.env?.VITE_SPEAKER_API_URL || '/speaker-api', timeoutMs = 5000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(path, pcm, extra, signal, context = {}) {
    const requestId = uuidv4();
    const started = performance.now();
    const fields = { ...context, requestId, endpoint: path, durationMs: pcm.length / 32 };
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, this.timeoutMs);
    voiceLog('speaker.http_start', fields);
    try {
      const response = await fetch(`${this.baseUrl}/v1/${path}`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
        body: JSON.stringify({ pcm_base64: base64(pcm), sample_rate: 16000, ...extra }),
      });
      let elapsedMs = Math.round(performance.now() - started);
      if (!response.ok) {
        voiceLog('speaker.http_error', { ...fields, status: response.status, elapsedMs }, 'warn');
        throw new Error(`声纹服务 HTTP ${response.status}`);
      }
      const result = await response.json();
      elapsedMs = Math.round(performance.now() - started);
      voiceLog('speaker.http_result', { ...fields, status: response.status, elapsedMs,
        matched: result.matched, score: result.score, threshold: result.threshold });
      return result;
    } catch (error) {
      voiceLog('speaker.http_failed', { ...fields, elapsedMs: Math.round(performance.now() - started),
        reason: timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : 'request_failed',
        errorType: error.name }, signal?.aborted ? 'debug' : 'warn');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async extract(pcm, signal, context) {
    const result = await this.request('embedding', pcm, {}, signal, context);
    if (!Array.isArray(result.embedding) || result.embedding.length !== 192 ||
        !result.embedding.every(Number.isFinite) || !result.embedding.some(value => value !== 0)) {
      throw new Error('无效的 CAM++ 声纹向量');
    }
    return result.embedding;
  }

  async verify(pcm, embedding, signal, context) {
    const result = await this.request('verify', pcm, { reference_embedding: embedding }, signal, context);
    return result.matched === true && Number.isFinite(result.score);
  }
}
