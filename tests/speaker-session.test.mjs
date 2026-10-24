import { test } from 'node:test';
import assert from 'node:assert/strict';
import SpeakerSession, { hasInterruptionText, speakerWindowChunks } from '../src/utils/Services/SpeakerSession.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const chunk = (value = 1) => new Uint8Array(1024).fill(value);
function setup(overrides = {}) {
  const sent = [], extracted = [], verified = [];
  let replying = false;
  const session = new SpeakerSession({
    client: {
      extract: async pcm => { extracted.push(pcm); return [1, 0]; },
      verify: async (pcm, embedding) => { verified.push({ pcm, embedding }); return true; },
      ...overrides,
    },
    isReplyActive: () => replying,
    send: (id, pcm, status) => sent.push({ id, pcm, status }),
  });
  const feed = (id, count, value = 1, speech = true) => {
    for (let i = 0; i < count; i++) session.push(id, chunk(value), i === 0 && !session.has(id) ? 0 : 1, speech);
  };
  const end = id => session.push(id, chunk(0), 2, false);
  const enroll = async () => { feed('owner', 60); end('owner'); session.activateQuestion('owner'); replying = true; await tick(); };
  return { session, sent, extracted, verified, feed, end, enroll, reply: value => { replying = value; } };
}

test('question enrollment is capped at exactly 1500ms without delaying normal ASR', async () => {
  const h = setup(); h.feed('owner', 60); h.end('owner'); await tick();
  assert.equal(h.extracted[0].length, 48000);
  assert.equal(h.sent.length, 61);
});

test('short question finalized by ASR before VAD ends still supplies the reply reference', async () => {
  const h = setup();
  h.feed('owner', 25); // 800ms question, below the 1500ms enrollment cap.
  h.session.activateQuestion('owner');
  h.session.finish('owner'); // ASR final arrives before local VAD status 2.
  h.reply(true);
  h.sent.length = 0;
  h.feed('candidate', 32);
  await tick();
  assert.equal(h.extracted.length, 1);
  assert.equal(h.extracted[0].length, 25 * 1024);
  assert.equal(h.verified.length, 1);
  assert.equal(h.sent.length, 32);
  assert.equal(h.session.authorizeText('candidate', '请等一下'), true);
});

test('31 chunks cannot interrupt; 32 matching chunks replay to ASR in order', async () => {
  const h = setup(); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 31); await tick(); assert.equal(h.verified.length, 0); assert.equal(h.sent.length, 0);
  h.feed('candidate', 1, 2); await tick();
  assert.equal(h.verified.length, 1, '1024ms of candidate audio must trigger verification');
  assert.equal(h.verified[0].pcm.length, 32768);
  assert.equal(h.sent.length, 32); assert.equal(h.sent[0].status, 0); assert.equal(h.sent[31].pcm[0], 2);
  assert.equal(h.session.authorizeText('candidate', '你好'), false);
  assert.equal(h.session.authorizeText('candidate', '请等下！'), true);
  assert.equal(h.session.authorizeText('candidate', '请等下！'), false);
  assert.equal(h.session.shouldAnswer('candidate'), true);
});

test('short mismatch extends to 47 chunks and replays the original onset only after a match', async () => {
  const lengths = [];
  const h = setup({ verify: async pcm => { lengths.push(pcm.length); return pcm.length === 47 * 1024; } });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 8, 9, false);
  h.feed('candidate', 32, 3); await tick();
  assert.equal(h.sent.length, 0);
  h.feed('candidate', 14, 4); await tick();
  assert.deepEqual(lengths, [32768], 'do not pad the longer retry before 47 frames');
  h.feed('candidate', 1, 5); await tick();
  assert.deepEqual(lengths, [32768, 48128]);
  assert.deepEqual(h.sent.map(frame => frame.pcm[0]), [...Array(8).fill(9), ...Array(32).fill(3), ...Array(14).fill(4), 5]);
  assert.equal(h.sent.filter(frame => frame.status === 0).length, 1);
  assert.equal(h.session.authorizeText('candidate', '等下'), false);
  assert.equal(h.session.authorizeText('candidate', '请等下'), true);
});

test('failed extended window is discarded before a fresh non-overlapping candidate', async () => {
  let calls = 0;
  const h = setup({ verify: async () => ++calls === 3 }); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32, 3); await tick(); assert.equal(h.sent.length, 0);
  h.feed('candidate', 15, 3); await tick(); assert.equal(h.sent.length, 0);
  h.feed('candidate', 32, 4); h.end('candidate'); await tick();
  assert.equal(calls, 3); assert.equal(h.sent.length, 33);
  assert.equal(h.sent[0].pcm[0], 4); assert.equal(h.sent.at(-1).status, 2);
});

