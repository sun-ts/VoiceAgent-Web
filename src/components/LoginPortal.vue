<template>
  <div class="login-shell" :class="{ mobile: isMobile }">
    <div class="bg-layer">
      <span class="orb orb-a"></span>
      <span class="orb orb-b"></span>
      <span class="orb orb-c"></span>
      <span class="grid"></span>
    </div>

    <section class="login-card" :class="{ mobile: isMobile }">
      <header class="card-header">
        <p class="badge">VOICE CLIENT ACCESS</p>
        <h1>语音交互系统登录</h1>
        <p class="subtitle">实时语音助手控制台</p>
      </header>

      <form class="login-form" @submit.prevent="handleSubmit">
        <label class="field">
          <span>用户名</span>
          <input
            v-model="username"
            autocomplete="username"
            type="text"
            placeholder="请输入用户名"
            :disabled="disabled"
          />
        </label>

        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            autocomplete="current-password"
            type="password"
            placeholder="请输入密码"
            :disabled="disabled"
          />
        </label>

        <div class="captcha-row">
          <label class="field captcha-field">
            <span>验证码</span>
            <input
              v-model="captchaInput"
              autocomplete="off"
              type="text"
              placeholder="请输入验证码"
              :disabled="disabled"
              maxlength="4"
            />
          </label>
          <button
            class="captcha-box"
            type="button"
            :disabled="disabled"
            title="点击刷新验证码"
            @click="refreshCaptcha"
          >
            <span
              v-for="(item, index) in captchaGlyphs"
              :key="`${item.char}-${index}`"
              class="captcha-char"
              :style="{
                transform: `translateY(${item.offsetY}px) rotate(${item.rotate}deg)`
              }"
            >
              {{ item.char }}
            </span>
            <span class="captcha-refresh">换一张</span>
          </button>
        </div>

        <p class="captcha-tip">看不清？点击右侧验证码刷新</p>
        <p v-if="displayError" class="error-text">{{ displayError }}</p>

        <button class="login-button" type="submit" :disabled="disabled">
          {{ disabled ? '登录中...' : '进入控制台' }}
        </button>
      </form>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  isMobile: {
    type: Boolean,
    default: false
  },
  errorMessage: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['submit']);

const isMobile = computed(() => props.isMobile);
const errorMessage = computed(() => props.errorMessage);
const disabled = computed(() => props.disabled);

const username = ref('');
const password = ref('');
const captchaInput = ref('');
const localError = ref('');
const captchaText = ref('');
const captchaGlyphs = ref([]);

const displayError = computed(() => localError.value || errorMessage.value);

const buildCaptcha = () => {
  const seed = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  const glyphs = [];

  for (let i = 0; i < 4; i += 1) {
    const char = seed[Math.floor(Math.random() * seed.length)];
    text += char;
    glyphs.push({
      char,
      rotate: Math.floor(Math.random() * 36) - 18,
      offsetY: Math.floor(Math.random() * 8) - 4
    });
  }

  captchaText.value = text;
  captchaGlyphs.value = glyphs;
};

const refreshCaptcha = () => {
  captchaInput.value = '';
  localError.value = '';
  buildCaptcha();
};

const handleSubmit = () => {
  localError.value = '';

  if (!username.value.trim() || !password.value) {
    localError.value = '请先输入用户名和密码。';
    return;
  }

  if (!captchaInput.value.trim()) {
    localError.value = '请输入验证码。';
    return;
  }

  if (captchaInput.value.trim().toUpperCase() !== captchaText.value) {
    localError.value = '验证码错误，请重试。';
    refreshCaptcha();
    return;
  }

  emit('submit', {
    username: username.value.trim(),
    password: password.value
  });
};

watch([username, password, captchaInput], () => {
  localError.value = '';
});

buildCaptcha();
</script>

<style scoped>
.login-shell {
  position: relative;
  min-height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: #040f1f;
  font-family: "Rajdhani", "DIN Alternate", "Avenir Next", "PingFang SC", sans-serif;
}

.login-shell.mobile {
  padding: 18px;
}

.bg-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.orb {
  position: absolute;
  border-radius: 50%;
  opacity: 0.72;
}

.orb-a {
  width: 460px;
  height: 460px;
  top: -140px;
  left: -60px;
  background: radial-gradient(circle, rgba(17, 217, 255, 0.55), rgba(17, 217, 255, 0));
}

.orb-b {
  width: 480px;
  height: 480px;
  right: -140px;
  bottom: -180px;
  background: radial-gradient(circle, rgba(45, 127, 255, 0.55), rgba(45, 127, 255, 0));
}

.orb-c {
  width: 320px;
  height: 320px;
  right: 36%;
  top: 56%;
  background: radial-gradient(circle, rgba(255, 138, 61, 0.45), rgba(255, 138, 61, 0));
}

