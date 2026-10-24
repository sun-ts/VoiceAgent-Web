import WebSocketSendTool from '../WebSocket/WebSocketSendTool.js'
import XfWebSocketTool from '../WebSocket/XfWebSocketTool.js';
import SpeakerClient from './SpeakerClient.js';
import SpeakerSession from './SpeakerSession.js';
import { voiceLog } from './VoiceDiagnostics.js';
import { DEFAULT_VOLUME_FILTER_SETTINGS, normalizeVolumeFilterSettings } from './VolumeFilterSettings.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// During playback, a quiet onset can precede VAD's speech threshold by several
// words. Keep this audio for ASR; SpeakerSession excludes it from verification.
const INTERRUPTION_PRE_ROLL_MS = 1500;

class VoiceService {
    /**
     * 语音处理的服务类
     * positiveSpeechThreshold 人声阀值
     * negativeSpeechThreshold 静音阀值
     * preSpeechPadFrame 多少毫秒的人声才开始识别
     * redemptionFrame 多少毫秒未识别到人声才标识结束
     * instance 公共属性及参数
     */
    constructor(positiveSpeechThreshold,negativeSpeechThreshold,
        preSpeechPadFrame,redemptionFrame,cacheSpeechMs,instance,callBack,breakFunction,inputVolume, speakerOptions = {}) {
        /// 人声检测阀值 0.5
        this.positiveSpeechThreshold = positiveSpeechThreshold;
        /// 静音检测阀值 0.3
        this.negativeSpeechThreshold = negativeSpeechThreshold;
        /// 多少毫秒的人声才开始识别 3
        this.preSpeechPadFrame = preSpeechPadFrame
        /// 多少毫秒未识别到人声才标识结束 37
        this.redemptionFrame = redemptionFrame;
        /// 缓存多少毫秒的音频数据 250
        this.cacheSpeechMs = cacheSpeechMs;
        /// 公共属性及参数
        this.instance = instance;
        /// 初始人声分贝值
        this.currentDecibel = null;
        this.volumeFilter = { ...DEFAULT_VOLUME_FILTER_SETTINGS };
        /// 人声开始标识
        this.isTrigger = false;
        /// 人声开始计数
        this.iStartTime = 0;
        /// 人声结束计数
        this.iEndTime = 0;
        /// 数据是否发送标识
        this.isSend = false;
        /// 数据发送计数
        this.iSendCount = 0;
        /// 缓存待发送数据堆栈
        this.linkedList = [];


        this.webSockets = [];
        /// 识别队列ID
        this.uuidAsr = '';

        this.callBack = callBack;

        this.breakFunction = breakFunction;

        this.inputVolume = inputVolume;
        this.frameSpeech = new WeakMap();
        this.vadFrameCounts = { speechFrames: 0, nonSpeechFrames: 0 };
        this.speaker = new SpeakerSession({
            client: new SpeakerClient(),
            isReplyActive: speakerOptions.isReplyActive || (() => false),
            send: (uuid, audio, status) => this.sendAudioData(uuid, audio, status),
            onDiscard: (uuid) => {
                this.getWebSocketShiftByUUID(uuid)?.close();
                if (this.uuidAsr === uuid) {
                    this.linkedList = [];
                    this.isTrigger = this.isSend = false;
                    this.iStartTime = this.iEndTime = this.iSendCount = 0;
                    this.uuidAsr = '';
                }
            },
            onError: speakerOptions.onError || (error => voiceLog('speaker.unavailable', { errorType: error?.name }, 'warn')),
        });

        // 扩展 dayjs 支持时区和UTC
        dayjs.extend(utc);
        dayjs.extend(timezone);
    }

    /**
     * 设置Vad参数
     * @param {*} positiveSpeechThreshold 
     * @param {*} negativeSpeechThreshold 
     * @param {*} preSpeechPadFrame 
     * @param {*} redemptionFrame 
     * @param {*} cacheSpeechMs 
     */
    setVadParam(positiveSpeechThreshold,negativeSpeechThreshold,
        preSpeechPadFrame,redemptionFrame,cacheSpeechMs) {
        this.positiveSpeechThreshold = positiveSpeechThreshold;
        this.negativeSpeechThreshold = negativeSpeechThreshold;
        this.preSpeechPadFrame = preSpeechPadFrame;
        this.redemptionFrame = redemptionFrame;
        this.cacheSpeechMs = cacheSpeechMs;
    }

    /**
     * 重置记忆声音分贝
     */
    resetDecibel() {
        this.currentDecibel = null;
    }

    configureVolumeFilter(settings) {
        this.volumeFilter = normalizeVolumeFilterSettings(settings);
        this.resetDecibel();
    }

    /**
     * 根据UUID获取当前要处理的WebSocket链接
     * @param {唯一标识} uuid 
     * @returns WebSocket链接
     */
    getWebSocketShiftByUUID (uuid) {
        if(uuid !== '') {
            if(this.webSockets.length > 0) {
                let index = this.webSockets.findIndex(webSocket => webSocket.isMine(uuid));
                if(index > -1) {
                    return this.webSockets.splice(index,1)[0];
                }
            }
        }
        return undefined;
    }

