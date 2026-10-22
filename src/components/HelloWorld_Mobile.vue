<template>
  <div class="mobile-container">
    <!-- 可收缩的头部控制区域 -->
    <div class="collapsible-header" :class="{ 'collapsed': headerCollapsed }">
      <div class="header-toggle" @click="toggleHeader" :aria-label="headerCollapsed ? '展开控制面板' : '收缩控制面板'">
        <div class="arrow-icon" :class="{ 'rotate-icon': headerCollapsed }">▼</div>
        <span>{{ headerCollapsed ? '展开控制面板' : '收缩控制面板' }}</span>
      </div>

        <div class="header-content" v-show="!headerCollapsed">
        <div class="mobile-header">
          <div class="title-group">
            <h4>实时语音检测并用模型(qwen3.7-plus)联网搜索回答</h4>
            <p class="mobile-subtitle">Voice Assist Console</p>
          </div>
          <div class="header-meta">
            <span class="meta-chip" :class="{ active: listening }">{{ listening ? '实时监听中' : '待命中' }}</span>
            <span class="meta-chip">会话 {{ voiceTexts.length }}</span>
            <span class="meta-chip">嘈杂环境</span>
          </div>
          <div class="header-actions">
            <el-button
              @click="toggleVAD"
              :disabled="loading || starting || !vad || initError"
              :type="listening ? 'danger' : 'success'"
              class="toggle-button"
              :aria-label="loading ? '语音引擎准备中…' : listening ? '停止语音检测' : '开始语音检测'"
            >
              {{ loading ? '语音引擎准备中…' : listening ? '停止检测' : '开始检测' }}
            </el-button>
            <el-button v-if="initError" @click="reloadVoicePage">重新加载</el-button>
            <button class="logout-neon-button" type="button" @click="emit('logout')" aria-label="退出登录">
              <span class="logout-dot" aria-hidden="true"></span>
              退出登录
            </button>
          </div>
        </div>

        <div class="status-area" role="status" aria-live="polite">
          <div class="visualizer" :style="{ backgroundColor: indicatorColor }" aria-label="语音检测状态指示器">
            <div class="visualizer-content">
              <span class="status-dot" :class="{ active: listening }" aria-hidden="true"></span>
              <span>检测状态:</span>
              <span class="status-text" id="status-text">{{ statusText }}</span>
            </div>
          </div>
        </div>

        <InterruptionControls v-model="interruptionSettings" :locked="listening || starting" />
        <VolumeFilterControls v-model="volumeFilterSettings" :locked="listening || starting" />
        <SettingsCard title="大模型配置">
          <el-form label-position="left" label-width="auto" size="small" class="settings-inline">
            <el-form-item>
              <template #label><SettingHelp label="AI回答" help="开启后，将识别的问题发送给大模型并播报回答。关闭后只进行语音识别，不生成新的回答。手机端使用配置文件中的模型参数。" /></template>
              <el-switch v-model="switchValue" inline-prompt active-text="开启" inactive-text="关闭"
                aria-label="启用大模型问答及语音播报" />
            </el-form-item>
          </el-form>
        </SettingsCard>
      </div>
    </div>

    <div class="chat-section">
      <div ref="scrollContainer" class="chat-container" role="log" aria-label="语音对话记录">
        <div v-if="voiceTexts.length === 0" class="chat-empty" role="note">
          <div class="chat-empty-title">对话区已就绪</div>
          <div class="chat-empty-desc">点击开始检测后直接说话，系统会实时识别并回答。</div>
        </div>
        <div class="chat-loop" v-for="(item, index) in voiceTexts" :key="index">
          <div class="message-row row-user" v-if="item.voiceText && item.voiceText.trim()!==''" role="article" aria-label="用户消息">
            <div class="chat-bubble chat-bubble-send">
              <div class="message-role">你</div>
              <div class="message-time">{{ item.time }}</div>
              <div class="message-content">{{ formatMessageContent(item.voiceText) }}</div>
            </div>
            <div class="message-avatar avatar-user" aria-hidden="true">你</div>
          </div>
          <div class="message-row row-bot" v-if="hasAnswerContent(item) || isModelThinking(item.uuid)" role="article" aria-label="系统回复">
            <div class="message-avatar avatar-bot" aria-hidden="true">AI</div>
            <div class="chat-bubble chat-bubble-receive">
              <div class="message-role">助手</div>
              <div class="message-time">{{ item.time }}</div>
              <div class="message-content">
                <template v-if="hasAnswerContent(item)">
                  {{ formatMessageContent(item.answerText) }}
                </template>
                <span v-else class="thinking-text">
                  AI助手正在思考中<span class="thinking-dots" aria-hidden="true">......</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getCurrentInstance, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { createVoiceDetector } from '../utils/Services/VoiceRuntime.js'