.grid {
  position: absolute;
  inset: -40%;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 52px 52px;
  transform: perspective(550px) rotateX(58deg);
  transform-origin: center;
}

.login-card {
  position: relative;
  width: min(480px, 100%);
  padding: 34px;
  border-radius: 26px;
  border: 1px solid rgba(157, 225, 255, 0.32);
  background:
    linear-gradient(160deg, rgba(10, 30, 58, 0.88), rgba(7, 19, 40, 0.92)),
    rgba(9, 20, 40, 0.85);
  box-shadow:
    0 20px 50px rgba(2, 10, 26, 0.62),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  z-index: 1;
}

.login-card::after {
  content: "";
  position: absolute;
  inset: 1px;
  border-radius: 25px;
  border: 1px solid rgba(17, 217, 255, 0.2);
  pointer-events: none;
}

.login-card.mobile {
  padding: 24px 20px;
  border-radius: 22px;
}

.card-header h1 {
  margin: 12px 0 6px;
  color: #f4f8ff;
  font-size: 34px;
  line-height: 1.05;
  letter-spacing: 1.2px;
}

.mobile .card-header h1 {
  font-size: 28px;
}

.badge {
  margin: 0;
  font-size: 12px;
  letter-spacing: 2px;
  color: #89daff;
}

.subtitle {
  margin: 0;
  color: rgba(220, 239, 255, 0.78);
  font-size: 15px;
}

.login-form {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field > span {
  color: #a9d8ff;
  letter-spacing: 0.6px;
  font-size: 14px;
}

.field input {
  width: 100%;
  border: 1px solid rgba(129, 201, 255, 0.35);
  border-radius: 12px;
  background: rgba(7, 22, 42, 0.88);
  color: #f7fbff;
  padding: 12px 14px;
  font-size: 16px;
  transition: border-color var(--tech-duration-fast, 160ms) ease,
    box-shadow var(--tech-duration-fast, 160ms) ease;
}

.field input::placeholder {
  color: rgba(199, 224, 255, 0.35);
}

.field input:focus-visible {
  outline: none;
  border-color: rgba(17, 217, 255, 0.86);
  box-shadow: 0 0 0 3px rgba(17, 217, 255, 0.2);
}

.captcha-row {
  display: grid;
  grid-template-columns: 1fr 172px;
  gap: 12px;
  align-items: end;
}

.captcha-field {
  margin: 0;
}

.captcha-box {
  position: relative;
  border: 1px solid rgba(126, 203, 255, 0.45);
  border-radius: 12px;
  min-height: 48px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  overflow: hidden;
  background:
    linear-gradient(140deg, rgba(12, 46, 78, 0.95), rgba(7, 30, 54, 0.88));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 8px 20px rgba(3, 15, 33, 0.42);
  transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
}

.captcha-box::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(
      -36deg,
      rgba(255, 255, 255, 0.12) 0,
      rgba(255, 255, 255, 0.12) 2px,
      transparent 2px,
      transparent 9px
    );
  opacity: 0.32;
  pointer-events: none;
}

.captcha-box:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 10px 24px rgba(3, 15, 33, 0.52);
}

.captcha-box:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.captcha-char {
  position: relative;
  z-index: 1;
  color: #f4fbff;
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.5px;
  text-shadow: 0 0 8px rgba(17, 217, 255, 0.35);
}

.captcha-refresh {
  position: absolute;
  right: 8px;
  bottom: 6px;
  z-index: 1;
  font-size: 11px;
  color: rgba(214, 237, 255, 0.78);
  letter-spacing: 0.4px;
}

.captcha-tip {
  margin: -4px 0 0;
  color: rgba(202, 229, 255, 0.8);
  font-size: 12px;
  letter-spacing: 0.3px;
}

.error-text {
  margin: 2px 0 0;
  font-size: 14px;
  color: #ff8ca3;
}

.login-button {
  border: none;
  border-radius: 999px;
  padding: 13px 18px;
  margin-top: 8px;
  font-size: 16px;
  letter-spacing: 0.9px;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(120deg, #12cbff, #2d7fff 52%, #1388ff);
  box-shadow: 0 14px 24px rgba(12, 103, 175, 0.48);
  transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
}

.login-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 16px 28px rgba(12, 103, 175, 0.62);
}

.login-button:disabled {
  opacity: 0.68;
  cursor: not-allowed;
}

.mobile .captcha-row {
  grid-template-columns: 1fr;
}

@media (max-width: 640px) {
  .captcha-row {
    grid-template-columns: 1fr;
  }

  .captcha-box {
    min-height: 50px;
  }
}
</style>