    /**
     * Vad数据处理核心方法
     * @param {VAD实时数据} probs 
     * @param {声音原始数据} frame 
     */
    voiceTranslate = (probs,frame) => {
        try {
            // 根据语音概率更新指示器颜色
            const probability = probs.isSpeech
            const byteArray = this.floatTo16BitByteArray(frame);
            this.frameSpeech.set(byteArray, probability >= this.negativeSpeechThreshold);
            /// 实时展示声音大小
            this.inputVolume && this.inputVolume(`rgba(0, 255, 0, ${Math.min(probability, 1)})`);
            // if (probability >= this.positiveSpeechThreshold) {
            //     this.inputVolume && this.inputVolume(`rgba(0, 255, 0, ${Math.min(probability, 1)})`);
            // } else {
            //     this.inputVolume && this.inputVolume('#cccccc');
            // }

            /// 缓存数据声音数据
            this.linkedList.push(byteArray);

            /// 未检测到人声，开始检测
            if (probability >= this.positiveSpeechThreshold && !this.isTrigger) {
                const newDecibel = this.calculateDecibel(byteArray);
                if (this.volumeFilter.enabled && this.currentDecibel === null) this.currentDecibel = newDecibel;
                // Playback capture levels can change: leave interruption to
                // VAD, speaker verification and the text gate in that case.
                if (!this.volumeFilter.enabled || this.speaker.isReplyActive() ||
                    newDecibel >= this.currentDecibel - this.volumeFilter.lowerDb) {
                    this.isTrigger = true;
                    this.iStartTime = 0;
                    this.iEndTime = 0;
                    this.isSend = false;
                    this.iSendCount = 0;
                }
            }

            /// 已经检测到人声开始
            if(this.isTrigger) {
                if (probability >= this.positiveSpeechThreshold) { //开始判定
                    this.iStartTime++;
                    this.iEndTime = 0;
                } else if (probability >= this.negativeSpeechThreshold) { //过渡判定
                    if (this.iStartTime > 0)
                        this.iStartTime++;
                    // Speech above the ongoing threshold breaks a low-confidence
                    // run, even if it has not reached the stricter start threshold.
                    this.iEndTime = 0;
                } else { //终止判定
                    /// 解决Vad跳针问题
                    if(!this.isSend && this.iEndTime > 1) {
                        this.iStartTime = 0;
                    }
                    this.iEndTime++;
                }
            }

            /// 检测到结束标识--需连续检测超过minSilenceDurationMs后才算结束
            if(this.iEndTime >= this.redemptionFrame) {
                this.isTrigger = false;
                this.iStartTime = 0;
                this.iEndTime = 0;
            }

            if(!this.isSend && this.iStartTime >= this.preSpeechPadFrame) {
                this.isSend = true;
                this.iSendCount = 0;
            }

            /// 发送数据进行语音识别
            if (this.isSend) {
                while(this.linkedList.length > 0) {
                    this.iSendCount++;
                    const audioByte = this.linkedList.shift();
                    if(this.isTrigger) {
                        if (this.iSendCount > 1) {
                            this.routeAudioData(this.uuidAsr,audioByte,1);
                        } else {
                            if(this.uuidAsr == '') {
                                this.uuidAsr = this.instance.appContext.config.globalProperties.$uuid();
                                this.routeAudioData(this.uuidAsr,audioByte,0);
                                //console.error('----------开始发送ASRUUID：' + this.uuidAsr + '---------');
                            } else {
                                voiceLog('asr.duplicate_start', { utteranceId: this.uuidAsr }, 'error');
                            }
                        }
                    } else {
                        this.routeAudioData(this.uuidAsr,audioByte,2);
                        //console.error('----------结束发送ASRUUID：' + this.uuidAsr + '---------');
                        this.uuidAsr = '';
                        this.isSend = false;
                        this.linkedList = [];
                        //console.log('----------发送识别结束标识语音发送次数：' + this.iSendCount);
                        this.iSendCount = 0;
                    }
                }
            }
            /// 重置未发送状态
            if (!this.isSend && !this.isTrigger) {
                this.iSendCount = 0;
                this.iStartTime = 0;
                this.iEndTime = 0;
            }
            
            /// 缓存前多少毫秒的数据
            if (!this.isTrigger) {
                const cacheFrames = this.speaker.isReplyActive()
                    ? Math.ceil(Math.max(this.cacheSpeechMs, INTERRUPTION_PRE_ROLL_MS) / 32)
                    : this.cacheSpeechMs / 32;
                while(this.linkedList.length > cacheFrames) {
                    this.linkedList.shift();
                }
            }
        } catch (error) {
            this.isTrigger = false;
            this.iStartTime = 0;
            this.iEndTime = 0;
            this.isSend = false;
            this.iSendCount = 0;
            this.uuidAsr = '';
            if(this.linkedList.length > 0) {
                this.linkedList = [];
            }
            voiceLog('vad.processing_failed', { errorType: error?.name }, 'error');
        }
    }