test('first matched window restores quiet leading audio to ASR without using it to qualify the speaker', async () => {
  const h = setup(); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 8, 9, false); // 256ms of low-confidence word onset retained by VAD.
  h.feed('candidate', 31, 3); await tick();
  assert.equal(h.sent.length, 0);
  assert.equal(h.verified.length, 0, 'leading audio must not shorten the 32-frame verification window');
  h.feed('candidate', 1, 4); await tick();
  assert.equal(h.verified[0].pcm.length, 32768);
  assert.equal(h.verified[0].pcm[0], 3);
  assert.deepEqual(h.sent.map(frame => frame.pcm[0]), [...Array(8).fill(9), ...Array(31).fill(3), 4]);
  assert.deepEqual(h.sent.map(frame => frame.status), [0, ...Array(39).fill(1)]);
  h.feed('candidate', 1, 5);
  assert.equal(h.sent.at(-1).pcm[0], 5);
  assert.equal(h.sent.length, 41, 'live audio must follow replay without duplicate leading frames');
});

test('delayed speaker verification preserves pauses between buffered speech frames', async () => {
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32, 1); await tick();
  h.feed('candidate', 2, 2, false);
  h.feed('candidate', 3, 3);
  h.end('candidate'); resolve(true); await tick();
  assert.deepEqual(h.sent.slice(0, -1).map(frame => frame.pcm[0]), [...Array(32).fill(1), 2, 2, 3, 3, 3]);
  assert.equal(h.sent.at(-1).status, 2);
});

test('a rejected first window also discards its leading audio before a later match', async () => {
  let calls = 0;
  const h = setup({ verify: async () => ++calls === 3 });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 8, 9, false);
  h.feed('candidate', 32, 3); await tick();
  h.feed('candidate', 15, 3); await tick();
  h.feed('candidate', 32, 4); h.end('candidate'); await tick();
  assert.deepEqual(h.sent.slice(0, -1).map(frame => frame.pcm[0]), Array(32).fill(4));
});

test('silence cannot pad the extended retry and its partial audio never enters the next utterance', async () => {
  const sizes = [];
  const h = setup({ verify: async pcm => { sizes.push(pcm.length); return false; } });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick();
  h.feed('candidate', 14); h.feed('candidate', 38, 0, false); h.end('candidate'); await tick();
  assert.deepEqual(sizes, [32768, 47104]);
  assert.equal(h.sent.length, 0);
  h.feed('next', 31); await tick();
  assert.deepEqual(sizes, [32768, 47104]);
});

test('extended retry preserves internal pauses while excluding trailing silence', async () => {
  let resolve;
  const samples = [];
  const h = setup({ verify: pcm => {
    samples.push(pcm);
    return samples.length === 1 ? Promise.resolve(false) : new Promise(r => { resolve = r; });
  } });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32, 1); await tick();
  h.feed('candidate', 2, 2, false); h.feed('candidate', 13, 3); await tick();
  assert.equal(samples.length, 2);
  assert.equal(samples[1].length, 47 * 1024);
  assert.equal(samples[1][32 * 1024], 2);
  h.feed('candidate', 2, 4, false); h.feed('candidate', 3, 5); h.end('candidate');
  resolve(true); await tick();
  assert.deepEqual(h.sent.slice(0, -1).map(frame => frame.pcm[0]), [...Array(32).fill(1), 2, 2, ...Array(13).fill(3), 4, 4, 5, 5, 5]);
  assert.equal(h.sent.at(-1).status, 2);
});

test('trailing silence cannot complete a short window and is never reused by next utterance', async () => {
  const h = setup(); await h.enroll(); h.sent.length = 0;
  h.feed('short', 31); h.feed('short', 38, 0, false); h.end('short'); await tick();
  assert.equal(h.verified.length, 0); assert.equal(h.sent.length, 0);
  h.feed('next', 31); await tick(); assert.equal(h.verified.length, 0);
});

test('enrollment promise is shared with a candidate arriving before it resolves', async () => {
  let resolve;
  const h = setup({ extract: () => new Promise(r => { resolve = r; }) });
  h.feed('owner', 47); h.end('owner'); h.session.activateQuestion('owner'); h.reply(true);
  h.sent.length = 0; h.feed('candidate', 32); await tick(); assert.equal(h.sent.length, 0);
  resolve([1, 0]); await tick(); assert.equal(h.sent.length, 32);
});

