import { voiceLog } from './VoiceDiagnostics.js';

// vad-web's internal logger otherwise bypasses the application's switches.
export const log = Object.fromEntries(['debug', 'warn', 'error'].map(level => [level,
  message => voiceLog('vad.runtime', typeof message === 'string'
    ? { reason: message } : { errorType: message?.name }, level),
]));