import InterruptionControls from './InterruptionControls.vue';
import SettingsCard from './SettingsCard.vue';
import SettingHelp from './SettingHelp.vue';
import VolumeFilterControls from './VolumeFilterControls.vue';
import { DEFAULT_VOLUME_FILTER_SETTINGS } from '../utils/Services/VolumeFilterSettings.js';
import { DEFAULT_INTERRUPTION_SETTINGS } from '../utils/Services/InterruptionSettings.js';
import { NOISY_VAD_PARAMETERS, toVoiceServiceParams } from '../utils/Services/VadEnvironments.js'

import VoiceText from '../utils/Entitys/VoiceText.js'
import IatResult from '../utils/Entitys/IatResult.js'
import AudioSound from '../utils/Entitys/AudioSound.js'
import VoiceService from '../utils/Services/VoiceService.js'
import { voiceLog } from '../utils/Services/VoiceDiagnostics.js'
import AiAgentService from '../utils/Services/AiAgentService.js'
import AudioService from '../utils/Services/AudioService.js'

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

const emit = defineEmits(['logout']);

const scrollContainer = ref(null);

// 状态管理
const vad = ref<any>(null)
const breakFlag = ref(false)
const breakUUID = ref('');
const breakModelUUIDList = ref<string[]>([]);
const breakSoundUUIDList = ref<string[]>([]);
const listening = ref(false)
const starting = ref(false)
const loading = ref(true)
const initError = ref(false)
const initialization = new AbortController();
const reloadVoicePage = () => window.location.reload();
const headerCollapsed = ref(false) // 控制头部区域是否收缩
const statusText = ref('语音引擎准备中…')
const voiceTexts = ref<VoiceText[]>([])
const indicatorColor = ref('#cccccc')

const switchValue = ref(true)
const interruptionSettings = ref({ ...DEFAULT_INTERRUPTION_SETTINGS });
const volumeFilterSettings = ref({ ...DEFAULT_VOLUME_FILTER_SETTINGS });
const selectedValue = ref('英语:')
const modelThinkingUUIDList = ref<string[]>([])

const formatMessageContent = (content:string) => {
  if (!content) {
    return '';
  }

  return content
    .replace(/\u2028|\u2029/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
};

const hasAnswerContent = (item: VoiceText) => Boolean(item.answerText && item.answerText.trim() !== '');

const isModelThinking = (uuid: string) => modelThinkingUUIDList.value.includes(uuid);

const markModelThinking = (uuid: string) => {
  if (!isModelThinking(uuid)) {
    modelThinkingUUIDList.value.push(uuid);
  }
};

const clearModelThinking = (uuid: string) => {
  const index = modelThinkingUUIDList.value.findIndex(item => item === uuid);
  if (index > -1) {
    modelThinkingUUIDList.value.splice(index, 1);
  }
};

const clearInterruptedThinking = (activeUUID: string) => {
  if (modelThinkingUUIDList.value.length < 1) {
    return;
  }
  const interruptedUUIDList = modelThinkingUUIDList.value.filter(item => item !== activeUUID);
  if (interruptedUUIDList.length < 1) {
    return;
  }
  interruptedUUIDList.forEach((uuid) => {
    clearModelThinking(uuid);
    if (!breakModelUUIDList.value.includes(uuid)) {
      breakModelUUIDList.value.push(uuid);
    }
  });
};

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
const micStreamRef = ref<MediaStream | null>(null);
const micStreamPending = ref<Promise<MediaStream> | null>(null);

const startTime = ref<number>(0);

const vadDebugLog = (reason: string) => {
  voiceLog('capture.microphone', { reason }, 'debug');
};

const isLiveStream = (stream: MediaStream | null | undefined): stream is MediaStream => {
  if (!stream) {
    return false;
  }
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks || audioTracks.length === 0) {
    return false;
  }
  return audioTracks.some(track => track.readyState === 'live');
};

