import { voiceLog } from '../Services/VoiceDiagnostics.js';

class WebSocketSendTool {
  constructor(id, xfWebSocketTool, callBack, onClose = () => {}) {
    this.websocketid = id;
    this.xfWebSocketTool = xfWebSocketTool;
    this.onMessageCallback = callBack;
    this.onCloseCallback = onClose;
    this.sendDataInterval = 10;
    this.sendDataInter = null;
    this.sendDataList = [];
    this.closed = false;
    this.inputEnded = false;
    this.sentFrames = 0;
    this.receivedFrames = 0;
    this.createdAt = Date.now();
    this.lastInputAt = this.createdAt;
    this.finalTimer = null;
    this.connectTimer = null;
    this.connect();
  }

  isMine(uuid) { return this.websocketid === uuid; }

  log(event, fields = {}, level = 'info') {
    voiceLog(event, { utteranceId: this.websocketid, stage: this.xfWebSocketTool.ConfigFlag,
      sentFrames: this.sentFrames, receivedFrames: this.receivedFrames, ...fields }, level);
  }

  addSendList(byteAudio, status) {
    if (this.closed || this.inputEnded) return false;
    this.lastInputAt = Date.now();
    this.sendDataList.push({ byteAudio, status });
    if (status === 2) this.inputEnded = true;
    return true;
  }

  connect() {
    this.log('asr_tts.connect');
    this.ws = new WebSocket(this.xfWebSocketTool.getAuthUrl());
    this.connectTimer = setTimeout(() => {
      this.log('asr_tts.connect_timeout', {}, 'warn');
      this.close('connect_timeout');
    }, 10000);
    this.ws.onopen = () => {
      clearTimeout(this.connectTimer);
      this.log('asr_tts.open', { elapsedMs: Date.now() - this.createdAt });
      this.lastInputAt = Date.now();
      this.sendDataInter = setInterval(() => this.flush(), this.sendDataInterval);
    };
    this.ws.onmessage = event => {
      this.receivedFrames++;
      let result;
      try { result = JSON.parse(event.data); } catch {
        this.log('asr_tts.invalid_response', {}, 'warn');
        this.close('invalid_response');
        return;
      }
      const terminal = result.code !== 0 || result.data?.status === 2;
      if (terminal) {
        this.log('asr_tts.result', { status: result.data?.status, code: result.code,
          reason: result.code === 0 ? 'server_final' : 'server_error',
          elapsedMs: Date.now() - this.createdAt }, result.code === 0 ? 'info' : 'warn');
        // Retire the producer before the final callback removes its speaker state.
        this.close(result.code === 0 ? 'server_final' : 'server_error');
      } else if (this.finalTimer !== null) {
        this.waitForResult();
      }
      this.onMessageCallback?.(this.websocketid, event.data);
    };
    this.ws.onerror = () => {
      this.log('asr_tts.socket_error', {}, 'warn');
      this.close('socket_error');
    };
    this.ws.onclose = event => {
      this.log('asr_tts.remote_close', { code: event.code }, 'warn');
      this.close('remote_close');
    };
  }

  flush() {
    if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return;
    let packet = this.sendDataList.shift();
    if (!packet) {
      const idleMs = Date.now() - this.lastInputAt;
      // Normal silence supplies PCM frames every 32ms; no frames is a capture stall.
      if (idleMs < 5000) return;
      this.log('asr_tts.input_stalled', { idleMs }, 'warn');
      if (this.xfWebSocketTool.ConfigFlag !== 'ASR' || this.sentFrames === 0) {
        this.close('input_stalled');
        return;
      }
      this.inputEnded = true;
      packet = { byteAudio: new Uint8Array(), status: 2 };
    }
    try {
      this.send(this.xfWebSocketTool.getSendData(packet.byteAudio, packet.status));
      this.sentFrames++;
      if (packet.status === 2) {
        this.log('asr_tts.input_end', { queued: this.sendDataList.length });
        this.clearSendDataInter();
        this.waitForResult();
      }
    } catch (error) {
      this.log('asr_tts.send_failed', { errorType: error.name }, 'error');
      this.close('send_failed');
    }
  }

  clearSendDataInter() {
    clearInterval(this.sendDataInter);
    this.sendDataInter = null;
  }

  waitForResult() {
    clearTimeout(this.finalTimer);
    this.finalTimer = setTimeout(() => {
      this.log('asr_tts.result_timeout', {}, 'warn');
      this.close('result_timeout');
    }, 15000);
  }

  send(data) { this.ws.send(typeof data === 'object' ? JSON.stringify(data) : data); }

  close(reason = 'client_close') {
    if (this.closed) return;
    this.closed = true;
    this.clearSendDataInter();
    clearTimeout(this.finalTimer);
    clearTimeout(this.connectTimer);
    this.sendDataList = [];
    if (this.ws) {
      this.ws.onmessage = this.ws.onopen = this.ws.onerror = this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.log('asr_tts.closed', { reason }, 'debug');
    this.onCloseCallback(this.websocketid, reason);
  }
}

export default WebSocketSendTool;
