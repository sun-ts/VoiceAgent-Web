import { voiceLog } from './VoiceDiagnostics.js';
import { DEFAULT_INTERRUPTION_SETTINGS, normalizeInterruptionSettings } from './InterruptionSettings.js';

export function speakerWindowChunks(value) {
  const milliseconds = Number(value);
  // The API requires >=200ms; the first probe cannot exceed the 1504ms retry.
  return Number.isFinite(milliseconds) && milliseconds >= 200 && milliseconds <= 1504
    ? Math.ceil(milliseconds / 32) : 32;
}

const WINDOW_CHUNKS = speakerWindowChunks(import.meta.env?.VITE_SPEAKER_WINDOW_MS);
const EXTENDED_WINDOW_CHUNKS = 47; // Retry a short mismatch with 1504ms before discarding it.
const MIN_FINAL_CHUNKS = WINDOW_CHUNKS; // Completed phrases use the same configured minimum.
const ENROLL_BYTES = 48000; // Registration remains capped at exactly 1500ms.
const IDLE_TIMEOUT_MS = 10000;
const MAX_UTTERANCE_MS = 120000;
const MAX_PENDING_CHUNKS = 188; // Keep the existing ~6s backlog limit independent of window size.

export function hasInterruptionText(text, minCharacters = DEFAULT_INTERRUPTION_SETTINGS.minCharacters) {
  return (text.match(/[\p{L}\p{N}]/gu) || []).length >= minCharacters;
}

function join(chunks, limit = Infinity) {
  const bytes = Math.min(limit, chunks.reduce((size, chunk) => size + chunk.length, 0));
  const pcm = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes - offset);
    pcm.set(part, offset);
    offset += part.length;
    if (offset === bytes) break;
  }
  return pcm;
}

/** Owns only ephemeral speaker/utterance state. No audio survives reset(). */
export default class SpeakerSession {
  constructor({ client, isReplyActive, send, onError = () => {}, onDiscard = () => {} }) {
    Object.assign(this, { client, isReplyActive, send, onError, onDiscard });
    this.records = new Map();
    this.cleanupTimer = null;
    this.owner = null;
    this.opening = false;
    this.revision = 0;
    this.interruption = { ...DEFAULT_INTERRUPTION_SETTINGS };
  }

  has(id) { return this.records.has(id); }

  configureInterruption(settings) {
    const next = normalizeInterruptionSettings(settings);
    if (Object.keys(next).every(key => next[key] === this.interruption[key])) return;
    // Applied before capture starts. Retire old requests and reference audio
    // before a new run can use different interruption rules.
    this.reset();
    this.interruption = next;
    voiceLog('interrupt.settings', next);
  }

  beginOpening() {
    // A greeting has no questioner to verify against. Only this explicit
    // playback mode may enroll the first speaker while a reply is active.
    this.owner?.controller.abort();
    this.owner = null;
    this.opening = true;
    this.revision++;
  }

  push(id, pcm, status, speech = true) {
    if (status === 0) {
      this.expireRecords();
      if (this.records.has(id)) this.drop(this.records.get(id), 'replaced');
      if (this.records.size >= 32) this.drop(this.records.values().next().value, 'record_limit');
      const controller = new AbortController();
      this.records.set(id, {
        id, created: Date.now(), lastFrameAt: Date.now(), protected: this.isReplyActive(), reference: this.owner,
        opening: this.opening, allowAnySpeaker: !this.interruption.requireSameSpeaker,
        revision: this.revision, controller, signal: controller.signal,
        chunks: [], probe: [], silence: [], leading: [], enrollment: [], enrollmentBytes: 0,
        matched: false, authorized: false, started: false, ended: false, busy: false,
        window: 0,
      });
      if (!this.cleanupTimer) {
        this.cleanupTimer = setInterval(() => this.expireRecords(), 1000);
        this.cleanupTimer.unref?.();
      }
      voiceLog('speaker.utterance_start', { utteranceId: id, protected: this.records.get(id).protected,
        referenceReady: Boolean(this.owner?.embeddingReady) });
    }
    const r = this.records.get(id);
    if (!r || r.ended || r.dropped) return;
    if (this.expireRecord(r)) return;
    r.lastFrameAt = Date.now();
    if (r.protected && !this.interruption.enabled) { this.drop(r, 'interruption_disabled'); return; }
    if (r.protected && !this.valid(r)) { this.drop(r, 'stale_question'); return; }
    if (!r.protected || r.opening || r.allowAnySpeaker) {
      this.send(id, pcm, status);
      // Use voiced frames, excluding VAD pre-roll and end silence.
      if (this.interruption.enabled && this.interruption.requireSameSpeaker && speech && r.enrollmentBytes < ENROLL_BYTES) {
        const part = pcm.slice(0, ENROLL_BYTES - r.enrollmentBytes);
        r.enrollment.push(part);
        r.enrollmentBytes += part.length;
      }
      if (r.enrollmentBytes === ENROLL_BYTES || status === 2) this.enroll(r);
      r.ended = status === 2;
      return;
    }
    if (r.matched) {
      this.send(id, pcm, status);
      r.ended = status === 2;
      return;
    }
    if (status === 2) {
      r.ended = true;
      r.silence = [];
    } else if (speech) {
      // Keep internal pauses, but never use trailing silence to fill a window.
      if (r.chunks.length || r.probe.length || r.busy) r.chunks.push(...r.silence);
      r.silence = [];
      r.chunks.push(pcm);
    } else if (r.chunks.length || r.probe.length || r.busy) {
      r.silence.push(pcm);
    } else if (r.window === 0) {
      // VAD's pre-roll may contain quiet consonants before speech crosses the
      // threshold. Replay it to ASR after a match, but do not verify against it.
      r.leading.push(pcm);
    }
    if (r.leading.length + r.probe.length + r.chunks.length + r.silence.length > MAX_PENDING_CHUNKS) {
      this.drop(r, 'buffer_overflow');
      return;
    }
    void this.verify(r);
  }