const setMicEnabled = (stream: MediaStream, enabled: boolean) => {
  stream.getAudioTracks().forEach(track => {
    track.enabled = enabled;
  });
};

const requestNewMicStream = async () => {
  vadDebugLog('requesting new media stream');
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
    },
  });
};

const acquireMicStream = async () => {
  if (micStreamPending.value) {
    vadDebugLog('awaiting pending media stream');
    return await micStreamPending.value;
  }

  if (isLiveStream(micStreamRef.value)) {
    vadDebugLog('reusing cached live media stream');
    return micStreamRef.value;
  }

  micStreamPending.value = requestNewMicStream()
    .then((stream) => {
      micStreamRef.value = stream;
      vadDebugLog('media stream acquired');
      return stream;
    })
    .finally(() => {
      micStreamPending.value = null;
    });

  return await micStreamPending.value;
};

const releaseMicStream = async () => {
  if (micStreamPending.value) {
    try {
      await micStreamPending.value;
    } catch {
      // ignore pending request failures during release
    } finally {
      micStreamPending.value = null;
    }
  }

  if (micStreamRef.value) {
    vadDebugLog('releasing media stream');
    micStreamRef.value.getTracks().forEach(track => {
      if (track.readyState !== 'ended') {
        track.stop();
      }
    });
    micStreamRef.value = null;
  }
};

// 切换头部区域收缩状态
const toggleHeader = () => {
  headerCollapsed.value = !headerCollapsed.value
}

// 切换检测状态
const toggleVAD = async () => {
  if (loading.value || starting.value || !vad.value || initError.value) return;
  if (listening.value) {
    await vad.value.pause()
    voiceService.value?.reset();
    closeVoicePlayThread();
    listening.value = false
    statusText.value = '已停止'
    indicatorColor.value = '#cccccc'
    modelThinkingUUIDList.value = [];
  } else {
    starting.value = true;
    try {
      voiceService.value.speaker.configureInterruption(interruptionSettings.value);
      voiceService.value.configureVolumeFilter(volumeFilterSettings.value);
      await vad.value.start();
    } catch (err) {
      initError.value = true;
      statusText.value = '语音启动失败，请检查麦克风权限后重新加载';
      voiceLog('vad.start_failed', { errorType: err?.name }, 'error');
      return;
    } finally {
      starting.value = false;
    }
    if (initialization.signal.aborted) return;
    VoicePlayThread();
    listening.value = true;
    statusText.value = '正在检测...';
    
    ///开场白展示及播报
    if (instance.appContext.config.globalProperties.$isOpeningRemarks == 'true') {
      const openUUID = instance.appContext.config.globalProperties.$uuid();
      const voiceText = new VoiceText(
          dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss'),
          openUUID, '', 0);
      voiceText.addVoiceAnswer(instance.appContext.config.globalProperties.$openingRemarks,false);
      voiceService.value.speaker.beginOpening();
      audioService.value.AddSendContentToAudio(openUUID, voiceText.answerText, false);
      voiceTexts.value.push(voiceText);
    }
  }
}

