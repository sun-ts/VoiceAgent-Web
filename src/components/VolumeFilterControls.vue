<template>
  <SettingsCard title="音量筛选" help="开始检测前设置，启动和检测中锁定，停止后可修改。每次重新开始检测都会清除旧的参考音量。">
    <el-form label-position="left" label-width="auto" size="small" class="settings-inline">
      <el-form-item>
        <template #label><SettingHelp label="启用初始音量筛选" help="开启后，以首次达到人声阈值的音频帧作为参考；空闲时，新一段语音的起始音量不得低于参考音量减去允许降低值。不限制音量升高，且不用于判断说话人身份。关闭后仍需通过 VAD 人声检测。播报期间始终跳过此筛选，避免拦截轻声打断。" /></template>
        <el-switch :model-value="modelValue.enabled" :disabled="locked" aria-label="启用初始音量筛选"
          inline-prompt active-text="开启" inactive-text="关闭" @update:model-value="update('enabled', $event)" />
      </el-form-item>
      <el-form-item>
        <template #label><SettingHelp label="允许降低 (dB)" help="相对首次人声允许降低的幅度，范围 0–60 dB，默认 15。例如首次计算值为 60，设置 15 后，下次语音起始值达到 45 即可。数值越大，越容易接收轻声或远处的声音；越小，筛选越严格。这里是麦克风 PCM 计算的相对音量，并非校准过的环境声压分贝。" /></template>
        <el-input-number :model-value="modelValue.lowerDb" :disabled="locked || !modelValue.enabled"
          :min="0" :max="60" :step="1" controls-position="right" aria-label="允许降低 (dB)"
          @update:model-value="update('lowerDb', $event)" />
      </el-form-item>
    </el-form>
  </SettingsCard>
</template>

<script setup>
import SettingsCard from './SettingsCard.vue';
import SettingHelp from './SettingHelp.vue';
import { normalizeVolumeFilterSettings } from '../utils/Services/VolumeFilterSettings.js';
const props = defineProps({ modelValue: { type: Object, required: true }, locked: Boolean });
const emit = defineEmits(['update:modelValue']);
function update(key, value) {
  if (props.locked || (key !== 'enabled' && !props.modelValue.enabled)) return;
  emit('update:modelValue', normalizeVolumeFilterSettings({ ...props.modelValue, [key]: value }));
}
</script>
