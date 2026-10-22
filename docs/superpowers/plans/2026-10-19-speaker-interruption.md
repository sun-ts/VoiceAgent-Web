# CAM++ speaker interruption implementation plan

**Goal:** Deliver a copyable GX10 Docker Compose service and speaker-aware interruption in both voice pages.

**Architecture:** Keep existing VAD/ASR/TTS. Route VAD-confirmed PCM through a shared speaker session before ASR. Normal questions stream immediately and collect at most 24000 samples for enrollment. During a response, try 32 × 512 samples first, then extend a mismatch to 47 frames before finally discarding that audio group. A group must match the active question's embedding before any audio reaches ASR. Playback continues until at least three letters/numbers are recognized.

**Tech stack:** Vue/Vite, native fetch, FastAPI, FunASR CAM++, NVIDIA ARM64 PyTorch container.

## Constraints and decisions

- 16 kHz mono PCM16 little endian; 32ms = 512 samples = 1024 bytes.
- Enrollment ≤1500ms; first verification 32 chunks = 1024ms. One retry extends the same audio to 47 chunks = 1504ms, without lowering the threshold. Enrollment remains capped at exactly 1500ms.
- “声纹翻译” means embedding extraction; existing Xunfei performs transcription.
- Discard incomplete trailing windows on existing VAD silence end; silence must not pad a candidate to the required 32 or 47 frames.
- A short mismatch retains its onset for one extended verification. A failed extended verification or request error discards that audio group and starts a fresh non-overlapping group. Bounded buffers include retained/in-flight frames; failure keeps playback running.
- Keep embeddings in browser memory only. Service is stateless between requests and uses independent model instances for concurrent inference.
- Typed questions without a speaker reference remain protected. Opening greetings explicitly allow the first speaker's audio into ASR and enrollment; at least three meaningful characters are still required to stop playback. Activating the question or resetting capture clears the opening exception, so subsequent replies require speaker verification.
- Work in the current clean checkout; no deployment target access supplied. Do not claim GPU validation without GX10 execution.

## Tasks

- [x] Speaker client/session: write and run failing behavior tests for enrollment cap, 31/32 boundary, mismatch then match, trailing silence, async enrollment, stale reset, overload and character threshold; implement fetch contract and bounded per-utterance state.
- [x] Integrate VoiceService packet routing and both pages: playback must remain uninterrupted before authorization; stop PCM and MP3 only on matching + text threshold. Invalidate pending work on stop/unmount and typed questions. Browser tests exercise both pages.
- [x] Service: test validation, cosine matching, isolation and bounded concurrent requests using deterministic model boundary; implement production CAM++ model adapter, model download, Compose and API docs.
- [x] Validate: Node behavior tests, Python service tests, existing VAD/loading tests and production build. Inspect full diff and document untested GX10/model performance.

## Review focus

Pending enrollment when interruption begins; short speech followed by long silence; next speaker after rejected window; playback segment changes during ASR; stale network/ASR callbacks after stop or new question. Test each in the owning task.

## Review and verification record

- ModelScope v1.0.0 lacks FunASR config.yaml; verified official v2.0.2 snapshot metadata and pinned v2.0.2 throughout deployment files.
- Independent review reproduced mobile MP3 loading bypass. Added audio element loading state to reply protection and browser regression exercising real mp3Player.
- Stop could leave old LLM/TTS work alive. Added a failing browser regression, then retire outstanding work when stopping and ignore its final callbacks.
- MP3 callbacks now capture their element/URL and ignore callbacks from retired playback; browser regression fires old end/rejection after a new element is active.
- Verification uses installed Chrome through PLAYWRIGHT_CHROMIUM_EXECUTABLE; Playwright's newly expected download was unavailable locally. No production browser/model substitution.
- GX10 GPU build, real recording accuracy and performance remain deployment acceptance checks; no target/daemon was supplied.
- Final validation: production build passed (existing >500KB bundle warning); all 26 Node/browser tests passed; all 6 Python service tests passed; Docker Compose config and git diff whitespace checks passed. No real CAM++ inference was used in these automated tests.