// 初始化VAD
const initVAD = async () => {
  try {
    loading.value = true;

    soundEncode.value = instance.appContext.config.globalProperties.$audioEncodeMobile;

    ///初始化声音处理服务
    if(!audioContext.value)
      audioContext.value = new (window.AudioContext || (window as any).webkitAudioContext)();

    voiceService.value = new VoiceService(...toVoiceServiceParams(NOISY_VAD_PARAMETERS),
      instance, showVociceText, null, inputVolume, {
        isReplyActive: () => playSoundStatus.value || Boolean(audioObj.value) || audioSounds.value.length > 0 ||
          modelThinkingUUIDList.value.length > 0 || audioService.value?.audioTexts.length > 0 ||
          audioService.value?.webSockets.length > 0,
      });
    audioService.value = new AudioService(textToTTSCallBack, soundEncode.value, textToTTSFailure);
    
    // 创建VAD实例
    vad.value = await createVoiceDetector({
      audioContext: audioContext.value,
      getStream: async () => {
        const stream = await acquireMicStream();
        setMicEnabled(stream, true);
        return stream;
      },
      pauseStream: async (stream: MediaStream) => {
        setMicEnabled(stream, false);
        vadDebugLog('pause stream (tracks disabled)');
      },
      resumeStream: async (stream: MediaStream) => {
        if (isLiveStream(stream)) {
          micStreamRef.value = stream;
          setMicEnabled(stream, true);
          vadDebugLog('resume stream with provided live stream');
          return stream;
        }

        if (isLiveStream(micStreamRef.value)) {
          setMicEnabled(micStreamRef.value, true);
          vadDebugLog('resume stream with cached live stream');
          return micStreamRef.value;
        }

        vadDebugLog('stream invalid, requesting replacement stream');
        const newStream = await acquireMicStream();
        setMicEnabled(newStream, true);
        return newStream;
      },
      processorType : 'auto',
      // 帧处理回调 - 实时更新状态
      onFrameProcessed: (probs, frame) => {
        if (initialization.signal.aborted) return;
        if(loading.value) return;
        //16000每帧32ms音频
        voiceService.value.voiceTranslate(probs, frame);
      },
      onVADMisfire: () => {},
      onSpeechStart: () => {},
      onSpeechEnd: (audio: Float32Array) => {},
      onSpeechRealStart: () => {},
    }, initialization.signal);
    
    statusText.value = '语音引擎已就绪';
    loading.value = false
  } catch (err) {
    if (initialization.signal.aborted) return;
    loading.value = false
    initError.value = true;
    statusText.value = '语音引擎加载失败，请检查网络后重新加载';
    voiceLog('vad.init_failed', { errorType: err?.name }, 'error');
  }
}

/**
 * 展示翻译内容
 */
const showVociceText = async (uuid:string,data:string) => {
  if (!voiceService.value.speaker.has(uuid)) return;
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
    voiceLog('asr.failed', { utteranceId: uuid, code: res.code }, 'error');
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
    if (voiceService.value.speaker.authorizeText(uuid, str)) {
      breakUUID.value = uuid;
      breakFlag.value = true;
      await breakSuccess(uuid);
    }
  } else {
    voiceTexts.value.splice(index,1);
  }

  // res.data.status ==2 说明数据全部返回完毕，可以关闭连接，释放资源
  if (res.data.status == 2) {
    voiceLog('asr.final', { utteranceId: uuid, characters: (str.match(/[\p{L}\p{N}]/gu) || []).length });
    closeWebSocket(voiceService.value,uuid);
    iatResults.value.splice(indexIatResult,1);

    if (switchValue.value && str && str.trim() && voiceService.value.speaker.shouldAnswer(uuid)) {
      translateToOtherLanguage(uuid);
    }
    voiceService.value.speaker.finish(uuid);
    if (breakUUID.value === uuid) {
      breakUUID.value = '';
      breakFlag.value = false;
    }
  }
}

/**
 * 调用大模型进行文本翻译
 */
const translateToOtherLanguage = async (uuid) => {
  voiceService.value.speaker.activateQuestion(uuid);
  const system = instance.appContext.config.globalProperties.$llmPrompt;
  const aiAgent = new AiAgentService(uuid);
  aiAgents.value.push(aiAgent);

  const index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  if (index > -1) {
    markModelThinking(uuid);

    const beContext = [];
    if (numContent.value > 1 && index > 1) {
      let iNum=index-numContent.value+1>-1?index-numContent.value+1:0;
      for(;iNum<index;iNum++) {
        beContext.push({"role": "user", "content":voiceTexts.value[iNum].voiceText});
        beContext.push({"role": "assistant","partial": false,"content": voiceTexts.value[iNum].answerText});
      }
    }

    aiAgent.sendQuestion(uuid, "qwen3.8-flash", system, 
      voiceTexts.value[index].voiceText, 
      voiceTexts.value[index].targetLang,
      translateCallBack,
      {
        enable_thinking:false,
        temperature:0,
        enable_search:true,
        beContext:beContext
      }).catch((err) => {
        clearModelThinking(uuid);
        voiceLog('llm.failed', { utteranceId: uuid, errorType: err?.name }, 'error');
      });
  } else {
    voiceLog('llm.record_missing', { utteranceId: uuid }, 'error');
  }
}