test('reset invalidates in-flight matches and ASR callbacks', async () => {
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) }); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick(); h.session.reset(); resolve(true); await tick();
  assert.equal(h.sent.length, 0); assert.equal(h.session.has('candidate'), false);
  assert.equal(h.session.shouldAnswer('candidate'), false);
});

test('reset also invalidates a successful but late extended verification', async () => {
  let resolve;
  const h = setup({ verify: pcm => pcm.length === 32768 ? Promise.resolve(false) : new Promise(r => { resolve = r; }) });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick();
  h.feed('candidate', 15); await tick();
  assert.equal(typeof resolve, 'function');
  h.session.reset(); resolve(true); await tick();
  assert.equal(h.sent.length, 0);
  assert.equal(h.session.authorizeText('candidate', '请等下'), false);
});

test('extended verification failure never forwards audio and retires that audio group', async () => {
  let calls = 0;
  const h = setup({ verify: async () => {
    calls++;
    if (calls === 2) throw Error('offline');
    return calls === 3;
  } });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32, 1); await tick();
  h.feed('candidate', 15, 2); await tick();
  assert.equal(h.sent.length, 0);
  h.feed('candidate', 32, 3); await tick();
  assert.equal(calls, 3);
  assert.deepEqual(h.sent.map(frame => frame.pcm[0]), Array(32).fill(3));
});

test('new question invalidates a previous reply candidate', async () => {
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) }); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick(); h.session.activateQuestion('typed'); resolve(true); await tick();
  assert.equal(h.sent.length, 0);
});

test('unavailable enrollment or verification never sends candidate audio to ASR', async () => {
  for (const overrides of [{ extract: async () => { throw Error('offline'); } }, { verify: async () => { throw Error('offline'); } }]) {
    const h = setup(overrides); await h.enroll(); h.sent.length = 0; h.feed('candidate', 32); h.end('candidate'); await tick();
    assert.equal(h.sent.length, 0);
  }
});

test('buffer overflow discards candidate instead of replaying unbounded audio', async () => {
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) }); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick(); h.feed('candidate', 500); resolve(true); await tick();
  assert.equal(h.sent.length, 0);
});

test('three meaningful Unicode characters qualify; punctuation and spaces do not', () => {
  assert.equal(hasInterruptionText('你，好！'), false);
  assert.equal(hasInterruptionText('请 等 下。'), true);
  assert.equal(hasInterruptionText(' ？！…'), false);
});

test('disabling interruption blocks both opening and normal reply audio without blocking idle questions', async () => {
  for (const opening of [false, true]) {
    const h = setup();
    h.session.configureInterruption({ enabled: false, requireSameSpeaker: true, minCharacters: 3 });
    h.feed('question', 10); h.end('question'); h.session.activateQuestion('question');
    assert.equal(h.session.shouldAnswer('question'), true);
    assert.equal(h.sent.length, 11);
    h.sent.length = 0; h.reply(true);
    if (opening) h.session.beginOpening();
    h.feed('candidate', 60); h.end('candidate'); await tick();
    assert.equal(h.sent.length, 0);
    assert.equal(h.extracted.length, 0);
    assert.equal(h.verified.length, 0);
    assert.equal(h.session.authorizeText('candidate', '请现在停止播放'), false);
    assert.equal(h.session.shouldAnswer('candidate'), false);
  }
});

test('allowing any speaker skips enrollment and verification but preserves the configured character gate', async () => {
  const h = setup();
  h.session.configureInterruption({ enabled: true, requireSameSpeaker: false, minCharacters: 5 });
  h.reply(true);
  h.feed('candidate', 10); await tick();
  assert.equal(h.sent.length, 10, 'do not wait for a speaker window when verification is disabled');
  assert.equal(h.extracted.length, 0);
  assert.equal(h.verified.length, 0);
  assert.equal(h.session.authorizeText('candidate', '请等一下！'), false);
  assert.equal(h.session.shouldAnswer('candidate'), false);
  assert.equal(h.session.authorizeText('candidate', '请先等一下！'), true);
  assert.equal(h.session.shouldAnswer('candidate'), true);
  h.session.activateQuestion('candidate'); await tick();
  assert.equal(h.extracted.length, 0);
});

