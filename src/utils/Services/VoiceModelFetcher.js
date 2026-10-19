const downloads = new Map();

// Shared by VoiceRuntime and vad-web's model loader (wired in vite.config.js).
// Keep the response in memory so even Cache-Control:no-store cannot cause a
// second network download between preparation and model initialization.
export function defaultModelFetcher(path) {
  if (!downloads.has(path)) {
    const download = fetch(path, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`语音模型下载失败: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .catch((error) => {
        downloads.delete(path);
        throw error;
      });
    downloads.set(path, download);
  }
  // Each session owns its buffer, including if a runtime transfers it to a worker.
  return downloads.get(path).then(buffer => buffer.slice(0));
}
