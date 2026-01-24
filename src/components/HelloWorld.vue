<template>
  <div class="vad-detector">
    <h4>实时语音检测并用模型联网搜索回答</h4>
    <div class="vad-left-set">
      <div class="right-option">
        <div class="divtitle" style="color:#999999;font-size:9px;line-height:20px">
          系统采用实时语音交互，操作人可直接与机器人对话并切换回答模型，对话过程可随时打断语音机器人回复，打断规则：新录入的语音字数大于5，如果小于5个字机器人会继续回复你的上一个问题。
        </div>
        <div class="divtitle">
          <el-switch v-model="isOpeningRemarks" inline-prompt
            active-text="开启" inactive-text="关闭"
            style="--el-switch-on-color: #13ce66;--el-switch-off-color: #ff4949" />
        </div>
        <div class="divtitle">
          <el-switch v-model="switchValue" inline-prompt
            active-text="开启" inactive-text="关闭"
            style="--el-switch-on-color: #13ce66;--el-switch-off-color: #ff4949" />
        </div>
        <div class="divtitlePrompt">
          <el-input v-model="promptWord" type="textarea" :rows="10" resize="none" :disabled="!switchValue" />
        </div>
        <div class="divtitle">
          <el-select class="el-model-select" v-model="modelSelected" :disabled="!switchValue">
            <el-option value="deepseek-v3.1" label='DeepSeek V3.1' />
            <el-option value="qwen3-max" label='千问3-MAX' />
            <el-option value="qwen-plus" label='千问3-PLUS' />
            <el-option value="qwen-plus-latest" label='千问3-PLUS-LATEST' />
          </el-select>
        </div>
        <div class="divtitle">
          <el-input-number v-model="numContent" :min="1" :max="10" :step="1" 
            :disabled="!switchValue" />
        </div>
        <div class="divtitle">
          <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" 
            :disabled="!switchValue" />
        </div>
        <div class="divtitle">
          <el-switch v-model="linkWeb" inline-prompt :disabled="!switchValue"
            active-text="开启" inactive-text="关闭"
            style="--el-switch-on-color: #13ce66;--el-switch-off-color: #ff4949" />
        </div>
        <div class="divtitle">
          <el-switch v-model="thinking" inline-prompt :disabled="!switchValue"
            active-text="开启" inactive-text="关闭"
            style="--el-switch-on-color: #13ce66;--el-switch-off-color: #ff4949" />
        </div>
        <!-- <div class="divtitle">
          <el-input-number v-model="thinkingToken" :min="1" :max="32768" :step="100" 
            :disabled="!thinking" />
        </div> -->
      </div>
      <div class="left-name">
        <div class="divtitle">系统交互说明</div>
        <div class="divtitle">播报开场白</div>
        <div class="divtitle">大模型问答及语音播报</div>
        <div class="divtitlePrompt">提示词</div>
        <div class="divtitle">模型选择</div>
        <div class="divtitle">关联上下文</div>
        <div class="divtitle">模型温度</div>
        <div class="divtitle">联网搜索</div>
        <div class="divtitle">是否深度思考</div>
        <!-- <div class="divtitle">思维链Token</div> -->
      </div>
      <div style="float:right;width:100%;text-align:center;margin-top:20px;">
        <button @click="toggleVAD" :disabled="loading" 
            :style="{'background':listening?'#ff4949':'#42b983'}">
          {{ listening ? '停止检测' : '开始检测' }}
        </button>
      </div>
    </div>
    <div class="vad-right-view">
      <div v-if="loading">加载中...</div>
      <div class="visualizer" :style="{ backgroundColor: indicatorColor }">
        语音检测状态: {{ statusText }}
      </div>
      <div>
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
        <div class="chat-input">
          <el-input v-model="userInput" type="textarea" @keydown="handleKeyDown" :disabled="!listening"
            clearable resize="none" :rows="3" placeholder="Command/Ctrl+Enter To Send" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getCurrentInstance, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
/// VAD和ONNX运行时
import { MicVAD } from '@ricky0123/vad-web'
import * as ort from 'onnxruntime-web'

/// 实体类和服务类
import VoiceText from '../utils/Entitys/VoiceText.js'
import IatResult from '../utils/Entitys/IatResult.js'
import AudioSound from '../utils/Entitys/AudioSound.js'
import VoiceService from '../utils/Services/VoiceService.js'
import AiAgentService from '../utils/Services/AiAgentService.js'
import AudioService from '../utils/Services/AudioService.js'