test('custom character count applies after a speaker match and to opening interruption', async () => {
  for (const opening of [false, true]) {
    const h = setup();
    h.session.configureInterruption({ enabled: true, requireSameSpeaker: true, minCharacters: 5 });
    if (opening) { h.session.beginOpening(); h.reply(true); }
    else await h.enroll();
    h.feed('candidate', 32); await tick();
    assert.equal(h.session.authorizeText('candidate', '请等一下！'), false);
    assert.equal(h.session.authorizeText('candidate', '请先等一下！'), true);
  }
});

test('changing settings before restart invalidates old matches and reset retains the chosen controls', async () => {
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick();
  h.session.configureInterruption({ enabled: false, requireSameSpeaker: false, minCharacters: 5 });
  resolve(true); await tick();
  assert.equal(h.sent.length, 0);
  h.session.reset();
  h.feed('next', 32); await tick();
  assert.equal(h.sent.length, 0);
  h.session.configureInterruption({ enabled: true, requireSameSpeaker: false, minCharacters: 5 });
  h.feed('restarted', 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.session.authorizeText('restarted', '请等下'), false);
  assert.equal(h.session.authorizeText('restarted', '请先等一下'), true);
});

test('configured text gate counts letters and digits, excluding punctuation and spaces', () => {
  assert.equal(hasInterruptionText('停！', 1), true);
  assert.equal(hasInterruptionText('请 等 一 下！', 5), false);
  assert.equal(hasInterruptionText('请等一下1！', 5), true);
});

test('opening interruption enrolls its first speaker and still requires meaningful text', async () => {
  const h = setup();
  h.session.beginOpening(); h.reply(true);
  h.feed('first-question', 60); h.end('first-question'); await tick();
  assert.equal(h.sent.length, 61);
  assert.equal(h.extracted[0].length, 48000);
  assert.equal(h.verified.length, 0);
  assert.equal(h.session.shouldAnswer('first-question'), false);
  assert.equal(h.session.authorizeText('first-question', '等，下！'), false);
  assert.equal(h.session.authorizeText('first-question', '请等一下'), true);
  assert.equal(h.session.authorizeText('first-question', '请等一下'), false);
  assert.equal(h.session.shouldAnswer('first-question'), true);
  h.session.activateQuestion('first-question'); h.session.finish('first-question');
  h.sent.length = 0;
  h.feed('next', 31); await tick(); assert.equal(h.sent.length, 0);
  h.feed('next', 1); await tick();
  assert.equal(h.verified.length, 1);
  assert.deepEqual(h.verified[0].embedding, [1, 0]);
  assert.equal(h.sent.length, 32);
});

test('opening exception is cleared on reset or question activation, including questions without a voice', async () => {
  for (const clear of [session => session.reset(), session => session.activateQuestion('typed-question')]) {
    const h = setup();
    h.session.beginOpening(); h.reply(true);
    h.feed('old-opening-candidate', 10);
    clear(h.session);
    assert.equal(h.session.authorizeText('old-opening-candidate', '请等一下'), false);
    h.sent.length = 0;
    h.feed('candidate', 32); h.end('candidate'); await tick();
    assert.equal(h.sent.length, 0, 'missing reference on a normal reply must not bypass verification');
    assert.equal(h.session.shouldAnswer('candidate'), false);
  }
});

for (const frames of [32, 37]) test(`ended ${frames * 32}ms phrase can interrupt after speaker and text match`, async () => {
  const h = setup(); await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 8, 9, false);
  h.feed('candidate', frames, 3);
  h.feed('candidate', 38, 0, false); h.end('candidate'); await tick();
  assert.equal(h.verified.length, 1);
  assert.equal(h.verified[0].pcm.length, 32768);
  assert.equal(h.verified[0].pcm[0], 3);
  assert.deepEqual(h.sent.slice(0, -1).map(frame => frame.pcm[0]), [...Array(8).fill(9), ...Array(frames).fill(3)]);
  assert.equal(h.sent[0].status, 0);
  assert.equal(h.sent.at(-1).status, 2);
  assert.equal(h.session.authorizeText('candidate', '等下'), false);
  assert.equal(h.session.authorizeText('candidate', '请等一下'), true);
});

test('ended partial retry preserves onset and can match with new speech below 1504ms', async () => {
  const sizes = [];
  const h = setup({ verify: async pcm => { sizes.push(pcm.length); return sizes.length === 2; } });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32, 3); await tick();
  h.feed('candidate', 5, 4); h.end('candidate'); await tick();
  assert.deepEqual(sizes, [32768, 37888]);
  assert.deepEqual(h.sent.slice(0, -1).map(frame => frame.pcm[0]), [...Array(32).fill(3), ...Array(5).fill(4)]);
  assert.equal(h.sent.at(-1).status, 2);
});