  enroll(r) {
    if (r.embedding || !this.interruption.enabled || !this.interruption.requireSameSpeaker) return;
    const pcm = join(r.enrollment, ENROLL_BYTES);
    r.enrollment = [];
    voiceLog('speaker.enroll_start', { utteranceId: r.id, durationMs: pcm.length / 32 });
    r.embedding = Promise.resolve().then(() => this.client.extract(pcm, r.signal, { utteranceId: r.id }))
      .then(embedding => {
        if (r.signal.aborted) return null;
        r.embeddingReady = true;
        voiceLog('speaker.enroll_ready', { utteranceId: r.id, durationMs: pcm.length / 32 });
        return embedding;
      })
      .catch(error => {
        voiceLog('speaker.enroll_failed', { utteranceId: r.id, errorType: error.name,
          reason: r.signal.aborted ? 'cancelled' : 'unavailable' }, r.signal.aborted ? 'debug' : 'warn');
        if (!r.signal.aborted) this.onError(error);
        return null;
      });
  }

  valid(r) {
    return !r.signal.aborted && !r.dropped && this.records.get(r.id) === r && r.revision === this.revision && !this.expireRecord(r);
  }

  async verify(r) {
    if (r.busy || r.matched || !this.valid(r)) return;
    r.busy = true;
    try {
      while (this.valid(r)) {
        const extended = r.probe.length > 0;
        const target = extended ? EXTENDED_WINDOW_CHUNKS - r.probe.length : WINDOW_CHUNKS;
        // A completed phrase need not fill the streaming window. Never pad it
        // with trailing silence or retry a probe without any new speech.
        const finalPartial = r.ended && r.chunks.length > 0 &&
          r.probe.length + r.chunks.length >= MIN_FINAL_CHUNKS && r.chunks.length < target;
        if (r.chunks.length < target && !finalPartial) break;
        const needed = finalPartial ? r.chunks.length : target;
        const window = [...r.probe, ...r.chunks.splice(0, needed)];
        // Keep in-flight and retained audio inside the same backlog budget.
        r.probe = window;
        const stage = finalPartial ? (extended ? 'final_extended' : 'final_short') : (extended ? 'extended' : 'short');
        r.window++;
        voiceLog('speaker.window_ready', { utteranceId: r.id, window: r.window, chunks: window.length,
          stage, durationMs: window.length * 32 });
        const embedding = await r.reference?.embedding;
        if (!this.valid(r)) return;
        if (!embedding) { this.drop(r, 'no_reference'); return; }
        let matched = false;
        let failed = false;
        try {
          matched = await this.client.verify(join(window), embedding, r.signal, { utteranceId: r.id, window: r.window, stage });
        } catch (error) {
          failed = true;
          if (!r.signal.aborted) this.onError(error);
        }
        if (!this.valid(r)) {
          voiceLog('speaker.stale_result', { utteranceId: r.id, window: r.window }, 'debug');
          return;
        }
        const extend = !matched && !failed && !extended;
        voiceLog(matched ? 'speaker.window_match' : extend ? 'speaker.window_extend' : 'speaker.window_discard', {
          utteranceId: r.id, window: r.window, chunks: window.length,
          stage, durationMs: window.length * 32,
          reason: matched ? 'same_speaker' : failed ? 'verification_error' : extend ? 'short_window_mismatch' : 'different_speaker' });
        if (matched) {
          r.matched = true;
          // Preserve the verified reference; do not drift toward background voices.
          r.embedding = Promise.resolve(embedding);
          r.embeddingReady = true;
          const accepted = [...r.leading, ...window, ...r.chunks, ...r.silence];
          r.leading = []; r.probe = []; r.chunks = []; r.silence = [];
          accepted.forEach((chunk, i) => this.send(r.id, chunk, i === 0 ? 0 : 1));
          if (r.ended) this.send(r.id, new Uint8Array(), 2);
          return;
        }
        // A short mismatch is provisional: retain its onset for one longer
        // verification. Only a final rejection discards this audio group.
        if (extend) continue;
        r.probe = [];
        r.leading = [];
      }
      if (r.ended) this.drop(r, 'silence_incomplete_window');
    } finally { r.busy = false; }
  }

