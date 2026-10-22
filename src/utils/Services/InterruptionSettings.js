export const DEFAULT_INTERRUPTION_SETTINGS = Object.freeze({
  enabled: true,
  requireSameSpeaker: true,
  minCharacters: 3,
});

export const MAX_INTERRUPTION_CHARACTERS = 50;

export function normalizeInterruptionSettings(settings = {}) {
  return {
    enabled: settings.enabled !== false,
    requireSameSpeaker: settings.requireSameSpeaker !== false,
    minCharacters: Number.isInteger(settings.minCharacters) && settings.minCharacters >= 1 &&
      settings.minCharacters <= MAX_INTERRUPTION_CHARACTERS
      ? settings.minCharacters : DEFAULT_INTERRUPTION_SETTINGS.minCharacters,
  };
}
