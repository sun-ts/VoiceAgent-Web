<template>
  <SettingsCard title="打断设置" help="开始检测前设置，启动及检测中锁定，停止后可修改。设置同时适用于开场白和正常回复；手动输入文本不受语音打断开关限制。">
    <el-form label-position="left" label-width="auto" size="small" class="settings-inline">
      <el-form-item>
        <template #label><SettingHelp label="播报打断" help="开启后，播报期间可通过讲话打断开场白和正常回复。关闭后，回复生成、等待播放和播报期间的语音不会打断或发起新问题；空闲时仍可正常提问。" /></template>
        <el-switch :model-value="modelValue.enabled" :disabled="locked"
          inline-prompt active-text="开启" inactive-text="关闭" aria-label="播报打断"
          @update:model-value="update('enabled', $event)" />
      </el-form-item>
      <el-form-item>
        <template #label><SettingHelp label="仅同一说话人可打断" help="开启后，正常回复只接受与当前提问者声纹匹配的语音；声纹不匹配或服务不可用时继续播报。关闭后跳过声纹登记和校验，任何说话人满足字数条件都可打断。开场白尚无参考声纹，只按字数条件判断。" /></template>
        <el-switch :model-value="modelValue.requireSameSpeaker" :disabled="locked || !modelValue.enabled"
          inline-prompt active-text="开启" inactive-text="关闭" aria-label="仅同一说话人可打断"
          @update:model-value="update('requireSameSpeaker', $event)" />
      </el-form-item>
      <el-form-item>
        <template #label><SettingHelp label="打断所需字数" help="识别文本达到此字数后才执行打断。范围 1–50，默认 3；统计汉字、字母和数字，不含标点和空格。开启声纹限制时，还需同时通过声纹校验。" /></template>
        <el-input-number :model-value="modelValue.minCharacters" :disabled="locked || !modelValue.enabled"
          :min="1" :max="MAX_INTERRUPTION_CHARACTERS" :step="1" step-strictly controls-position="right"
          aria-label="打断所需字数" @update:model-value="update('minCharacters', $event)" />
      </el-form-item>
    </el-form>
  </SettingsCard>
</template>

<script setup>
import SettingsCard from './SettingsCard.vue';
import SettingHelp from './SettingHelp.vue';
import { MAX_INTERRUPTION_CHARACTERS, normalizeInterruptionSettings } from '../utils/Services/InterruptionSettings.js';

const props = defineProps({ modelValue: { type: Object, required: true }, locked: Boolean });
const emit = defineEmits(['update:modelValue']);
const update = (key, value) => {
  if (props.locked || (key !== 'enabled' && !props.modelValue.enabled)) return;
  emit('update:modelValue', normalizeInterruptionSettings({ ...props.modelValue, [key]: value }));
};
</script>

