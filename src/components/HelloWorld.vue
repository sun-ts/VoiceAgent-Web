<template>
  <el-container class="main-container">
    <el-header class="main-header">
      <div class="header-title">
        <h4>实时语音检测并用模型联网搜索回答</h4>
        <p class="header-subtitle">支持语音打断、联网检索与多模型回答</p>
      </div>
      <div class="header-actions">
        <el-tag class="header-tag" size="small" :type="listening ? 'success' : 'info'">
          {{ listening ? '检测中' : '待开始' }}
        </el-tag>
        <el-tag class="header-tag" size="small" effect="plain">
          会话 {{ voiceTexts.length }}
        </el-tag>
        <el-button
          @click="toggleVAD"
          :disabled="loading || starting || !vad || initError"
          :type="listening ? 'danger' : 'success'"
          class="toggle-button"
        >
          {{ loading ? '语音引擎准备中…' : listening ? '停止检测' : '开始检测' }}
        </el-button>
        <el-button v-if="initError" @click="reloadVoicePage">重新加载</el-button>
        <button class="logout-neon-button" type="button" @click="emit('logout')" aria-label="退出登录">
          <span class="logout-dot" aria-hidden="true"></span>
          退出登录
        </button>
      </div>
    </el-header>
    <el-container class="content-container">
      <el-aside width="420px" class="config-aside">
        <div class="config-card">
          <div class="card-header">VAD参数配置</div>
          <el-form
            label-position="top"
            size="small"
            class="vad-params-form"
          >
            <el-form-item label="使用环境">
              <el-select v-model="selectedEnvironment" :disabled="listening || starting" aria-label="使用环境">
                <el-option v-for="environment in VAD_ENVIRONMENTS" :key="environment.value"
                  :label="environment.label" :value="environment.value" />
                <el-option label="自定义" value="custom" disabled />
              </el-select>
            </el-form-item>
            <p class="vad-environment-hint">{{ environmentDescription }}</p>
            <p class="vad-environment-hint">可手动微调，点击开始检测后生效；切换环境会覆盖当前参数。</p>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="人声阀值" prop="pThreshold">
                  <el-input-number
                    v-model="pThreshold"
                    :min="nThreshold"
                    :max="0.9"
                    :step="0.05"
                    :disabled="listening || starting"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="静音阀值" prop="nThreshold">
                  <el-input-number
                    v-model="nThreshold"
                    :min="0.1"
                    :max="pThreshold"
                    :step="0.05"
                    :disabled="listening || starting"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="连续声音 (ms)" prop="preFrame">
                  <el-input-number
                    v-model="preFrame"
                    :min="0"
                    :max="1000"
                    :step="10"
                    :disabled="listening || starting"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="声音缓存 (ms)" prop="cacheFrame">
                  <el-input-number
                    v-model="cacheFrame"
                    :min="0"
                    :max="500"
                    :step="10"
                    :disabled="listening || starting"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="24">
                <el-form-item label="静音时长 (ms)" prop="silenceFrame">
                  <el-input-number
                    v-model="silenceFrame"
                    :min="500"
                    :max="2000"
                    :step="10"
                    :disabled="listening || starting"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>
        </div>

        <div class="config-card">
          <div class="card-header">大模型配置</div>
          <el-form label-position="top" size="small" class="model-config-form">
            <el-row :gutter="16">
              <el-col :span="12">          
                <el-form-item label="播报开场白" prop="isOpeningRemarks">
                  <el-switch
                    v-model="isOpeningRemarks"
                    inline-prompt
                    active-text="开启"
                    inactive-text="关闭"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">          
                <el-form-item label="大模型问答及语音播报" prop="switchValue">
                  <el-switch
                    v-model="switchValue"
                    inline-prompt
                    active-text="开启"
                    inactive-text="关闭"
                  />
                </el-form-item>
              </el-col>
            </el-row>

            <el-form-item label="提示词" prop="promptWord" v-if="switchValue">
              <el-input
                v-model="promptWord"
                type="textarea"
                :rows="4"
                resize="none"
                :disabled="!switchValue"
                placeholder="请输入系统提示词..."
              />
            </el-form-item>

            <el-form-item label="模型选择" prop="modelSelected" v-if="switchValue">
              <el-select
                v-model="modelSelected"
                :disabled="!switchValue"
                size="small"
                style="width: 100%"
              >
                <el-option value="qwen3.8-flash" label="千问3.8Flash" />
                <el-option value="qwen3.8-max-0902" label="千问3.8Max" />
              </el-select>
            </el-form-item>

            <el-row :gutter="16" v-if="switchValue">
              <el-col :span="12">
                <el-form-item label="关联上下文" prop="numContent">
                  <el-input-number
                    v-model="numContent"
                    :min="1"
                    :max="10"
                    :step="1"
                    :disabled="!switchValue"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="模型温度" prop="temperature">
                  <el-input-number
                    v-model="temperature"
                    :min="0"
                    :max="2"
                    :step="0.1"
                    :disabled="!switchValue"
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
            </el-row>

            <el-row :gutter="16" v-if="switchValue">
              <el-col :span="12">
                <el-form-item label="联网搜索" prop="linkWeb">
                  <el-switch
                    v-model="linkWeb"
                    inline-prompt
                    :disabled="!switchValue"
                    active-text="开启"
                    inactive-text="关闭"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="深度思考" prop="thinking">
                  <el-switch
                    v-model="thinking"
                    inline-prompt
                    :disabled="!switchValue"
                    active-text="开启"
                    inactive-text="关闭"
                  />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>
        </div>

        <div class="system-notice">
          <div class="notice-header">系统交互说明</div>
          <div class="notice-content">
            系统采用实时语音交互，操作人可直接与机器人对话并切换回答模型，对话过程可随时打断语音机器人回复，打断规则：新录入的语音字数大于5，如果小于5个字机器人会继续回复你的上一个问题。
          </div>
        </div>
      </el-aside>

      <el-main class="chat-main">
        <div class="status-area">
          <div v-if="loading" role="status" aria-live="polite">语音引擎准备中，请稍候…</div>
          <div class="status-head">
            <div class="status-head-left">
              <span class="status-dot" :class="{ active: listening }"></span>
              <span class="status-label">语音检测</span>
              <el-tag size="small" :type="listening ? 'success' : 'info'">
                {{ statusText }}
              </el-tag>
            </div>
            <div class="status-head-right">
              <el-tag size="small" effect="plain">
                {{ switchValue ? modelSelected : '仅语音识别' }}
              </el-tag>
              <el-tag size="small" effect="plain">
                联网搜索 {{ linkWeb && switchValue ? '开启' : '关闭' }}
              </el-tag>
            </div>
          </div>
          <div class="visualizer" :style="{ backgroundColor: indicatorColor }">
            <div class="visualizer-content">
              <span>输入音量状态:</span>
              <span class="status-text">{{ statusText }}</span>
            </div>
          </div>
        </div>

        <div class="chat-area">
          <div ref="scrollContainer" class="chat-container">
            <div v-if="voiceTexts.length === 0" class="chat-empty">
              <div class="chat-empty-title">对话区已就绪</div>
              <div class="chat-empty-desc">点击「开始检测」后直接说话，或输入文本并发送。</div>
            </div>
            <div class="chat-loop" v-for="(item, index) in voiceTexts" :key="index">
              <div class="message-row row-send" v-if="item.voiceText && item.voiceText.trim()!==''">
                <div class="chat-bubble chat-bubble-send">
                  <div class="message-role">你</div>
                  <div class="message-time">{{ item.time }}</div>
                  <div class="message-content">{{ formatMessageContent(item.voiceText) }}</div>
                </div>
                <div class="message-avatar avatar-user" aria-hidden="true">你</div>
              </div>
              <div class="message-row row-receive" v-if="hasAnswerContent(item) || isModelThinking(item.uuid)">
                <div class="message-avatar avatar-assistant" aria-hidden="true">AI</div>
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

          <div class="chat-input-area">
            <div class="chat-input-toolbar">
              <div class="input-tips">
                {{ listening ? '快捷键：Command/Ctrl + Enter 发送' : '请先点击“开始检测”启用输入' }}
              </div>
              <el-button
                class="send-button"
                type="primary"
                :disabled="!canSend"
                @click="submitUserInput"
              >
                发送
              </el-button>
            </div>
            <el-input
              v-model="userInput"
              type="textarea"
              @keydown="handleKeyDown"
              :disabled="!listening"
              clearable
              resize="none"
              :rows="3"
              :placeholder="listening ? '输入文本后按 Command/Ctrl+Enter 发送' : '请先点击开始检测'"
              class="chat-input"
            />
          </div>
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, reactive, toRefs, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
// 图标导入 - 如果项目已安装@element-plus/icons-vue则取消注释
// import { VideoPlay, VideoPause, Loading } from '@element-plus/icons-vue'
/// VAD和ONNX运行时
import { createVoiceDetector } from '../utils/Services/VoiceRuntime.js'
import { VAD_ENVIRONMENTS, OFFICE_VAD_PARAMETERS, toVoiceServiceParams } from '../utils/Services/VadEnvironments.js'

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