    routeAudioData(uuid, audio, status) {
        const speech = this.frameSpeech.get(audio) === true;
        if (status === 0) this.vadFrameCounts = { speechFrames: 0, nonSpeechFrames: 0 };
        this.vadFrameCounts[speech ? 'speechFrames' : 'nonSpeechFrames']++;
        if (status === 0 || status === 2) voiceLog(status === 0 ? 'vad.start' : 'vad.end', {
            utteranceId: uuid, chunks: this.iSendCount,
            durationMs: this.iSendCount * 32,
            ...this.vadFrameCounts,
            positiveThreshold: this.positiveSpeechThreshold,
            negativeThreshold: this.negativeSpeechThreshold,
            ...(status === 2 ? { reason: 'vad_end_threshold', endWindowMs: this.redemptionFrame * 32 } : {}),
        });
        this.speaker.push(uuid, audio, status, speech);
    }

    reset() {
        voiceLog('capture.reset');
        this.speaker.reset();
        this.webSockets.forEach(socket => socket.close());
        this.webSockets = [];
        this.linkedList = [];
        this.isTrigger = this.isSend = false;
        this.iStartTime = this.iEndTime = this.iSendCount = 0;
        this.vadFrameCounts = { speechFrames: 0, nonSpeechFrames: 0 };
        this.uuidAsr = '';
        this.resetDecibel();
    }

    /**
     * 转换函数
     * @param {浮点数据} floatArray 
     * @param {} littleEndian 
     * @returns 
     */
    floatTo16BitByteArray = (floatArray, littleEndian = true) => {
        const buffer = new ArrayBuffer(floatArray.length * 2);
        const dataView = new DataView(buffer);
        const scale = 32767;
        const minVal = -32768;
        const maxVal = 32767;

        for (let i = 0, offset = 0; i < floatArray.length; i++, offset += 2) {
            const intVal = Math.min(maxVal, Math.max(minVal, (floatArray[i] * scale) | 0));
            dataView.setInt16(offset, intVal, littleEndian);
        }

        return new Uint8Array(buffer);
    }

    /**
     * 计算分贝值
     * @param array 音频数据数组
     * @returns 分贝值
     */
    calculateDecibel = (array) => {
        let sum = 0.0;

        // 16位 PCM 每个采样占 2 字节，计算采样总数
        const sampleCount = array.length / 2;

        // 边界处理：无有效采样时返回极小值（避免 log10(0) 报错）
        if (sampleCount == 0) {
            return 0;
        }

        // 遍历每个 16 位采样点（与 Java 位运算逻辑完全对齐）
        for (let i = 0; i < sampleCount; i++) {
            // 对应 Java: (audioBytes[i * 2] & 0xFF) | (audioBytes[i * 2 + 1] << 8)
            // 注意：Java 的 byte 是有符号的，TS 中 Uint8Array 是无符号的，需手动模拟有符号转换
            const byte1 = array[i * 2]; // 低字节
            const byte2 = array[i * 2 + 1]; // 高字节

            // 模拟 Java 的 (byte & 0xFF) 无符号转换，再执行位运算
            const low = byte1 & 0xFF;
            const high = byte2 << 8; // 高字节左移 8 位
            let sample = low | high;

            // 将 16 位无符号值转换为有符号（Java 的 short 范围：-32768 ~ 32767）
            if (sample > 32767) {
                sample -= 65536; // 超出 32767 时，转为负数（如 32768 → -32768）
            }

            // 计算归一化振幅（与 Java: sample / 32768.0 一致）
            const amplitude = sample / 32768.0;
            sum += amplitude * amplitude;
        }

        // 计算均方根（RMS）
        const rms = Math.sqrt(sum / sampleCount);

        // 边界处理：避免 rms 为 0 导致 log10(0) 出现 -Infinity
        if (rms == 0) {
            return 0;
        }

        // 计算分贝值（与 Java 公式完全一致）
        return 20 * Math.log10(rms / 20e-6);
    };

    /**
     * 发送数据到ASR服务
     * @param {string} uuid 
     * @param {Uint8Array} audioByte 
     * @param {number} status 
     */
    sendAudioData(uuid, audioByte, status) {
        let socket = this.webSockets.find(item => item.isMine(uuid));
        if (status === 0) {
            if (socket) return;
            socket = new WebSocketSendTool(uuid, new XfWebSocketTool('ASR'), (id, data) => {
                if (!this.speaker.has(id)) return;
                const terminal = socket.closed;
                Promise.resolve(this.callBack(id, data)).catch(error => {
                    voiceLog('asr.callback_failed', { utteranceId: id, errorType: error.name }, 'error');
                }).finally(() => {
                    if (terminal) this.speaker.finish(id);
                });
            }, (id, reason) => {
                this.webSockets = this.webSockets.filter(item => !item.isMine(id));
                if (!['server_final', 'server_error'].includes(reason)) this.speaker.finish(id);
            });
            this.webSockets.push(socket);
        }
        // One queue owns transmission and closure. A final ASR response can
        // precede local VAD end; late packets must not recreate its sender.
        socket?.addSendList(audioByte, status);
    }
}
export default VoiceService;
