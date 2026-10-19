import { defaultModelFetcher } from './VoiceModelFetcher.js';

const assets = [
  { href: '/onnxruntime/ort-wasm-simd-threaded.mjs', rel: 'modulepreload' },
];
const assetLoads = new Map();
let wasmDownload;

function loadWasm() {
  if (!wasmDownload) {
    wasmDownload = fetch('/onnxruntime/ort-wasm-simd-threaded.wasm', { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`WASM 下载失败: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => new Uint8Array(buffer))
      .catch((error) => {
        wasmDownload = undefined;
        throw error;
      });
  }
  return wasmDownload;
}

// Called only by a mounted, authenticated voice page. Match the runtime's
// URLs and fetch credentials so the browser can reuse these requests.
function preloadVoiceAssets() {
  return Promise.all(assets.map((asset) => {
    if (assetLoads.has(asset.href)) return assetLoads.get(asset.href);
    const link = document.createElement('link');
    if (asset.rel === 'modulepreload' && !link.relList.supports('modulepreload')) {
      const loaded = import(/* @vite-ignore */ asset.href).catch((error) => {
        assetLoads.delete(asset.href);
        throw error;
      });
      assetLoads.set(asset.href, loaded);
      return loaded;
    }
    Object.assign(link, asset);
    link.crossOrigin = 'anonymous';
    link.dataset.voiceAsset = asset.href;
    const loaded = new Promise((resolve, reject) => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => {
        assetLoads.delete(asset.href);
        link.remove();
        reject(new Error(`语音资源加载失败: ${asset.href}`));
      }, { once: true });
    });
    assetLoads.set(asset.href, loaded);
    document.head.append(link);
    return loaded;
  }));
}

export async function createVoiceDetector(options, signal) {
  signal.throwIfAborted();
  const [, wasmBinary, { MicVAD }] = await Promise.all([
    preloadVoiceAssets(),
    loadWasm(),
    import('@ricky0123/vad-web'),
    defaultModelFetcher('/models/silero_vad_v5.onnx'),
  ]);
  signal.throwIfAborted();

  const detector = await MicVAD.new({
    ...options,
    model: 'v5',
    startOnLoad: false,
    baseAssetPath: '/models/',
    // An absolute URL keeps Vite dev from rewriting the runtime's native MJS
    // import as a source-module request (?import) for this public asset.
    onnxWASMBasePath: new URL('/onnxruntime/', window.location.href).href,
    ortConfig: (runtime) => {
      runtime.env.logLevel = 'error';
      // Pass the validated bytes directly; ONNX must not fetch WASM a second time.
      runtime.env.wasm.wasmBinary = wasmBinary;
    },
  });

  // vad-web 0.0.30's destroy() assumes start() has created audio nodes.
  // With startOnLoad:false, only the model exists until the user starts voice.
  const destroyStartedDetector = detector.destroy.bind(detector);
  let disposal;
  detector.destroy = () => {
    if (!disposal) {
      disposal = (async () => {
        if (detector.initializationState === 'uninitialized') {
          detector.initializationState = 'destroyed';
          await detector.model.release();
        } else {
          await destroyStartedDetector();
        }
      })();
    }
    return disposal;
  };

  // Logout may happen while the model is downloading/initializing.
  if (signal.aborted) {
    await detector.destroy();
    signal.throwIfAborted();
  }
  return detector;
}
