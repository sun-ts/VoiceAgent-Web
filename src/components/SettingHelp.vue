<template>
  <span class="setting-label">
    <span>{{ label }}</span>
    <el-tooltip ref="tooltip" :content="help" placement="top" :trigger="['hover', 'focus', 'click']"
      :show-after="150" :hide-after="0" :show-arrow="true" popper-class="setting-help-tooltip">
      <button type="button" class="help-button" :aria-label="`${label}说明`"
        @keydown.esc.stop.prevent="tooltip?.onClose($event)">?</button>
    </el-tooltip>
  </span>
</template>

<script setup>
import { ref } from 'vue';
defineProps({ label: { type: String, required: true }, help: { type: String, required: true } });
const tooltip = ref(null);
</script>

<style scoped>
.setting-label { display: inline-flex; align-items: center; gap: 6px; line-height: 1.5; }
.help-button { flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 1px solid #71859a; border-radius: 50%;
  color: #526b83; background: transparent; font: 600 12px/1 sans-serif; cursor: help; }
.help-button:hover, .help-button:focus-visible { color: #065fb7; border-color: #065fb7; outline: 2px solid #98c8ed; outline-offset: 2px; }
</style>

<style>
.setting-help-tooltip { max-width: min(340px, calc(100vw - 40px)); line-height: 1.7; font-size: 13px; }
</style>