  expireRecord(r) {
    const now = Date.now();
    const reason = now - r.created >= MAX_UTTERANCE_MS ? 'utterance_timeout' :
      now - r.lastFrameAt >= IDLE_TIMEOUT_MS ? 'audio_idle_timeout' : null;
    if (reason) this.drop(r, reason);
    return Boolean(reason);
  }

  expireRecords() {
    for (const r of this.records.values()) this.expireRecord(r);
  }

  stopCleanupIfEmpty() {
    if (this.records.size) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  releaseAudio(r) {
    r.leading = []; r.probe = []; r.chunks = []; r.silence = []; r.enrollment = [];
    r.reference = null;
  }

  drop(r, reason) {
    voiceLog('speaker.utterance_discard', { utteranceId: r.id, window: r.window,
      chunks: r.probe.length + r.chunks.length, reason });
    r.dropped = true;
    r.controller.abort();
    this.releaseAudio(r);
    if (this.owner === r) this.owner = null;
    this.records.delete(r.id);
    this.stopCleanupIfEmpty();
    this.onDiscard(r.id, reason);
  }

  authorizeText(id, text) {
    const r = this.records.get(id);
    if (!this.interruption.enabled || !r?.protected || (!r.opening && !r.allowAnySpeaker && !r.matched) ||
        r.authorized || !this.valid(r) || !hasInterruptionText(text, this.interruption.minCharacters)) return false;
    r.authorized = true;
    voiceLog('interrupt.authorized', { utteranceId: id, characters: (text.match(/[\p{L}\p{N}]/gu) || []).length,
      minCharacters: this.interruption.minCharacters });
    return true;
  }

  shouldAnswer(id) {
    const r = this.records.get(id);
    return Boolean(r && !r.dropped && (!r.protected || (this.valid(r) && r.authorized)));
  }

  activateQuestion(id) {
    const r = this.records.get(id);
    // ASR may finalize a short question before local VAD emits its end frame.
    // Submit the collected voice before finish() retires the ASR record.
    if (r && !r.embedding && r.enrollmentBytes > 0) this.enroll(r);
    this.opening = false;
    if (this.owner && this.owner !== r) this.owner.controller.abort();
    this.owner = r || null;
    this.revision++;
    if (r) r.revision = this.revision;
    voiceLog('speaker.question_active', { utteranceId: id, referenceReady: Boolean(r?.embeddingReady) });
  }

  finish(id) {
    const r = this.records.get(id);
    if (r?.protected && (r.opening || r.allowAnySpeaker || r.matched) && !r.authorized) voiceLog('interrupt.rejected', {
      utteranceId: id, reason: 'insufficient_characters', minCharacters: this.interruption.minCharacters });
    if (r) {
      this.releaseAudio(r);
      if (r !== this.owner) r.controller.abort();
    }
    this.records.delete(id);
    this.stopCleanupIfEmpty();
  }

  reset() {
    voiceLog('speaker.reset', { count: this.records.size });
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    for (const r of new Set([...this.records.values(), this.owner])) {
      if (!r) continue;
      r.controller.abort();
      this.releaseAudio(r);
    }
    this.records.clear();
    this.owner = null;
    this.opening = false;
    this.revision++;
  }
}
