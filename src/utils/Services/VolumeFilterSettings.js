export const DEFAULT_VOLUME_FILTER_SETTINGS = Object.freeze({ enabled: true, lowerDb: 15 });

export function normalizeVolumeFilterSettings(settings = {}) {
  return {
    enabled: settings.enabled !== false,
    lowerDb: Number.isFinite(settings.lowerDb) && settings.lowerDb >= 0 && settings.lowerDb <= 60
      ? settings.lowerDb : DEFAULT_VOLUME_FILTER_SETTINGS.lowerDb,
  };
}
