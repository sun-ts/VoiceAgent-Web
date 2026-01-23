<template>
  <div class="vad-detector">
    <h4>实时语音检测并用模型(DP V3.2)联网搜索回答</h4>
    <button @click="toggleVAD" :disabled="loading">
      {{ listening ? '停止检测' : '开始检测' }}
    </button>
    <div v-if="loading">加载中...</div>
    <div class="visualizer" :style="{ backgroundColor: indicatorColor }">
      检测状态: {{ statusText }}
    </div>
    <div>
      <div style="margin:0px auto;">
        是否启动大模型问答及语音播报：：
        <el-switch v-model="switchValue" inline-prompt
          active-text="开启" inactive-text="关闭" />
      </div>
      <div ref="scrollContainer" class="chat-container">
        <div class="chat-loop" v-for="(item, index) in voiceTexts" :key="index">
          <div class="chat-bubble chat-bubble-send" v-if="item.voiceText && item.voiceText.trim()!==''">
            {{ item.voiceText }}
          </div>
          <div class="chat-bubble chat-bubble-receive" v-if="item.answerText && item.answerText.trim()!==''">
            {{ item.answerText }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getCurrentInstance, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { MicVAD } from '@ricky0123/vad-web'
import * as ort from 'onnxruntime-web'

import VoiceText from '../utils/Entitys/VoiceText.js'
import IatResult from '../utils/Entitys/IatResult.js'
import AudioSound from '../utils/Entitys/AudioSound.js'
import VoiceService from '../utils/Services/VoiceService.js'
import AiAgentService from '../utils/Services/AiAgentService.js'
import AudioService from '../utils/Services/AudioService.js'

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

const scrollContainer = ref(null);

// 状态管理
const vad = ref<any>(null)
const breakFlag = ref(false)
const breakUUID = ref('');
const breakModelUUIDList = ref<string[]>([]);
const breakSoundUUIDList = ref<string[]>([]);
const listening = ref(false)
const loading = ref(false)
const statusText = ref('未开始')
const voiceTexts = ref<VoiceText[]>([])
const indicatorColor = ref('#cccccc')

const switchValue = ref(true)
const selectedValue = ref('英语:')

const numContent = ref(5); //关联上下文

const voiceService = ref<any>(null)
const audioService = ref<any>(null)
const aiAgents = ref<AiAgentService[]>([]);

const instance = getCurrentInstance();

const iatResults = ref<IatResult[]>([])

const soundEncode = ref('');
const audioSounds = ref<AudioSound[]>([]);
const audioContext = ref<any>(null);
const audioBufferSource = ref<any>(null);
const audioUrl = ref<string>(null);
const audioObj = ref<any>(null);
const play_UUID = ref<string>('');
const play_Num = ref<number>(0);
const playClock = ref<any>(null);
const playSoundStatus = ref(false);
const playPause = ref(0);
const playPauseSound = ref<any>(null);
const isContinue = ref(false);

const startTime = ref<number>(0);

// 切换检测状态
const toggleVAD = async () => {
  ///
  if(!audioContext.value)
    audioContext.value = new (window.AudioContext || (window as any).webkitAudioContext)();

  if (listening.value) {
    await vad.value.pause()
    closeVoicePlayThread();
    listening.value = false
    statusText.value = '已停止'
    indicatorColor.value = '#cccccc'
  } else {
    await vad.value.start();
    VoicePlayThread();
    listening.value = true;
    voiceService.value.resetDecibel();
    statusText.value = '正在检测...';
    
    ///开场白展示及播报
    if (instance.appContext.config.globalProperties.$isOpeningRemarks == 'true') {
      const voiceText = new VoiceText(
          dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss'),
          '', '', 0);
      voiceText.addVoiceAnswer(instance.appContext.config.globalProperties.$openingRemarks,false);
      audioService.value.AddSendContentToAudio(instance.appContext.config.globalProperties.$uuid(), 
        voiceText.answerText, false);
      voiceTexts.value.push(voiceText);
    }
  }
}

// 初始化VAD
const initVAD = async () => {
  try {
    loading.value = true;
    
    // 配置ONNX运行时
    // ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/' //测试环境
    ort.env.wasm.wasmPaths = '/onnxruntime/'  //正式环境
    ort.env.logLevel = 'error';

    soundEncode.value = instance.appContext.config.globalProperties.$audioEncode;

    voiceService.value = new VoiceService(0.5, 0.5, 5, 32, 250,
      instance, showVociceText, breakAnswer, inputVolume);
    audioService.value = new AudioService(textToTTSCallBack);
    
    // 创建VAD实例
    vad.value = await MicVAD.new({
      model: 'v5', // 使用v5模型
      processorType : 'auto',
      startOnLoad : false,
      // 帧处理回调 - 实时更新状态
      onFrameProcessed: (probs, frame) => {
        //16000每帧32ms音频
        voiceService.value.voiceTranslate(probs, frame);
      },
      onVADMisfire: () => {},
      onSpeechStart: () => {},
      onSpeechEnd: (audio: Float32Array) => {},
      onSpeechRealStart: () => {},
      // 资源路径配置
      // baseAssetPath: '/node_modules/@ricky0123/vad-web/dist/', //测试环境
      // onnxWASMBasePath: '/node_modules/onnxruntime-web/dist/', //测试环境
      baseAssetPath: '/models/',          //正式环境
      onnxWASMBasePath: '/onnxruntime/',  //正式环境
    });
    
    loading.value = false
  } catch (err) {
    loading.value = false
    console.error('VAD初始化错误:', err)
  }
}

/**
 * 展示翻译内容
 */
const showVociceText = async (uuid:string,data:string) => {
  let index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  
  if(index < 0) {
    voiceTexts.value.push(
      new VoiceText(
        dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss'),
        uuid, '', 0));
    index = voiceTexts.value.length - 1;
  }

  // console.log('返回数据:'+data)
  const res = JSON.parse(data)
  if (res.code != 0) {
    console.log(`error code ${res.code}, reason ${res.message}`)
    voiceTexts.value[index].voiceText = '翻译出错错误编码：' + res.code + ',错误信息：' + res.message;
    closeWebSocket(voiceService.value,uuid);
    return;
  }
  //// 设置当前翻译状态
  voiceTexts.value[index].status = res.data.status;

  let str = "";
  let indexIatResult = iatResults.value.findIndex(iatResult => iatResult.isMine(uuid));
  if(indexIatResult < 0) {
    iatResults.value.push(new IatResult(uuid));
    indexIatResult = iatResults.value.length -1;
  }

  iatResults.value[indexIatResult].iatResult[res.data.result.sn] = res.data.result
  if (res.data.result.pgs == 'rpl') {
    res.data.result.rg.forEach(i => {
      iatResults.value[indexIatResult].iatResult[i] = null
    });
  }
  
  iatResults.value[indexIatResult].iatResult.forEach(i => {
    if (i != null) {
      i.ws.forEach(j => {
        j.cw.forEach(k => {
          str += k.w
        })
      })
    }
  });
    
  if(str && str.trim()){
    voiceTexts.value[index].voiceText = str;
    // if(switchValue.value)
    //   voiceTexts.value[index].targetLang = selectedValue.value;
    if (isContinue.value) {
      if (!breakFlag.value && breakUUID.value && breakUUID.value == uuid){
        let rexg = /([,，.。!！?？;；:：]+)/g,
          noSplitWorld = str.trim().replace(rexg,'');
        if (noSplitWorld.length > 5) {
          breakFlag.value = true;
          breakSuccess(uuid);
        }
      }
    }
  } else {
    voiceTexts.value.splice(index,1);
  }

  // res.data.status ==2 说明数据全部返回完毕，可以关闭连接，释放资源
  if (res.data.status == 2) { 
    closeWebSocket(voiceService.value,uuid);
    iatResults.value.splice(indexIatResult,1);

    if(switchValue.value && str && str.trim()) {
      if(isContinue.value && !breakFlag.value) {
        //不需要调用翻译和转译
      } else {
        translateToOtherLanguage(uuid);
      }
    }

    if (breakUUID.value && breakUUID.value == uuid){
      if(breakFlag.value) {
        breakSuccess(uuid).then(() => {
          breakUUID.value = '';});
        isContinue.value = false;
      } else {
        breakUUID.value = '';
      }
    }
  }
}

/**
 * 调用大模型进行文本翻译
 */
const translateToOtherLanguage = async (uuid) => {
  const system = instance.appContext.config.globalProperties.$llmPrompt;
  const aiAgent = new AiAgentService(uuid);
  aiAgents.value.push(aiAgent);

  const index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  if (index > -1) {
    const beContext = [];
    if (numContent.value > 1 && index > 1) {
      let iNum=index-numContent.value+1>-1?index-numContent.value+1:0;
      for(;iNum<index;iNum++) {
        beContext.push({"role": "user", "content":voiceTexts.value[iNum].voiceText});
        beContext.push({"role": "assistant","partial": false,"content": voiceTexts.value[iNum].answerText});
      }
    }

    aiAgent.sendQuestion(uuid, "deepseek-v3.1", system, 
      voiceTexts.value[index].voiceText, 
      voiceTexts.value[index].targetLang,
      translateCallBack,
      {
        enable_thinking:false,
        temperature:0,
        enable_search:true,
        beContext:beContext
      });
  } else {
    console.error("-".repeat(10) + "语音翻译查找待识别文本时失败！" + "-".repeat(10));
  }
}

/**
 * 文本翻译回调函数
 */
const translateCallBack = async (uuid, content, isAnswer) => {
  let indexBreak = breakModelUUIDList.value.findIndex(item => item == uuid);
  if(indexBreak > -1) {
    if(!isAnswer) {
      breakModelUUIDList.value.splice(indexBreak,1);
    } else {
      return;
    }
  } else if (breakUUID.value && breakFlag.value && breakUUID.value != uuid) {
    breakModelUUIDList.value.push(uuid);
    isAnswer = false;
  }

  const index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  if (index > -1) {
    audioService.value.AddSendContentToAudio(uuid, content, isAnswer);
    voiceTexts.value[index].addVoiceAnswer(content, isAnswer);
  } else {
    console.error("-".repeat(10) + "语音翻译查找待识别文本时失败！" + "-".repeat(10));
  }
}

/**
 * 文本转语音的回调函数
 */
const textToTTSCallBack = async (uuid, data) => {
  const res = JSON.parse(data);
  if (res.code != 0) {
    console.error(`${res.code}: ${res.message}`);
    closeWebSocket(audioService.value,uuid);
    return;
  }

  let uuidOrg = uuid.substring(0,36);
  let indexBreak = breakSoundUUIDList.value.findIndex(item => item == uuidOrg);
  if(indexBreak > -1) {
    if(res.data.status == 2) {
      breakSoundUUIDList.value.splice(indexBreak,1);
    } else {
      return;
    }
  } else if (breakUUID.value && breakFlag.value && breakUUID.value != uuidOrg) {
    breakSoundUUIDList.value.push(uuidOrg);
    closeWebSocket(audioService.value,uuid);
    return;
  }

  // res.data.status ==2 说明数据全部返回完毕，可以关闭连接，释放资源
  if (res.data.status == 2) { 
    closeWebSocket(audioService.value,uuid);
  }
  
  const index = audioSounds.value.findIndex(audioSound => audioSound.isMine(uuid));
  if(index > -1) {
    audioSounds.value[index].addAudioSound(res.data.audio,res.data.status);
  } else {
    let audioSound = null;
    if (soundEncode.value == 'PCM') {
      audioSound = new AudioSound(uuid,audioContext.value,{encoding:soundEncode.value});
    } else {
      audioSound = new AudioSound(uuid,audioContext.value,{sampleRate:16000,channels:1,bitRate:128,bitDeep:16,encoding:soundEncode.value});
    }
    audioSound.addAudioSound(res.data.audio,res.data.status);
    audioSounds.value.push(audioSound);
  }
}

/**
 * 声音播放方法
 */
const VoicePlayThread = () => {
  playClock.value = setInterval(() => {
    if(playSoundStatus.value) return;

    if(breakUUID.value) return;

    if (soundEncode.value == 'PCM') {
      pcmPlayer();
    } else if (soundEncode.value == 'MP3') {
      mp3Player();
    }
  },10);
}

/**
 * PCM播放器
 */
const pcmPlayer = () => {
  try {
    /// 续播及新播逻辑，未查到数据直接返回
    playPauseSound.value = GetVoicePlay();
    if (!playPauseSound.value) {
      return;
    }
    // if (audioSounds.value.length > 0 && audioSounds.value[0].SoundAll) {
    //   playPauseSound.value = audioSounds.value.shift();
    // } else {
    //   return;
    // }
    play_Num.value = playPauseSound.value.uuidNum;
    play_UUID.value = playPauseSound.value.uuidOrg;

    if(playPauseSound.value.uuidFlag === 'true') {
      play_Num.value = 0;
      play_UUID.value = '';
    }

    audioBufferSource.value = audioContext.value.createBufferSource();
    audioBufferSource.value.buffer = playPauseSound.value.SoundAll;
    audioBufferSource.value.connect(audioContext.value.destination);
    audioBufferSource.value.start(0);
    playPause.value = 0;
    isContinue.value = false;
    playSoundStatus.value = true;
    breakFlag.value = false;

    // 播放结束后释放临时 URL（优化性能）
    audioBufferSource.value.onended = () => {
      //console.log('-'.repeat(10) + audioContext.value.state + '-'.repeat(10))
      if(audioBufferSource.value)
        audioBufferSource.value.disconnect();
      audioBufferSource.value = null;
      playSoundStatus.value = false;
    };
  } catch (err) {
    if(audioBufferSource.value)
      audioBufferSource.value.disconnect();
    audioBufferSource.value = null;
    playSoundStatus.value = false;
    if (!play_UUID.value) {
      play_Num.value++;
    }
  }
}

/**
 * MP3播放器
 */
const mp3Player = () => {
  try {
    if(!isContinue.value) {
      playPauseSound.value = GetVoicePlay();
      if(playPauseSound.value) {
        audioUrl.value = URL.createObjectURL(playPauseSound.value.SoundAll)
        audioObj.value = new Audio(audioUrl.value);
      } else {
        return;
      }
      // if (audioSounds.value.length > 0 && audioSounds.value[0].SoundAll) {
      //   playPauseSound.value = audioSounds.value.shift();
      //   audioUrl.value = URL.createObjectURL(playPauseSound.value.SoundAll)
      //   audioObj.value = new Audio(audioUrl.value);
      // } else {
      //   return;
      // }
    } else {
      isContinue.value = false;
      if (!audioObj.value) {
        console.log('-'.repeat(10) + '续播失败!' + '-'.repeat(10));
        return;
      }
    }

    audioObj.value.play().catch(err => {
        console.error('-'.repeat(10) + '播放失败：' + '-'.repeat(10), err);
      });
    playSoundStatus.value = true;

    play_Num.value = playPauseSound.value.uuidNum;
    play_UUID.value = playPauseSound.value.uuidOrg;

    breakUUID.value = '';
    breakFlag.value = false;

    if(playPauseSound.value.uuidFlag === 'true') {
      play_Num.value = 0;
      play_UUID.value = '';
    }

    audioObj.value.onended = () => {
      audioObj.value = null;
      URL.revokeObjectURL(audioUrl.value);
      audioUrl.value = null;
      playSoundStatus.value = false;
    };
  } catch(err) {
    audioObj.value = null;
    URL.revokeObjectURL(audioUrl.value);
    audioUrl.value = null;
    playSoundStatus.value = false;
    if (!play_UUID.value) {
      play_Num.value++;
    }
  }
}

/**
 * 获取应该播放的
 */
const GetVoicePlay = ():AudioSound => {
  if(audioSounds.value.length < 1)
    return null;
  let indexAudioSound = -1;
  if(play_UUID.value == '') {
    indexAudioSound = audioSounds.value.findIndex(audioSound => audioSound.uuidNum == 1);
  } else {
    indexAudioSound = audioSounds.value.findIndex(
      audioSound => audioSound.uuidOrg == play_UUID.value && 
        audioSound.uuidNum == play_Num.value + 1);
  }
  if(indexAudioSound > -1) {
    if(audioSounds.value[indexAudioSound].SoundAll) {
      return audioSounds.value.splice(indexAudioSound,1)[0];
    }
  }
  return null;
}

/**
 * 声音停止播放方法
 */
const closeVoicePlayThread = () => {
  if (playClock.value) {
    clearInterval(playClock.value);
  }
  audioSounds.value = [];
  playSoundStatus.value = false;

  play_Num.value = 0;
  play_UUID.value = '';

  if (soundEncode.value == 'PCM') {
    if(audioBufferSource.value) {
      audioBufferSource.value.stop();
    }
  } else if (soundEncode.value == 'MP3') {
    //Mp3关闭
    if(audioObj.value) {
      audioObj.value.currentTime = 0;
      // 可选：重置播放状态，避免异常
      audioObj.value.load(); 
      audioObj.value = null;
      URL.revokeObjectURL(audioUrl.value);
    }
  }
}

/**
 * 打断播报
 */
const breakAnswer = async (uuid) => {
  if(breakUUID.value != uuid)
    breakUUID.value = uuid;
  else
    return;
  if (playSoundStatus.value) {
    isContinue.value = true;
  }
  if (soundEncode.value == 'MP3') {
    if(audioObj.value) {
      audioObj.value.pause();
    }
    playSoundStatus.value = false;
  }
}

/**
 * 成功打断
 */
const breakSuccess = async (uuid) => {
  if (soundEncode.value == 'MP3') {
    if(audioObj.value) {
      audioObj.value.currentTime = 0;
      // 可选：重置播放状态，避免异常
      audioObj.value.src = '';
      audioObj.value.load(); 
      audioObj.value = null;
      URL.revokeObjectURL(audioUrl.value);
      audioUrl.value = null;
    }
    playSoundStatus.value = false;
    isContinue.value = false;
  }
  //console.log('-'.repeat(10) + 'breakSuccess被调用' + '-'.repeat(10))

  play_Num.value = 0;
  play_UUID.value = '';
  
  if(audioSounds.value.length > 0) {
    for(let i=audioSounds.value.length-1; i>-1; i--) {
      if (audioSounds.value[i].uuid.substring(0,36) != uuid) {
        audioSounds.value.splice(i,1);
      }
    }
  }
  if(aiAgents.value.length > 0) {
    for (let i=aiAgents.value.length-1; i>-1; i--) {
      if(!aiAgents.value[i].isMine(uuid)) {
        aiAgents.value[i].loopFlag = false;
        aiAgents.value.splice(i,1);
      }
    }
  }
}

/**
 *  关闭WebSocket
 */
const closeWebSocket = (webSocketObj,uuid) => {
  if(webSocketObj) {
    let webSocket = webSocketObj.getWebSocketShiftByUUID(uuid);
    if(webSocket) {
      webSocket.close();
    }
  }
}

/**
 * 声音大小实时展示
 */
const inputVolume = async (volume) => {
  //console.log(volume);
  indicatorColor.value = volume;
}

// 组件挂载时初始化
onMounted(() => {
  initVAD();
  // 扩展 dayjs 支持时区和UTC
  dayjs.extend(utc);
  dayjs.extend(timezone);
})

// 监控组件内容变化并展示最新内容
watch(
  voiceTexts,
  ()=>{
    // 关键：使用 $nextTick，确保 DOM 已更新完成后再执行滚动
    nextTick(() => {
      if (scrollContainer.value) {
        const container = scrollContainer.value;
        // 滚动到底部的核心 API：设置 scrollTop 为 scrollHeight
        container.scrollTop = container.scrollHeight;
      }
    });
  },
  { deep: true }
);

// 组件卸载时清理
onUnmounted(async () => {
  if (vad.value) {
    await vad.value.destroy()
  }
  if (audioContext.value) {
    audioContext.value = null;
    if(audioBufferSource.value) {
      audioBufferSource.value.stop();
    }
  }
  if(audioObj.value) {
    audioObj.value.stop();
  }
})
</script>

<style scoped>
.vad-detector {
  flex: 1;
  width: 100%;
}

button {
  padding: 4px 16px;
  background: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background: #cccccc;
  cursor: not-allowed;
}

.error {
  color: #ff4444;
}

.visualizer {
  height: 25px;
  margin-top: 10px;
  border-radius: 4px;
  transition: background-color 0.1s ease;
}

/* 聊天容器：优化背景和内边距 */
.chat-container {
  height: 480px;
  margin: 0px auto;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1); /* 容器阴影，提升层次感 */
  font-family: "Microsoft Yahei", sans-serif;

  overflow-y: auto;
  overflow-x: hidden;
}

