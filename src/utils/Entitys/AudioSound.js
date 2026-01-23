class AudioSound {
    /**
     * 
     * @param {*} uuid 唯一ID
     * @param {*} audioContext 播放对象
     * @param {*} voiceConfig object {
     *                  sampleRate:'采样率，必填',
     *                  channels:'声道数：1=单声道，2=立体声'
     *                  bitRate:'MP3比特率，越高音质越好'
     *                  bitDeep:'位深(8\16)'
     *                  encoding:'编码（PCM、MP3）'
     *            }
     */
    constructor(uuid,audioContext,voiceConfig) {
        this.uuid = uuid;

        let uuidSplit = this.uuid.split(',');

        this.uuidOrg = uuidSplit[0].substring(0,36);

        this.uuidNum = parseInt(uuidSplit[0].substring(36),10);

        this.uuidFlag = uuidSplit[1];

        this.audioContext = audioContext;

        this.SoundArray = [];

        this.SoundAll = null;

        if (voiceConfig) {
            this.voiceConfig = voiceConfig;
        } else {
            this.voiceConfig = {
                sampleRate:16000,  // 采样率，必填
                channels:1,        // 声道数：1=单声道，2=立体声
                bitRate:128,       // MP3比特率，越高音质越好
                bitDeep:16,        // 位深
                encoding:'MP3'     // 编码（PCM、MP3）
            };
        }
    }

    isMine(uuidCu) {
        if(this.uuid == uuidCu)
            return true;
        return false;
    }

    async addAudioSound(SoundBuffer, status) {
        this.SoundArray.push({ SoundBuffer:SoundBuffer,status:status });
        if(status == 2) {
            let intArrayAll = [];
            this.SoundArray.forEach((value,index) => {
                if (value && value.SoundBuffer) {
                    let uintArray = this.base64ToUint8Array(value.SoundBuffer);
                    if(uintArray) {
                        if(this.voiceConfig && this.voiceConfig.encoding == 'PCM'){
                            intArrayAll.push(new Int16Array(uintArray.buffer));
                        } else if (this.voiceConfig && this.voiceConfig.encoding == 'MP3') {
                            intArrayAll.push(uintArray);
                        }
                    }
                }
            });
            if (intArrayAll.length > 0) {
                if(this.voiceConfig && this.voiceConfig.encoding == 'PCM') {
                    let intArrays = this.concatInt16Arrays(intArrayAll);
                    if(intArrays) {
                        this.SoundAll = this.convertInt16PCMToAudioBuffer(intArrays);
                    } else {
                        console.error('-'.repeat(10) + '待播放数据转译Int16数组后为空！' + '-'.repeat(10));
                    }
                } else if (this.voiceConfig && this.voiceConfig.encoding == 'MP3') {
                    //console.log(intArrayAll);
                    this.SoundAll = new Blob(intArrayAll, { type: 'audio/mpeg' });
                }
            } else {
                console.error('-'.repeat(10) + 'base64数据为空！' + '-'.repeat(10));
            }
            intArrayAll = null;
        }
    }

    /**
     * BASE64文本转Uint16Array
     * @param {BASE64文本} base64Str 
     * @returns Unit8Array
     */
    base64ToUint8Array(base64Str) {
        if(base64Str && base64Str!='') {
            const pureBase64 = base64Str.replace(/^data:.+;base64,/i, '');
            let binaryStr;
            try {
                binaryStr = atob(pureBase64);
            } catch (error) {
                console.error("Base64 解码失败：", error);
                throw new Error("无效的 Base64 字符串");
            }
            //console.log(base64Str);
            // const byteLength = binaryStr.length;
            // const uint8Arr = new Uint8Array(byteLength);
            // for (let i = 0; i < byteLength; i++) {
            //     uint8Arr[i] = binaryStr.charCodeAt(i);
            // }

            return new Uint8Array([...binaryStr].map(char => char.charCodeAt(0)));
        } else {
            return null;
        }
    }

    /**
     * 拼接多个Int16Array
     * @param  {...Int16Array} arrays 待拼接的Int16Array列表
     * @returns {Int16Array} 拼接后的新Int16Array
     */
    concatInt16Arrays(arrays) {
        // 步骤1：计算总长度
        let totalLength = 0;
        for (const arr of arrays) {
            // 过滤非Int16Array类型的参数（可选，增强鲁棒性）
            if (!(arr instanceof Int16Array)) continue;
            totalLength += arr.length;
        }

        // 步骤2：创建新的Int16Array（总长度）
        const result = new Int16Array(totalLength);

        // 步骤3：依次拷贝每个数组到新数组
        let offset = 0; // 记录当前拷贝的起始位置
        for (const arr of arrays) {
            if (!(arr instanceof Int16Array)) continue;
            result.set(arr, offset); // 将arr拷贝到result的offset位置
            offset += arr.length; // 更新下一次拷贝的起始位置
        }

        return result;
    }

    /**
     * 核心：转换 Uint8Array PCM 到 AudioBuffer
     * @param {*} context 
     * @param {*} int16PcmData 
     * @returns 
     */
    convertInt16PCMToAudioBuffer(int16PcmData) {
        // PCM 核心配置（必须与 Uint8Array 数据一致！）
        const config = {
            sampleRate: 16000, // 采样率
            channelCount: 1, // 单声道
            bitDepth: 16, // Uint8Array 对应 8 位 PCM
            littleEndian: true // 小端字节序
        };
        
        // 步骤1：Int16Array 转 Float32Array（16位深数据归一化）
        const float32Data = new Float32Array(int16PcmData.length);
        for (let i = 0; i < int16PcmData.length; i++) {
            // 关键：Int16范围[-32768, 32767] 归一化到[-1.0, 1.0]
            float32Data[i] = int16PcmData[i] / 32768;
        }

        // 步骤2：创建AudioBuffer（固定采样率16000）
        const buffer = this.audioContext.createBuffer(
            config.channelCount, // 声道数（1=单声道，2=立体声，按需调整）
            int16PcmData.length / config.channelCount, // 每个声道的样本数
            config.sampleRate // 固定为16000采样率
        );

        // 步骤3：将Float32数据填充到AudioBuffer对应声道
        for (let channel = 0; channel < config.channelCount; channel++) {
            const channelData = buffer.getChannelData(channel);
            // 拆分声道数据（单声道直接赋值，立体声按索引拆分）
            for (let i = 0; i < channelData.length; i++) {
                channelData[i] = float32Data[i * config.channelCount + channel];
            }
        }
        return buffer;
    };
}
export default AudioSound;