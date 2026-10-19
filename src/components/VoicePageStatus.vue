<script setup>
defineProps({ error: { type: Error, default: null } });
const reload = () => window.location.reload();
</script>

<template>
  <div class="voice-page-status" role="status" aria-live="polite">
    <p>{{ error ? '页面加载失败，请检查网络后重试。' : '正在进入语音控制台…' }}</p>
    <button v-if="error" type="button" @click="reload">重新加载</button>
  </div>
</template>

<style scoped>
.voice-page-status {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #d7e8ff;
}
button {
  padding: 10px 20px;
  border: 1px solid #11d9ff;
  border-radius: 8px;
  background: #0f3b62;
  color: inherit;
  cursor: pointer;
}
</style>