/// 时间处理库
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

/// 滚动容器引用
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

/// 对话数据存储变量
const voiceTexts = ref<VoiceText[]>([])
const iatResults = ref<IatResult[]>([])
const indicatorColor = ref('#cccccc')

///页面控制控件
const switchValue = ref(true)
const isOpeningRemarks = ref(true);
const isDisabled = ref(false)
const promptWord = ref('');
const modelSelected = ref('deepseek-v3.1');
const numContent = ref(1);
const linkWeb = ref(true);
const temperature = ref(0);
const thinking = ref(false)
const thinkingToken = ref(1)
const userInput = ref('');
const selectedValue = ref('英语:')

/// 服务实例
const voiceService = ref<any>(null)
const audioService = ref<any>(null)
const aiAgents = ref<AiAgentService[]>([]);

/// 获取当前实例以访问全局属性
const instance = getCurrentInstance();

/**
 * 音频播放相关变量
 */
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

/**
 *  页面初始化VAD+基础元素
 */
const initVAD = async () => {
  try {
    loading.value = true;
    
    // 配置ONNX运行时
    // ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/' //测试环境
    ort.env.wasm.wasmPaths = '/onnxruntime/'  //正式环境
    ort.env.logLevel = 'error';

    promptWord.value = instance.appContext.config.globalProperties.$llmPrompt;
    isOpeningRemarks.value = instance.appContext.config.globalProperties.$isOpeningRemarks == 'true';
    soundEncode.value = instance.appContext.config.globalProperties.$audioEncode;

    voiceService.value = new VoiceService(0.5, 0.5, 3, 37, 250,
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
    if (isOpeningRemarks.value) {
      const voiceText = new VoiceText(
          dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss'),
          instance.appContext.config.globalProperties.$uuid(), '', 0);
      voiceText.addVoiceAnswer(instance.appContext.config.globalProperties.$openingRemarks,false);
      /// 获取语音数据
      if(switchValue.value) {
        audioService.value.AddSendContentToAudio(instance.appContext.config.globalProperties.$uuid(), 
          voiceText.answerText, false);
      }
      voiceTexts.value.push(voiceText);
    }
  }
}

/**
 * 输入数据直接进行打断处理
 */
const handleKeyDown = (e) => {
  // 处理回车键逻辑 判断：Mac(metaKey=Command) 或 Windows(ctrlKey=Ctrl) + Enter(keyCode=13)
  if ((e.metaKey || e.ctrlKey) && e.keyCode === 13) {
    e.preventDefault();

    if(userInput.value && userInput.value.trim() !== '') {
      let uuid = instance.appContext.config.globalProperties.$uuid();

      if(playSoundStatus.value) {
        breakUUID.value = uuid;
        breakFlag.value = true;
      }

      const voiceText = new VoiceText(
        dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss'),
        uuid, userInput.value.trim(), 0);
      voiceTexts.value.push(voiceText);
      if(switchValue.value) {
        translateToOtherLanguage(uuid);
      }
      userInput.value = '';

      breakSuccess(uuid).then(() => {
          breakUUID.value = '';});
    }
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

  /// 数据临时存储
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
  const aiAgent = new AiAgentService(uuid);
  aiAgents.value.push(aiAgent);

  const index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  if (index > -1) {
    /// 关联上下文
    const beContext = [];
    if (numContent.value > 1 && index > 1) {
      let iNum=index-numContent.value+1>-1?index-numContent.value+1:0;
      for(;iNum<index;iNum++) {
        beContext.push({"role": "user", "content":voiceTexts.value[iNum].voiceText});
        beContext.push({"role": "assistant","partial": false,"content": voiceTexts.value[iNum].answerText});
      }
    }
    
    /// 调用大模型服务
    aiAgent.sendQuestion(uuid, modelSelected.value, promptWord.value, 
      voiceTexts.value[index].voiceText, 
      voiceTexts.value[index].targetLang,translateCallBack,
      {
        enable_thinking:thinking.value,
        temperature:temperature.value,
        enable_search:linkWeb.value,
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
  /// 处理打断逻辑
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

  /// 展示大模型输出结果
  const index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  if (index > -1) {
    audioService.value.AddSendContentToAudio(uuid, content, isAnswer);
    voiceTexts.value[index].addVoiceAnswer(content, isAnswer);
  } else {
    console.error("-".repeat(10) + "语音信息处理数据失败！" + "-".repeat(10));
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

  /// 处理打断逻辑
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
  
  /// 添加待播放的声音数据
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
 * 声音播放方法，定时任务每10秒检查一次
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
    /// 当前播放音频段落信息
    play_Num.value = playPauseSound.value.uuidNum;
    play_UUID.value = playPauseSound.value.uuidOrg;

    if(playPauseSound.value.uuidFlag === 'true') {
      play_Num.value = 0;
      play_UUID.value = '';
    }

    /// 播放音频数据
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
    /// 播放失败处理
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
    /// 续播及新播逻辑，未查到数据直接返回
    if(!isContinue.value) {
      playPauseSound.value = GetVoicePlay();
      if(playPauseSound.value) {
        audioUrl.value = URL.createObjectURL(playPauseSound.value.SoundAll)
        audioObj.value = new Audio(audioUrl.value);
      } else {
        return;
      }
    } else {
      isContinue.value = false;
      if (!audioObj.value) {
        console.log('-'.repeat(10) + '续播失败!' + '-'.repeat(10));
        return;
      }
    }

    /// 播放音频数据
    audioObj.value.play().catch(err => {
        console.error('-'.repeat(10) + '播放失败：' + '-'.repeat(10), err);
      });
    playSoundStatus.value = true;

    /// 当前播放音频段落信息
    play_Num.value = playPauseSound.value.uuidNum;
    play_UUID.value = playPauseSound.value.uuidOrg;

    breakUUID.value = '';
    breakFlag.value = false;

    /// 播放结束后启动下一节播放
    if(playPauseSound.value.uuidFlag === 'true') {
      play_Num.value = 0;
      play_UUID.value = '';
    }

    /// 播放结束后释放临时 URL（优化性能）
    audioObj.value.onended = () => {
      audioObj.value = null;
      URL.revokeObjectURL(audioUrl.value);
      audioUrl.value = null;
      playSoundStatus.value = false;
    };
  } catch(err) {
    /// 播放失败处理
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
  /// MP3停止播放、PCM播放器在下一个周期停止
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
  /// PCM播放器在下一个周期停止、MP3立即停止停止播放
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

  play_Num.value = 0;
  play_UUID.value = '';
  
  /// 清理未播放的声音数据
  if(audioSounds.value.length > 0) {
    for(let i=audioSounds.value.length-1; i>-1; i--) {
      if (audioSounds.value[i].uuid.substring(0,36) != uuid) {
        audioSounds.value.splice(i,1);
      }
    }
  }
  /// 清理未完成的大模型输出数据
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
  /// 停止VAD
  if (vad.value) {
    await vad.value.destroy()
  }
  /// 停止音频播放
  if (audioContext.value) {
    audioContext.value = null;
    if(audioBufferSource.value) {
      audioBufferSource.value.stop();
    }
  }
  /// 停止MP3播放
  if(audioObj.value) {
    audioObj.value.stop();
  }
})
</script>

<style scoped>
.vad-detector {
  width: 100%;
  margin: 0px;
  padding: 0px;
}

.vad-left-set {
  float: left;
  width: 50%;
}
.vad-left-set .left-name {
  float: right;
  width: 30%;
  text-align: right;
  margin: 0px 10px;
}
.vad-left-set * .divtitle {
  height: 50px;
  padding: auto 0px;
  line-height: 50px;
}
.divtitlePrompt {
  min-height: 220px;
  line-height: 30px;
}
.vad-left-set .right-option {
  float: right;
  width: 60%;
  text-align: left;
  margin: 0px 10px;
}

.el-model-select {
  width: 300px;
}

.vad-right-view {
  float: right;
  width: 50%;
}

button {
  padding: 5px 16px;
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
  width: 95%;
  height: 25px;
  margin: 10px auto;
  border-radius: 4px;
  transition: background-color 0.1s ease;
}

/* 聊天容器：优化背景和内边距 */
.chat-container {
  width: 95%;
  height: 590px;
  margin: 10px auto 0px auto;
  padding: 15px auto;
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

.chat-input {
  width: 95.5%;
  margin: 10px auto 0px auto;
}
</style>