/**
 * 文本翻译回调函数
 */
const translateCallBack = async (uuid, content, isAnswer) => {
  const hasModelContent = content !== undefined && content !== null && content !== '';
  if (hasModelContent || !isAnswer) {
    clearModelThinking(uuid);
  }

  let indexBreak = breakModelUUIDList.value.findIndex(item => item == uuid);
  if(indexBreak > -1) {
    return;
  } else if (breakUUID.value && breakFlag.value && breakUUID.value != uuid) {
    breakModelUUIDList.value.push(uuid);
    isAnswer = false;
  }

  const index = voiceTexts.value.findIndex(voiceText => voiceText.isMine(uuid));
  if (index > -1) {
    audioService.value.AddSendContentToAudio(uuid, content, isAnswer);
    voiceTexts.value[index].addVoiceAnswer(content, isAnswer);
  } else {
    voiceLog('llm.record_missing', { utteranceId: uuid }, 'error');
  }
}

// Keep a lightweight failed-segment marker so ordered playback can advance.
const textToTTSFailure = (uuid, reason) => {
  if (breakSoundUUIDList.value.includes(uuid.substring(0, 36))) return;
  const index = audioSounds.value.findIndex(sound => sound.isMine(uuid));
  const failed = new AudioSound(uuid, audioContext.value, { encoding: soundEncode.value });
  failed.failed = true;
  if (index >= 0) audioSounds.value.splice(index, 1, failed);
  else audioSounds.value.push(failed);
  voiceLog('playback.segment_discard', { utteranceId: uuid, stage: 'TTS', reason }, 'warn');
};

/**
 * 文本转语音的回调函数
 */
