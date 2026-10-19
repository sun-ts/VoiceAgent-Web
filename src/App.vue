<script setup>
import { defineAsyncComponent, getCurrentInstance, ref, onMounted } from 'vue';
import LoginPortal from './components/LoginPortal.vue';
import VoicePageStatus from './components/VoicePageStatus.vue';

const app = getCurrentInstance().appContext.app;
let voiceUIPromise;
const loadVoiceUI = () => {
  if (!voiceUIPromise) {
    voiceUIPromise = Promise.all([
      import('element-plus'),
      import('element-plus/dist/index.css'),
    ]).then(([{ default: ElementPlus }]) => {
      app.use(ElementPlus);
    }).catch((error) => {
      voiceUIPromise = undefined;
      throw error;
    });
  }
  return voiceUIPromise;
};

const voicePage = (loader) => defineAsyncComponent({
  loader: async () => {
    const [, page] = await Promise.all([loadVoiceUI(), loader()]);
    return page.default;
  },
  loadingComponent: VoicePageStatus,
  errorComponent: VoicePageStatus,
  delay: 0,
});
const HelloWorld = voicePage(() => import('./components/HelloWorld.vue'));
const HelloWorld_Mobile = voicePage(() => import('./components/HelloWorld_Mobile.vue'));

const is_Mobile = ref(null);

const is_wx = ref(null);
const isAuthed = ref(false);
const loginError = ref('');
const loggingIn = ref(false);

const sessionKey = 'voice-client-login';
const loginUsername = import.meta.env.VITE_LOGIN_USERNAME;
const loginPassword = import.meta.env.VITE_LOGIN_PASSWORD;

// 判断是否为手机端
const isMobile = () => {
  // 匹配常见的手机设备关键字（iOS/Android 等）
  const mobileKeywords = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|Android/i;
  // 匹配桌面端关键字
  const desktopKeywords = /Windows|Macintosh|Linux|Chrome|Firefox|Safari/i;

  const userAgent = navigator.userAgent || window.opera || navigator.vendor;

  is_wx.value = /MicroMessenger/i.test(navigator.userAgent);
  
  // 优先判断是否为手机端，避免桌面端浏览器模拟手机端的误判
  if (mobileKeywords.test(userAgent)) {
    return true;
  } else if (desktopKeywords.test(userAgent) && !mobileKeywords.test(userAgent)) {
    return false;
  }
  // 兜底判断（默认非手机端）
  return false;
}

onMounted(() => {
  is_Mobile.value = isMobile();
  const hasCredentials = !!loginUsername && !!loginPassword;

  if (!hasCredentials) {
    loginError.value = '未配置登录账号，请先在 .env 设置账号密码。';
    return;
  }

  isAuthed.value = sessionStorage.getItem(sessionKey) === '1';
});

const handleLogin = ({ username, password }) => {
  if (!loginUsername || !loginPassword) {
    loginError.value = '未配置登录账号，请先在 .env 设置账号密码。';
    return;
  }

  loggingIn.value = true;

  if (username === loginUsername && password === loginPassword) {
    isAuthed.value = true;
    loginError.value = '';
    sessionStorage.setItem(sessionKey, '1');
  } else {
    loginError.value = '用户名或密码错误，请重试。';
    sessionStorage.removeItem(sessionKey);
  }

  loggingIn.value = false;
};

const handleLogout = () => {
  isAuthed.value = false;
  loginError.value = '';
  sessionStorage.removeItem(sessionKey);
};

const currentYear = new Date().getFullYear();
const copyrightText = `Copyright © ${currentYear} 闪码科技（云南）`;
</script>

<template>
  <div class="app-shell">
    <main class="app-content">
      <div v-if="is_Mobile === null" class="app-loading">识别终端中...</div>
      <LoginPortal
        v-else-if="!isAuthed"
        :is-mobile="is_Mobile"
        :error-message="loginError"
        :disabled="loggingIn"
        @submit="handleLogin"
      />
      <HelloWorld v-else-if="is_Mobile === false" msg="Vite + Vue" @logout="handleLogout" />
      <HelloWorld_Mobile v-else :is_wx="is_wx" msg="Vite + Vue" @logout="handleLogout" />
    </main>
    <footer class="app-copyright">
      <a
        class="copyright-link"
        href="https://dancecoder.cn"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ copyrightText }}
      </a>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.app-content {
  min-height: 0;
  overflow: auto;
}

.app-loading {
  min-height: 100%;
  display: grid;
  place-items: center;
  font-size: 18px;
  color: #d7e8ff;
  letter-spacing: 1px;
}

.app-copyright {
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
  text-align: center;
  font-size: 12px;
  color: rgba(236, 242, 255, 0.8);
  letter-spacing: 0.4px;
  pointer-events: auto;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}

.copyright-link {
  color: inherit;
  text-decoration: none;
}

.copyright-link:hover {
  text-decoration: underline;
}
</style>
