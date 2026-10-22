import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocketSendTool from '../src/utils/WebSocket/WebSocketSendTool.js';

function setup(t, stage = 'ASR') {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const sent = [];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 0; }
    send(body) { sent.push(JSON.parse(body)); }
    close() { this.readyState = 3; }
  }
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => { globalThis.WebSocket = previous; t.mock.timers.reset(); });
  const results = [];
  const tool = new WebSocketSendTool('utterance-1', {
    ConfigFlag: stage, getAuthUrl: () => 'ws://test',
    getSendData: (bytes, status) => ({ status, bytes: Array.from(bytes) }),
  }, (id, data) => results.push({ id, data }));
  t.after(() => tool.close());
  const socket = tool.ws;
  socket.readyState = 1; socket.onopen();
  return { tool, socket, sent, results };
}

test('server final stops sending before callback and ignores late microphone frames', t => {
  const h = setup(t);
  h.tool.addSendList(new Uint8Array([1, 2]), 0);
  t.mock.timers.tick(10);
  h.socket.onmessage({ data: JSON.stringify({ code: 0, data: { status: 2 } }) });
  h.tool.addSendList(new Uint8Array([3, 4]), 1);
  t.mock.timers.tick(2500);
  assert.deepEqual(h.sent.map(item => item.status), [0]);
  assert.equal(h.results.length, 1);
  assert.equal(h.tool.sendDataList.length, 0);
  assert.equal(h.tool.sendDataInter, null);
});

test('remote disconnect clears queued audio and never tries to send again', t => {
  const h = setup(t);
  h.tool.addSendList(new Uint8Array([1, 2]), 0);
  h.socket.readyState = 3;
  h.socket.onclose?.({ code: 1006, wasClean: false });
  t.mock.timers.tick(3000);
  assert.equal(h.sent.length, 0);
  assert.equal(h.tool.sendDataList.length, 0);
});

test('normal explicit end is sent once; silence frames do not trigger a false timeout', t => {
  const h = setup(t);
  h.tool.addSendList(new Uint8Array([1, 2]), 0);
  for (let i = 0; i < 100; i++) {
    t.mock.timers.tick(32);
    h.tool.addSendList(new Uint8Array([0, 0]), 1);
  }
  h.tool.addSendList(new Uint8Array(), 2);
  t.mock.timers.tick(6000);
  assert.equal(h.sent.filter(item => item.status === 2).length, 1);
});

test('TTS end packet waits for the result without an input-stall timer', t => {
  const h = setup(t, 'TTS');
  h.tool.addSendList('reply text', 2);
  t.mock.timers.tick(10);
  t.mock.timers.tick(6000);
  assert.equal(h.tool.closed, false);
  assert.equal(h.sent.length, 1);
  h.socket.onmessage({ data: JSON.stringify({ code: 0, data: { status: 2, audio: '' } }) });
  t.mock.timers.tick(20000);
  assert.equal(h.results.length, 1);
  assert.equal(h.tool.closed, true);
  assert.equal(h.sent.length, 1);
});

test('genuinely stalled capture sends one typed end frame then closes on missing result', t => {
  const h = setup(t);
  h.tool.addSendList(new Uint8Array([1, 2]), 0);
  t.mock.timers.tick(10);
  t.mock.timers.tick(5000);
  assert.deepEqual(h.sent.map(item => item.status), [0, 2]);
  assert.deepEqual(h.sent[1].bytes, []);
  t.mock.timers.tick(15000);
  assert.equal(h.tool.closed, true);
  assert.equal(h.tool.addSendList(new Uint8Array([3, 4]), 1), false);
});

test('streaming TTS extends result timeout on each valid response', t => {
  const h = setup(t, 'TTS');
  h.tool.addSendList('long reply', 2);
  t.mock.timers.tick(10);
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(10000);
    assert.equal(h.tool.closed, false);
    h.socket.onmessage({ data: JSON.stringify({ code: 0, data: { status: 1, audio: 'AAA=' } }) });
  }
  t.mock.timers.tick(14999);
  assert.equal(h.tool.closed, false);
  t.mock.timers.tick(1);
  assert.equal(h.tool.closed, true);
});