const textToTTSCallBack = async (uuid, data) => {
  const res = JSON.parse(data);
  if (res.code != 0) {
    voiceLog('tts.failed', { utteranceId: uuid, code: res.code }, 'error');
    closeWebSocket(audioService.value,uuid);
    return;
  }

  let uuidOrg = uuid.substring(0,36);
  let indexBreak = breakSoundUUIDList.value.findIndex(item => item == uuidOrg);
  if(indexBreak > -1) {
    closeWebSocket(audioService.value,uuid);
    return;
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
    if(playSoundStatus.value || audioObj.value) return;

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
    if(audioContext.value.state === 'suspended') {
      audioContext.value.resume();
    }

    /// 续播及新播逻辑，未查到数据直接返回
    playPauseSound.value = GetVoicePlay();
    if (!playPauseSound.value) {
      return;
    }

    if(playPauseSound.value.uuidFlag === 'true') {
      play_Num.value = 0;
      play_UUID.value = '';
    } else {
      play_Num.value = playPauseSound.value.uuidNum;
      play_UUID.value = playPauseSound.value.uuidOrg;
    }

    audioBufferSource.value = audioContext.value.createBufferSource();
    audioBufferSource.value.buffer = playPauseSound.value.SoundAll;
    audioBufferSource.value.connect(audioContext.value.destination);
    audioBufferSource.value.start(0);
    const playingId = playPauseSound.value.uuidOrg;
    voiceLog('playback.start', { utteranceId: playingId, stage: 'PCM' });
    playPause.value = 0;
    isContinue.value = false;
    playSoundStatus.value = true;
    breakFlag.value = false;

    // 播放结束后释放临时 URL（优化性能）
    audioBufferSource.value.onended = () => {
      voiceLog('playback.end', { utteranceId: playingId, stage: 'PCM' });
      //console.log('-'.repeat(10) + audioContext.value.state + '-'.repeat(10))
      if(audioBufferSource.value)
        audioBufferSource.value.disconnect();
      audioBufferSource.value = null;
      playSoundStatus.value = false;
    };
  } catch (err) {
    voiceLog('playback.failed', { errorType: err?.name }, 'error');
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
 * MP3播放器 - 兼容微信浏览器
 */
const mp3Player = () => {
  try {
    if(!isContinue.value) {
      playPauseSound.value = GetVoicePlay();
      if(playPauseSound.value) {
        if(playPauseSound.value.SoundAll instanceof Blob) {
          audioUrl.value = (webkitURL||window.URL).createObjectURL(playPauseSound.value.SoundAll)
          audioObj.value = new Audio(audioUrl.value);
          const loadingAudio = audioObj.value;
          const loadingUrl = audioUrl.value;
          loadingAudio.onerror = () => {
            if (audioObj.value !== loadingAudio) return;
            audioObj.value = null;
            URL.revokeObjectURL(loadingUrl);
            audioUrl.value = null;
            playSoundStatus.value = false;
          };

          // 微信浏览器兼容性处理
          let audioLoaded = false;
          let canPlayTriggered = false;

          const onLoaded = () => {
            audioLoaded = true;
            attemptPlay();
          };

          const onCanPlay = () => {
            canPlayTriggered = true;
            attemptPlay();
          };

          const attemptPlay = () => {
            if (audioObj.value !== loadingAudio) return;
            if (audioLoaded && canPlayTriggered && !playSoundStatus.value) {
              // 移除事件监听器避免重复触发
              audioObj.value.removeEventListener('loadeddata', onLoaded);
              audioObj.value.removeEventListener('canplaythrough', onCanPlay);

              // 微信浏览器可能需要微小延迟
              setTimeout(() => {
                if (audioObj.value === loadingAudio) mp3Play();
              }, 50);
            }
          };

          // 添加多个加载事件监听
          audioObj.value.addEventListener('loadeddata', onLoaded, { once: true });
          audioObj.value.addEventListener('canplaythrough', onCanPlay, { once: true });

          // 设置预加载
          audioObj.value.preload = 'auto';
          audioObj.value.load();
        } else {
          voiceLog('playback.invalid_audio', { reason: 'not_blob' }, 'error');
        }
      } else {
        return;
      }
    } else {
      isContinue.value = false;
      if (!audioObj.value) {
        voiceLog('playback.resume_failed', { reason: 'missing_audio_element' }, 'warn');
        return;
      }
      playSoundStatus.value = true;
      mp3Play();
    }
  } catch(err) {
    voiceLog('playback.failed', { errorType: err?.name }, 'error');
    audioObj.value = null;
    (webkitURL||window.URL).revokeObjectURL(audioUrl.value);
    audioUrl.value = null;
    playSoundStatus.value = false;
    if (!play_UUID.value) {
      play_Num.value++;
    }
  }
}

/**
 * 解决微信浏览器下第一次播放失败的问题
 */
const mp3Play = () => {
  const playingAudio = audioObj.value;
  const playingUrl = audioUrl.value;
  const playingId = playPauseSound.value.uuidOrg;
  if (!playingAudio) return;

  const releasePlayingAudio = () => {
    if (audioObj.value !== playingAudio) return;
    audioObj.value = null;
    (webkitURL||window.URL).revokeObjectURL(playingUrl);
    audioUrl.value = null;
    playSoundStatus.value = false;
  };

  playingAudio.onended = () => {
    if (audioObj.value === playingAudio) voiceLog('playback.end', { utteranceId: playingId, stage: 'MP3' });
    releasePlayingAudio();
  };
  playingAudio.onerror = releasePlayingAudio;

  const playAudio = () => {
    if (audioObj.value !== playingAudio) return;

    const playPromise = playingAudio.play();

    if (playPromise !== undefined) {
      playPromise.then(() => {
        if (audioObj.value === playingAudio) voiceLog('playback.start', { utteranceId: playingId, stage: 'MP3' });
      }).catch((error: any) => {
        if (audioObj.value !== playingAudio) return;
        voiceLog('playback.retry', { errorType: error?.name }, 'warn');

        // 微信浏览器常见错误：播放被阻止，尝试重新加载
        if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
          // 延迟后重试
          setTimeout(() => {
            if (audioObj.value === playingAudio) {
              playingAudio.load();
              playingAudio.play().catch((retryError: any) => {
                if (audioObj.value !== playingAudio) return;
                voiceLog('playback.retry_failed', { errorType: retryError?.name }, 'error');
                releasePlayingAudio();
              });
            }
          }, 100);
        } else {
          releasePlayingAudio();
        }
      });
    }
  };

  play_Num.value = playPauseSound.value.uuidNum;
  play_UUID.value = playPauseSound.value.uuidOrg;
  breakUUID.value = '';
  breakFlag.value = false;
  if(playPauseSound.value.uuidFlag === 'true') {
    play_Num.value = 0;
    play_UUID.value = '';
  }

  playSoundStatus.value = true;

  // 确保音频有足够时间缓冲
  if (audioObj.value.readyState >= 2) { // HAVE_CURRENT_DATA
    playAudio();
  } else {
    // 等待音频加载完成
    const onCanPlay = () => {
      playingAudio.removeEventListener('canplay', onCanPlay);
      if (audioObj.value !== playingAudio) return;
      setTimeout(playAudio, 50); // 微信浏览器可能需要微小延迟
    };
    audioObj.value.addEventListener('canplay', onCanPlay);
  }
}

/**
 * 获取应该播放的
 */
const GetVoicePlay = ():AudioSound => {
  while (audioSounds.value.length > 0) {
    const index = audioSounds.value.findIndex(sound => play_UUID.value === ''
      ? sound.uuidNum === 1
      : sound.uuidOrg === play_UUID.value && sound.uuidNum === play_Num.value + 1);
    if (index < 0) return null;
    const sound = audioSounds.value[index];
    if (sound.failed) {
      audioSounds.value.splice(index, 1);
      play_UUID.value = sound.uuidFlag === 'true' ? '' : sound.uuidOrg;
      play_Num.value = sound.uuidFlag === 'true' ? 0 : sound.uuidNum;
      continue;
    }
    return sound.SoundAll ? audioSounds.value.splice(index, 1)[0] : null;
  }
  return null;
}

/**
 * 声音停止播放方法
 */
const closeVoicePlayThread = () => {
  // Also retire pending model/TTS work so restart cannot resurrect an old reply.
  void breakSuccess('');
  breakUUID.value = '';
  breakFlag.value = false;
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
 * 成功打断
 */
const breakSuccess = async (uuid) => {
  voiceLog('playback.stop', { utteranceId: uuid, reason: uuid ? 'new_question' : 'capture_stopped' });
  // Stop only after speaker and text authorization. Candidate audio never pauses playback.
  const oldIds = new Set<string>([
    ...aiAgents.value.filter(agent => !agent.isMine(uuid)).map(agent => agent.uuid),
    ...audioSounds.value.map(sound => sound.uuidOrg),
    playPauseSound.value?.uuidOrg,
    ...(audioService.value?.audioTexts || []).map(text => text.uuid),
    ...(audioService.value?.webSockets || []).map(socket => socket.websocketid.substring(0, 36)),
  ].filter(id => id && id !== uuid));
  for (const id of oldIds) {
    if (!breakModelUUIDList.value.includes(id)) breakModelUUIDList.value.push(id);
    if (!breakSoundUUIDList.value.includes(id)) breakSoundUUIDList.value.push(id);
    audioService.value?.cancel(id);
  }
  if (audioBufferSource.value) {
    const source = audioBufferSource.value;
    audioBufferSource.value = null;
    source.onended = null;
    source.stop();
    source.disconnect();
  }
  playSoundStatus.value = false;
  isContinue.value = false;
  if (soundEncode.value == 'MP3') {
    if(audioObj.value) {
      const stoppedAudio = audioObj.value;
      audioObj.value = null;
      stoppedAudio.onended = null;
      stoppedAudio.currentTime = 0;
      stoppedAudio.src = '';
      stoppedAudio.load();
      URL.revokeObjectURL(audioUrl.value);
      audioUrl.value = null;
    }
    playSoundStatus.value = false;
    isContinue.value = false;
  }
  //console.log('-'.repeat(10) + 'breakSuccess被调用' + '-'.repeat(10))

  play_Num.value = 0;
  play_UUID.value = '';
  clearInterruptedThinking(uuid);
  
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
  initialization.abort();
  voiceService.value?.reset();
  closeVoicePlayThread();
  try {
    await vad.value?.destroy();
  } finally {
    await releaseMicStream();
    const context = audioContext.value;
    audioContext.value = null;
    audioObj.value?.pause();
    if (context && context.state !== 'closed') await context.close();
  }
})
</script>

<style scoped src="./HelloWorld_Mobile.css"></style>
