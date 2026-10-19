// Starting points for this application's VoiceService, not calibrated noise
// profiles. Adjust against recordings from the actual microphone/environment.
export const VAD_ENVIRONMENTS = [
  {
    value: 'office', label: '办公室',
    description: '适合近距离交谈和日常办公，兼顾响应速度与停顿容忍度。',
    parameters: { pThreshold: 0.55, nThreshold: 0.35, preFrame: 200, cacheFrame: 250, silenceFrame: 1200 },
  },
  {
    value: 'meeting', label: '会议室',
    description: '降低触发门槛并延长结束等待，适合较远的人声和句中停顿。',
    parameters: { pThreshold: 0.5, nThreshold: 0.3, preFrame: 200, cacheFrame: 350, silenceFrame: 1600 },
  },
  {
    value: 'noisy', label: '嘈杂环境',
    description: '提高触发门槛并延长人声确认，减少短促噪声误触发；轻声或短句可能漏检。',
    parameters: { pThreshold: 0.7, nThreshold: 0.5, preFrame: 300, cacheFrame: 400, silenceFrame: 1000 },
  },
  {
    value: 'quiet', label: '安静环境',
    description: '缩短人声确认与结束等待，适合安静空间的近距离说话。',
    parameters: { pThreshold: 0.5, nThreshold: 0.3, preFrame: 150, cacheFrame: 250, silenceFrame: 900 },
  },
];

export const OFFICE_VAD_PARAMETERS = VAD_ENVIRONMENTS.find(item => item.value === 'office').parameters;
export const NOISY_VAD_PARAMETERS = VAD_ENVIRONMENTS.find(item => item.value === 'noisy').parameters;

// The v5 model emits 512 samples at 16 kHz: 32 ms per frame. VoiceService
// expects confirmation/silence in frames, but the lead-in buffer stays in ms.
export const toVoiceServiceParams = (parameters) => [
  parameters.pThreshold,
  parameters.nThreshold,
  Math.ceil(parameters.preFrame / 32),
  Math.ceil(parameters.silenceFrame / 32),
  parameters.cacheFrame,
];