const emit = defineEmits(['logout']);

/// 滚动容器引用
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
const statusText = ref('语音引擎准备中…')
const initialization = new AbortController();
const reloadVoicePage = () => window.location.reload();

/// 对话数据存储变量
const voiceTexts = ref<VoiceText[]>([])
const iatResults = ref<IatResult[]>([])
const indicatorColor = ref('#cccccc')

///页面控制控件
const switchValue = ref(true)
const isOpeningRemarks = ref(true);
const isDisabled = ref(false)
const promptWord = ref('');
const modelSelected = ref('qwen3.8-flash');
const numContent = ref(1);
const linkWeb = ref(true);
const temperature = ref(0);
const thinking = ref(false)
const thinkingToken = ref(1)
const userInput = ref('');
const selectedValue = ref('英语:')
const canSend = computed(() => listening.value && userInput.value.trim() !== '')
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

/// VAD参数
const vadParameters = reactive({ ...OFFICE_VAD_PARAMETERS });
const { pThreshold, nThreshold, preFrame, silenceFrame, cacheFrame } = toRefs(vadParameters);
const selectedEnvironment = computed({
  get: () => VAD_ENVIRONMENTS.find(environment =>
    Object.entries(environment.parameters).every(([key, value]) => vadParameters[key] === value)
  )?.value ?? 'custom',
  set: (value: string) => {
    if (listening.value || starting.value) return;
    const environment = VAD_ENVIRONMENTS.find(item => item.value === value);
    if (environment) Object.assign(vadParameters, environment.parameters);
  },
});
const environmentDescription = computed(() =>
  VAD_ENVIRONMENTS.find(item => item.value === selectedEnvironment.value)?.description
    ?? '当前使用手动调整的参数。选择环境可恢复对应预设。'
);

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

