# ASR sender lifecycle and speaker diagnostics

User report: browser repeatedly logs “循环200次，耗时2S未检测到结束发送标识”; add frontend/backend logs to verify the new speaker feature.

Root cause reproduced: ASR can finish before local VAD. Final callback deletes speaker state, subsequent VAD packets no longer reach the outer sender, yet its 10ms polling loop remains until its 200-tick timeout. The inner WebSocket sender also failed to stop on terminal messages or remote close. This creates orphan senders, late packets and misleading errors.

Implementation:

- [x] Reproduce final/remote-close late sends in WebSocket lifecycle tests.
- [x] Remove VoiceService's duplicate transfer queue/poller. WebSocketSendTool exclusively owns its queue, terminal handling and timers; all closes discard queued audio.
- [x] Distinguish 10s connection timeout, 5s missing input frames and 15s final-result timeout; silence itself is still a stream of PCM frames.
- [x] Add browser regression exercising real VoiceService early-final cleanup.
- [x] Add frontend metadata logs for VAD, enrollment, verification windows, HTTP, ASR/TTS and playback. INFO default; runtime/configurable severity; no frame-by-frame spam.
- [x] Correlate frontend requestId with server request_id through X-Request-ID; allow/expose header in CORS. Use existing uuid dependency for browser compatibility.
- [x] Add backend JSON startup/download, bounded queue, worker timings, score/threshold, HTTP outcomes and timeout logs. Keep PCM, embeddings, transcript and credentials out of logs.
- [x] Document log events, request tracing, deployment updates and log levels; rotate Docker logs.
- [x] Extend result idle timeout on streaming responses; skip failed TTS segments in both players without retaining incomplete audio. Added regressions for partial/empty failures and normal final preservation.
- [x] Final whole-suite regression/build/config checks and focused review.

Validation is local/simulated; no GX10 or production browser session is connected. Do not attribute every production error to this reproduced lifecycle bug without the new runtime logs.

Focused review found two TTS edge cases; both were reproduced before repair and re-reviewed without further required findings. Initial parallel whole-suite run hit two browser initialization timeouts while multiple Vite servers shared the dependency cache; rerunning serially to isolate browser setup.

Final validation: production build passed (existing large-bundle warning); frontend suite passed 37/37 with `node --test --test-concurrency=1 tests/*.test.mjs` using installed Chrome; Python service tests passed 8/8; Compose config and `git diff --check` passed. Both initialization timeouts from the parallel run passed serially. No GX10 inference or deployed-site verification performed.
