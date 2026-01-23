import AudioText from '../Entitys/AudioText.js'

import WebSocketSendTool from '../WebSocket/WebSocketSendTool.js'
import XfWebSocketTool from '../WebSocket/XfWebSocketTool.js';

/**
 * 语音处理类
 */
class AudioService {
    constructor(callBack) {
        this.splitWord = /((?<!\d)[.:：](?!\d)|[。,，!！?？;；])+/g;

        this.webSockets = [];

        this.audioTexts = [];

        this.clocks = [];

        this.callBack = callBack;
    }

    /**
     * 
     * @param {翻译唯一标识} uuid 
     * @param {待翻译内容} content 
     * @param {*} isAnswer 
     */
    AddSendContentToAudio(uuid, content, isAnswer) {
        const index = this.audioTexts.findIndex(audioText => audioText.isMine(uuid));
        if(index > -1) {
            this.audioTexts[index].addAudioText(content, isAnswer);
        } else {
            let audioText = new AudioText(uuid);
            audioText.addAudioText(content, isAnswer);
            this.audioTexts.push(audioText);
            
            ///启动线程处理数据
            this.sendContentToAudio(uuid);
        }
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
     * 发送文本到TTS
     * @param {*} uuid 主键信息
     */
    async sendContentToAudio(uuid) {
        let clock = setInterval(() => {
            const index = this.audioTexts.findIndex(audioText => audioText.isMine(uuid));
            if(index > -1) {
                let flag = this.audioTexts[index].isOver;
                let textArray = this.contentSplit(this.audioTexts[index].textPlay.trim());

                let sendText = '', currentNumber = this.audioTexts[index].currentNumber;
                if(textArray.length >= 2 * (currentNumber + 1)) {
                    let loop = Math.ceil((textArray.length - 2 * currentNumber) / 2);
                    for (var i=0; i<loop; i++) {
                        for (var j=0; j<1; j++) {
                            sendText += textArray[(currentNumber + i) * 2 + j];
                        }
                        if(sendText && sendText.trim()) {
                            if(i < loop-1) {
                                this.audioTexts[index].currentNumber++;
                                this.OptionTextDataToTTS(
                                    uuid + this.audioTexts[index].currentNumber + ',false',
                                    sendText);
                            } else if(!flag) {
                                this.audioTexts[index].currentNumber++;
                                this.OptionTextDataToTTS(
                                    uuid + this.audioTexts[index].currentNumber + ',true',
                                    sendText);
                            }
                            sendText = '';
                        }
                    }
                } else if (textArray.length >= 2 * currentNumber && !flag) {
                    let loop = textArray.length - 2 * currentNumber;
                    for (var i=0; i<loop; i++) {
                        sendText += textArray[currentNumber * 2 + i];
                    }
                    if(sendText && sendText.trim()) {
                        this.audioTexts[index].currentNumber++;
                        this.OptionTextDataToTTS(
                            uuid + this.audioTexts[index].currentNumber + ',true',
                            sendText);
                        sendText = '';
                    }
                }

                if(!flag) {
                    this.audioTexts.splice(index,1);
                    this.closeClock(uuid);
                }
            } else {
                this.closeClock(uuid);
            }
        }, 10);
            
        this.clocks.push({uuid:uuid,clock:clock});
    }

    /**
     * 发送数据进行语音翻译
     * @param {唯一标识} uuid UUID + 序号
     * @param {发送数据} sendText 
     */
    OptionTextDataToTTS(uuid, sendText) {
        const index = this.webSockets.findIndex(webSocket => webSocket.isMine(uuid));

        if (index > -1) {
            console.error('-'.repeat(10) + '翻译语音错误，同一UUID反复被使用翻译' + '-'.repeat(10));
            return;
        }

        let webSocket = new WebSocketSendTool(uuid, 
            new XfWebSocketTool('TTS'), this.callBack);
        webSocket.addSendList(sendText, 2);
        
        this.webSockets.push(webSocket);
    }

    /**
     * 统计文本中标点符号的数量（基础版：常见中+英文标点）
     * @param {string} text - 待统计的文本
     * @returns {number} 标点符号数量
     */
    contentSplit(text) {
        // 匹配所有标点，返回匹配数组（无匹配时为 null）
        let returnArray = [];
        if(text && text.length > 0) {
            returnArray = text.split(this.splitWord);
            if(returnArray.length > 0 && returnArray[returnArray.length-1] === '') {
                returnArray.pop();
            }
        }
        return returnArray;
    }

    /**
     * 关闭线程
     * @param {*} uuid 线程主键
     */
    closeClock(uuid) {
        const index = this.clocks.findIndex(clock => clock.uuid == uuid);
        if(index > -1) {
            clearInterval(this.clocks[index].clock);
            this.clocks.splice(index,1);
        }
    }
}
export default AudioService;