for (const failure of ['mismatch', 'offline']) test(`short phrase ${failure} never bypasses verification or retries identical audio`, async () => {
  let calls = 0;
  const h = setup({ verify: async () => { calls++; if (failure === 'offline') throw Error('offline'); return false; } });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); h.end('candidate'); await tick();
  assert.equal(calls, 1);
  assert.equal(h.sent.length, 0);
  assert.equal(h.session.authorizeText('candidate', '请等一下'), false);
});

test('ending during first verification retries remaining speech exactly once', async () => {
  let resolve;
  const h = setup({ verify: pcm => pcm.length === 32768 ? new Promise(r => { resolve = r; }) : Promise.resolve(true) });
  await h.enroll(); h.sent.length = 0;
  h.feed('candidate', 32); await tick();
  h.feed('candidate', 5); h.end('candidate'); resolve(false); await tick();
  assert.equal(h.sent.length, 38);
  assert.equal(h.sent.at(-1).status, 2);
});

for (const phase of ['partial', 'verify']) test(`abandoned ${phase} is reclaimed without another audio frame`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) });
  await h.enroll(); h.session.finish('owner'); h.sent.length = 0;
  h.feed('candidate', phase === 'partial' ? 10 : 32); await tick();
  const record = h.session.records.get('candidate');
  t.mock.timers.tick(10000);
  assert.equal(h.session.has('candidate'), false);
  assert.equal(record.signal.aborted, true);
  for (const key of ['chunks', 'probe', 'leading', 'silence', 'enrollment']) assert.equal(record[key].length, 0);
  resolve?.(true); await tick();
  assert.equal(h.sent.length, 0);
  assert.equal(h.session.authorizeText('candidate', '请等一下'), false);
  h.session.reset();
});

test('incoming frames refresh idle deadline but cannot extend the absolute lifetime', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const h = setup(); h.feed('question', 1);
  for (let i = 0; i < 13; i++) { t.mock.timers.tick(9000); h.feed('question', 1); }
  assert.equal(h.session.has('question'), true);
  t.mock.timers.tick(3000);
  assert.equal(h.session.has('question'), false);
  h.session.reset();
});

test('finishing the owner preserves pending enrollment until reset cancels it', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  let signal;
  const h = setup({ extract: async (pcm, s) => { signal = s; return [1, 0]; } });
  h.feed('owner', 25); h.session.activateQuestion('owner'); h.session.finish('owner'); await tick();
  t.mock.timers.tick(120000);
  assert.equal(signal.aborted, false);
  h.session.reset(); assert.equal(signal.aborted, true);
});


test('late verification cannot replay audio after a deadline even if timer callbacks were suspended', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  let resolve;
  const h = setup({ verify: () => new Promise(r => { resolve = r; }) });
  await h.enroll(); h.session.finish('owner'); h.sent.length = 0;
  h.feed('candidate', 32); await tick();
  t.mock.timers.setTime(Date.now() + 11000);
  resolve(true); await tick();
  assert.equal(h.session.has('candidate'), false);
  assert.equal(h.sent.length, 0);
  h.session.reset();
});

test('record capacity eviction cancels old work and reset clears all retained audio', async () => {
  const h = setup(); h.feed('old', 1);
  const old = h.session.records.get('old');
  for (let i = 0; i < 32; i++) h.feed(`question-${i}`, 1);
  assert.equal(h.session.records.size, 32);
  assert.equal(old.signal.aborted, true);
  assert.equal(old.enrollment.length, 0);
  const records = [...h.session.records.values()];
  h.session.reset();
  assert.equal(h.session.records.size, 0);
  assert.equal(h.session.cleanupTimer, null);
  for (const r of records) {
    assert.equal(r.signal.aborted, true);
    assert.equal(r.enrollment.length, 0);
  }
});


test('configured speaker window rounds to complete frames and rejects unsupported audio durations', () => {
  assert.equal(speakerWindowChunks('1024'), 32);
  assert.equal(speakerWindowChunks('800'), 25);
  assert.equal(speakerWindowChunks('900'), 29);
  assert.equal(speakerWindowChunks('1504'), 47);
  for (const value of [undefined, '', 'bad', '-1', '199', '1505', 'Infinity']) {
    assert.equal(speakerWindowChunks(value), 32);
  }
});