// 切换检测状态
const toggleVAD = async () => {
  if (loading.value || starting.value || !vad.value || initError.value) return;
  if (listening.value) {
    await vad.value.pause()
    closeVoicePlayThread();
    listening.value = false
    statusText.value = '已停止'
    indicatorColor.value = '#cccccc'
    modelThinkingUUIDList.value = [];
  } else {
    starting.value = true;
    try {
      // Apply before start(): the first audio frame must use the selected profile.
      voiceService.value.setVadParam(...toVoiceServiceParams(vadParameters));
      await vad.value.start();
    } catch (err) {
      initError.value = true;
      statusText.value = '语音启动失败，请检查麦克风权限后重新加载';
      console.error('VAD启动错误:', err);
      return;
    } finally {
      starting.value = false;
    }
    if (initialization.signal.aborted) return;
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
 *  页面初始化VAD+基础元素
 */
const initVAD = async () => {
  try {
    loading.value = true;
    
    promptWord.value = instance.appContext.config.globalProperties.$llmPrompt;
    isOpeningRemarks.value = instance.appContext.config.globalProperties.$isOpeningRemarks == 'true';
    soundEncode.value = instance.appContext.config.globalProperties.$audioEncodeWeb;

    ///初始化声音处理服务
    if(!audioContext.value)
      await (audioContext.value = new (window.AudioContext || (window as any).webkitAudioContext)());

    /// 初始化声音检测类
    voiceService.value = new VoiceService(...toVoiceServiceParams(vadParameters),
      instance, showVociceText, breakAnswer, inputVolume);
    audioService.value = new AudioService(textToTTSCallBack, soundEncode.value);
    
    // 创建VAD实例
    vad.value = await createVoiceDetector({
      processorType : 'auto',
      // 帧处理回调 - 实时更新状态
      onFrameProcessed: (probs, frame) => {
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
    console.error('VAD初始化错误:', err)
  }
}

/**
 * 输入数据直接进行打断处理
 */
const submitUserInput = () => {
  if (!canSend.value) {
    return;
  }

  const uuid = instance.appContext.config.globalProperties.$uuid();

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
      breakUUID.value = '';
    });
}

const handleKeyDown = (e) => {
  // 处理回车键逻辑 判断：Mac(metaKey=Command) 或 Windows(ctrlKey=Ctrl) + Enter(keyCode=13)
  if ((e.metaKey || e.ctrlKey) && e.keyCode === 13) {
    e.preventDefault();
    submitUserInput();
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
    markModelThinking(uuid);

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
      }).catch((err) => {
        clearModelThinking(uuid);
        console.error('大模型请求失败:', err);
      });
  } else {
    console.error("-".repeat(10) + "语音翻译查找待识别文本时失败！" + "-".repeat(10));
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
  //console.log('TTS返回数据:'+data)
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
        if(playPauseSound.value.SoundAll instanceof Blob) {
          audioUrl.value = (webkitURL||window.URL).createObjectURL(playPauseSound.value.SoundAll)
          audioObj.value = new Audio(audioUrl.value);
          audioObj.value.load();
        } else {
          console.log('-'.repeat(10) + '音频数据格式错误，非Blob格式!' + '-'.repeat(10));
        }
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
    /// 播放结束后释放临时 URL（优化性能）
    audioObj.value.onended = () => {
      audioObj.value = null;
      (webkitURL||window.URL).revokeObjectURL(audioUrl.value);
      audioUrl.value = null;
      playSoundStatus.value = false;
    };

    /// 播放音频数据
    audioObj.value.play().catch(err => {
        console.error('-'.repeat(10) + '播放失败：' + '-'.repeat(10), err);
        audioObj.value = null;
        (webkitURL||window.URL).revokeObjectURL(audioUrl.value);
        audioUrl.value = null;
        playSoundStatus.value = false;
      });
    playSoundStatus.value = true;

    /// 播放结束后启动下一节播放
    if(playPauseSound.value.uuidFlag === 'true') {
      play_Num.value = 0;
      play_UUID.value = '';
    } else {
      /// 当前播放音频段落信息
      play_Num.value = playPauseSound.value.uuidNum;
      play_UUID.value = playPauseSound.value.uuidOrg;
    }
    
    breakUUID.value = '';
    breakFlag.value = false;
  } catch(err) {
    /// 播放失败处理
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
    if(audioObj.value && playSoundStatus.value) {
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
  clearInterruptedThinking(uuid);
  
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
  initialization.abort();
  try {
    await vad.value?.destroy();
  } finally {
    // This playback context belongs to the page, not the VAD instance.
    const context = audioContext.value;
    audioContext.value = null;
    audioObj.value?.pause();
    if (context && context.state !== 'closed') await context.close();
  }
})
</script>

<style scoped src="./HelloWorld.css"></style>
