import WebSocketSendEntity from '../Entitys/WebSocketSendEntity.js'
import WebSocketSendTool from '../WebSocket/WebSocketSendTool.js'
import XfWebSocketTool from '../WebSocket/XfWebSocketTool.js';
import CryptoJS from 'crypto-js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

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
        preSpeechPadFrame,redemptionFrame,cacheSpeechMs,instance,callBack,breakFunction,inputVolume) {
        /// 人声检测阀值
        this.positiveSpeechThreshold = positiveSpeechThreshold;
        /// 静音检测阀值
        this.negativeSpeechThreshold = negativeSpeechThreshold;
        /// 多少毫秒的人声才开始识别
        this.preSpeechPadFrame = preSpeechPadFrame
        /// 多少毫秒未识别到人声才标识结束
        this.redemptionFrame = redemptionFrame;
        /// 缓存多少毫秒的音频数据
        this.cacheSpeechMs = cacheSpeechMs;
        /// 公共属性及参数
        this.instance = instance;
        /// 初始人声分贝值
        this.currentDecibel = 0;
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

        this.sendAudioList = [];

        this.webSockets = [];
        /// 识别队列ID
        this.uuidAsr = '';

        this.callBack = callBack;

        this.breakFunction = breakFunction;

        this.inputVolume = inputVolume;

        // 扩展 dayjs 支持时区和UTC
        dayjs.extend(utc);
        dayjs.extend(timezone);
    }

    /**
     * 重置记忆声音分贝
     */
    resetDecibel() {
        this.currentDecibel = 0;
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
            /// 实时展示声音大小
            if (probability >= this.positiveSpeechThreshold) {
                this.inputVolume && this.inputVolume(`rgba(0, 255, 0, ${Math.min(probability, 1)})`);
            } else {
                this.inputVolume && this.inputVolume('#cccccc');
            }

            this.linkedList.push(byteArray);

            if (probability >= this.positiveSpeechThreshold && !this.isTrigger) {
                let newDecibel = this.calculateDecibel(byteArray)
                //console.log('声音分贝情况currentDecibel：' + this.currentDecibel + ',新声音分贝情况：' + newDecibel)
                if(this.currentDecibel > 0) {
                    if(newDecibel >= this.currentDecibel) {
                        this.isTrigger = true;
                        this.iStartTime = 0;
                        this.iEndTime = 0;
                        this.isSend = false;
                        this.iSendCount = 0;
                    } else {
                        console.log('----当前声音分贝阀值currentDecibel：' + 
                            this.currentDecibel + ',被过滤的分贝值：' + newDecibel);
                    }
                } else {
                    this.currentDecibel = newDecibel - 15;
                    this.isTrigger = true;
                    this.iStartTime = 0;
                    this.iEndTime = 0;
                    this.isSend = false;
                    this.iSendCount = 0;
                }
            }

            if(this.isTrigger) {
                if (probability >= this.positiveSpeechThreshold) {
                    this.iStartTime++;
                    this.iEndTime = 0;
                } else if (probability >= this.negativeSpeechThreshold) {
                    if (this.iStartTime > 0)
                        this.iStartTime++;
                    if (this.iEndTime > 0)
                        this.iEndTime++;
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
                            this.sendAudioData(this.uuidAsr,audioByte,1);
                        } else {
                            if(this.uuidAsr == '') {
                                this.uuidAsr = this.instance.appContext.config.globalProperties.$uuid();
                                this.sendAudioData(this.uuidAsr,audioByte,0);
                                //console.error('----------开始发送ASRUUID：' + this.uuidAsr + '---------');
                                this.breakFunction && this.breakFunction(this.uuidAsr);
                            } else {
                                console.error('----------出现问题：又重新开始send数据！---------');
                            }
                        }
                    } else {
                        this.sendAudioData(this.uuidAsr,audioByte,2);
                        //console.error('----------结束发送ASRUUID：' + this.uuidAsr + '---------');
                        this.uuidAsr = '';
                        this.isSend = false;
                        this.linkedList = [];
                        //console.log('----------发送识别结束标识语音发送次数：' + this.iSendCount);
                        this.iSendCount = 0;
                    }
                }
            }
            if (!this.isSend && !this.isTrigger) {
                this.iSendCount = 0;
                this.iStartTime = 0;
                this.iEndTime = 0;
            }
            
            /// 缓存前多少毫秒的数据
            if (!this.isTrigger) {
                while(this.linkedList.length > this.cacheSpeechMs / 32) {
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
            console.error('检测语音出错:', error)
        }
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
     * 发送数据到
     * @param {string} uuid 
     * @param {Uint8Array} audioByte 
     * @param {number} status 
     */
    async sendAudioData(uuid, audioByte, status) {
        let flag = false, message = '';
        if(status == 0) {
            let webSocketSendEntity = new WebSocketSendEntity(uuid);
            webSocketSendEntity.addReadySendData(audioByte, status);
            this.sendAudioList.push(webSocketSendEntity);
            this.OptionAudioDataToAsr(uuid);
            flag = true;
        } else {
            if (this.sendAudioList.length > 0) {
                let index = this.sendAudioList.
                    findIndex(webSocketSendEntity => webSocketSendEntity.isMine(uuid));
                if (index > -1) {
                    this.sendAudioList[index].WebSocketSendEntitys.push({audioByte:audioByte, status:status});
                    flag = true;
                } else {
                    message = '----------异常问题ID为'+uuid+'的非起始数据，未找到对应的发送队列。----------';
                }
            } else {
                message = '----------异常问题ID为'+uuid+'的非起始数据，队列为空----------';
            }
        }
        if(!flag) console.error(message);
    }

    /**
     * 通过事物ID启动ASR翻译
     * @param {事物ID} uuid 
     */
    async OptionAudioDataToAsr(uuid) {
        if(uuid != '') {
            let iCount = 0;
            let webSocket = new WebSocketSendTool(uuid,new XfWebSocketTool("ASR"),this.callBack);
            this.webSockets.push(webSocket);

            let myClock = setInterval(() => {
                iCount++;
                let index = this.sendAudioList.
                    findIndex(webSocketSendEntity => webSocketSendEntity.isMine(uuid));
                if(index > -1) {
                    while(this.sendAudioList[index].WebSocketSendEntitys.length > 0) {
                        let voice = this.sendAudioList[index].getReadySendData();
                        if(voice) {
                            iCount = 0;
                            webSocket.addSendList(voice.audioByte,voice.status);
                            if(voice.status == 2) {
                                if(this.sendAudioList[index].WebSocketSendEntitys.length > 0) {
                                    console.error('----------异常结束状态后还有' + this.sendAudioList[i].length + '条数据！----------');
                                }
                                this.sendAudioList.splice(index,1);
                                clearInterval(myClock);
                                break;
                            }
                        } else {
                            console.log('------没有最新的待处理数据------');
                        }
                    }
                }

                if (iCount > 200) {
                    console.error('----------异常结束，原因：循环200次，耗时2S未检测到结束发送标识----------');
                    webSocket.addSendList('',2);
                    if(index > -1) this.sendAudioList.splice(index,1);
                    clearInterval(myClock);
                }
            },10);
        } else {
            console.error('----------启动ASR翻译失败，原因：启动时事务ID为空！----------');
        }
    }
}
export default VoiceService;
