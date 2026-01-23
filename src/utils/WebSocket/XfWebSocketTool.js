import CryptoJS from 'crypto-js';
import { Base64 } from 'js-base64';

class XfWebSocketTool {
    constructor(ConfigFlag) {
        this.ConfigFlag = ConfigFlag;

        //// APPID、APPKEY、APPSECRET数据初始化
        this.Config = {};

        this.Config.appid = import.meta.env.VITE_XF_APP_ID;
        this.Config.apiSecret = import.meta.env.VITE_XF_API_SECRET;
        this.Config.apiKey = import.meta.env.VITE_XF_API_KEY;

        this.Config.appid_HF = import.meta.env.VITE_XF_APP_ID_HF;
        this.Config.apiSecret_HF = import.meta.env.VITE_XF_API_SECRET_HF;
        this.Config.apiKey_HF = import.meta.env.VITE_XF_API_KEY_HF;

        /// ASRconfig初始化
        if(ConfigFlag == 'ASR') {
            this.Config.hostUrl = import.meta.env.VITE_ASR_HOST_URL;
            this.Config.host = import.meta.env.VITE_ASR_HOST;
            this.Config.uri = import.meta.env.VITE_ASR_URI;
        }
        /// TTSconfig初始化
        if(ConfigFlag == 'TTS') {
            this.Config.hostUrl = import.meta.env.VITE_XFTTS_HOST_URL;
            this.Config.host = import.meta.env.VITE_XFTTS_HOST;
            this.Config.uri = import.meta.env.VITE_XFTTS_URI;

            this.Config.encoding = import.meta.env.VITE_XFTTS_ENCODING;
        }
    }

    getSendData(data, flag) {
        if(this.ConfigFlag == 'ASR') {
            return this.getASRSendData(data, flag);
        } else if (this.ConfigFlag == 'TTS') {
            return this.getTTSSendData(data, flag);
        }
    }

    /**
     * 获取ASR发送数据
     * @param {*} data 数据
     * @param {*} flag 标识
     * @returns 
     */
    getASRSendData (data, flag) {
        let frame = {};

        if (flag == 0) {
            frame.common = {
                    'app_id': this.Config.appid
                };
            frame.business = {
                    'domain': 'iat',
                    'vad_eos': 1500,
                    'accent': 'mandarin',
                    'dwa': 'wpgs'
                };
        }
        frame.data = {
                'status': flag,
                'format': 'audio/L16;rate=16000',
                'encoding': 'raw',
                'audio': Base64.fromUint8Array(data.slice())
            };

        return frame;
    }

    /**
     * 获取ASR发送数据
     * @param {*} data 数据
     * @param {*} flag 标识
     */
    getTTSSendData (data, flag) {
        let frame = {};

        frame.common = {
                'app_id': this.Config.appid_HF
            };
        frame.business = {
                "aue": this.Config.encoding == 'MP3'?'lame':'raw',
                "auf": "audio/L16;rate=16000",
                "vcn": "x4_yezi",
                "speed": 60,
                "tte": "UTF8"
            };
        if(this.Config.encoding == 'MP3') {
            frame.business.sfl = 1;
        }
        frame.data = {
            "text": this.strToBase64(data),
            "status": flag
        }

        return frame;
    }

    /**
     * 生成认证URL（对应Java的getAuthUrl方法）
     */
    getAuthUrl() {
        // 获取当前时间 RFC1123格式
        let date = (new Date().toUTCString());

        let signatureOrigin = `host: ${this.Config.host}\ndate: ${date}\nGET ${this.Config.uri} HTTP/1.1`;
        //console.log(signatureOrigin);
        let signatureSha = CryptoJS.HmacSHA256(signatureOrigin, this.ConfigFlag=='ASR'?this.Config.apiSecret:this.Config.apiSecret_HF);
        let signature = CryptoJS.enc.Base64.stringify(signatureSha);
        let authorizationOrigin = `api_key="${this.ConfigFlag=='ASR'?this.Config.apiKey:this.Config.apiKey_HF}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
        let authStr = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(authorizationOrigin));

        let authWssUrl = this.Config.hostUrl + "?authorization=" + authStr + "&date=" + date + "&host=" + this.Config.host;

        return authWssUrl;
    }

    strToBase64(str) {
        // 步骤1：将字符串转为 UTF-8 编码的二进制数据（解决中文乱码问题）
        const encoder = new TextEncoder();
        const uint8Arr = encoder.encode(str); // 转为 Uint8Array（二进制数组）
        
        // 步骤2：Uint8Array 转为二进制字符串（btoa() 仅支持二进制字符串）
        const binaryStr = String.fromCharCode.apply(null, uint8Arr);
        
        // 步骤3：二进制字符串编码为 Base64
        return btoa(binaryStr);
    }
}
export default XfWebSocketTool;