/* 通用气泡样式：增强效果 */
.chat-bubble {
  max-width: 75%;
  padding: 10px 14px;
  margin: 10px 0;
  border-radius: 16px;
  line-height: 1.5;
  word-wrap: break-word;
  position: relative;
  color: #333;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08); /* 气泡阴影，更立体 */
  transition: all 0.2s ease; /* 过渡效果，提升交互体验 */
}

/* 接收方气泡：调整背景色 */
.chat-bubble-receive {
  float: left;
  clear: both;
  text-align: left;
  background-color: #ffffff;
  border: 1px solid #e9ecef; /* 增加边框，区分背景 */
}

/* 接收方箭头：优化颜色，与边框匹配 */
.chat-bubble-receive::before {
  content: "";
  position: fixed;
  left: -8px;
  top: 14px;
  border-top: 6px solid transparent;
  border-right: 8px solid #ffffff; /* 气泡背景色 */
  border-bottom: 6px solid transparent;
  /* 箭头边框阴影，与气泡边框衔接 */
  filter: drop-shadow(-1px 0px 0px #e9ecef);
}

/* 发送方气泡：优化背景色 */
.chat-bubble-send {
  float: right;
  clear: both;
  text-align: left;
  background-color: #3EB575;
  color: #000;
}

/* 发送方箭头：优化颜色 */
.chat-bubble-send::before {
  content: "";
  position: absolute;
  right: -8px;
  top: 14px;
  border-top: 6px solid transparent;
  border-left: 8px solid #3EB575;
  border-bottom: 6px solid transparent;
}

/* 气泡 hover 效果：轻微缩放，增强交互 */
.chat-bubble:hover {
  transform: scale(1.01);
  box-shadow: 0 2px 6px rgba(0,0,0,0.12);
}
</style>