<script setup>
import { ref, onMounted } from 'vue';
import HelloWorld from './components/HelloWorld.vue'
import HelloWorld_Mobile from './components/HelloWorld_Mobile.vue'

const is_Mobile = ref(false);

// 判断是否为手机端
const isMobile = () => {
  // 匹配常见的手机设备关键字（iOS/Android 等）
  const mobileKeywords = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|Android/i;
  // 匹配桌面端关键字
  const desktopKeywords = /Windows|Macintosh|Linux|Chrome|Firefox|Safari/i;
  
  const userAgent = navigator.userAgent || window.opera || navigator.vendor;
  
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
});
</script>

<template>
  <HelloWorld v-if="!is_Mobile" msg="Vite + Vue" />
  <HelloWorld_Mobile v-if="is_Mobile" msg="Vite + Vue" />
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
