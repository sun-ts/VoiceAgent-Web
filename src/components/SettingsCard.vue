<template>
  <section class="settings-card" role="group" :aria-label="title">
    <h3 class="settings-card-header"><SettingHelp v-if="help" :label="title" :help="help" /><template v-else>{{ title }}</template></h3>
    <div class="settings-card-body"><slot /></div>
  </section>
</template>

<script setup>
import SettingHelp from './SettingHelp.vue';
defineProps({ title: { type: String, required: true }, help: String });
</script>

<style scoped>
.settings-card { margin-bottom: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,.4);
  border-radius: 18px; background: rgba(255,255,255,.88); box-shadow: 0 8px 22px rgba(5,23,45,.12); }
.settings-card-header { position: relative; margin: 0; padding: 14px 16px; border-bottom: 1px solid rgba(17,217,255,.18);
  color: #14213d; font-size: 15px; font-weight: 700;
  background: linear-gradient(130deg, rgba(17,217,255,.12), rgba(45,127,255,.08)); }
.settings-card-header::after { content: ""; position: absolute; left: 16px; bottom: 0;
  width: 56px; height: 2px; border-radius: 999px;
  background: linear-gradient(90deg, #11d9ff, transparent); pointer-events: none; }
.settings-card-body { padding: 14px 16px 2px; }
.settings-card :deep(.el-form-item) { margin-bottom: 14px; }
.settings-card :deep(.el-form-item__label) { color: #476079; font-size: 13px; font-weight: 600; height: auto; }
.settings-card :deep(.el-input__wrapper), .settings-card :deep(.el-textarea__inner),
.settings-card :deep(.el-select__wrapper) { background: rgba(255,255,255,.8); }
.settings-card :deep(.el-input-number) { max-width: 100%; }
.settings-card :deep(.el-switch.is-checked .el-switch__core) {
  border-color: transparent; background: linear-gradient(120deg, #0ccad6, #2d7fff); }
.settings-card :deep(.settings-inline .el-form-item__content) { justify-content: flex-end; }
.settings-card :deep(.settings-inline .el-input-number) { width: 112px; }
</style>
