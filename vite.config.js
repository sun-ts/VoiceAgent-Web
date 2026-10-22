import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs' // Vite 7.x 推荐用 node: 前缀引用内置模块
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
const speakerTarget = loadEnv(mode, process.cwd(), '').SPEAKER_PROXY_TARGET;
return {
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: [
      ...['./logging', '../logging'].map(find => ({
        find,
        replacement: path.resolve(__dirname, 'src/utils/Services/VadLogger.js'),
        customResolver(replacement, importer) {
          if (importer?.replaceAll('\\', '/').includes('/@ricky0123/vad-web/')) return replacement;
          return this.resolve(find, importer, { skipSelf: true });
        },
      })),
      // vad-web 0.0.30 has no MicVAD modelFetcher option. Redirect only its
      // internal loader to our shared fetch cache; never patch global fetch.
      {
        find: './default-model-fetcher',
        replacement: path.resolve(__dirname, 'src/utils/Services/VoiceModelFetcher.js'),
        customResolver(replacement, importer) {
          if (importer?.replaceAll('\\', '/').includes('/@ricky0123/vad-web/')) return replacement;
          return this.resolve('./default-model-fetcher', importer, { skipSelf: true });
        },
      },
    ],
  },
  // 3. 依赖预构建：兼容vad-web/onnxruntime-web
  optimizeDeps: {
    include: ['@ricky0123/vad-web', 'onnxruntime-web/wasm'],
    esbuildOptions: {
      plugins: [{
        name: 'shared-vad-model-fetcher',
        setup(build) {
          build.onResolve({ filter: /^\.{1,2}\/logging$/ }, ({ importer }) => {
            if (importer.replaceAll('\\', '/').includes('/@ricky0123/vad-web/')) {
              return { path: 'shared-vad-logger', namespace: 'vad-logger' };
            }
          });
          build.onLoad({ filter: /.*/, namespace: 'vad-logger' }, () => ({
            contents: 'export { log } from "/src/utils/Services/VadLogger.js";',
            loader: 'js',
          }));
          build.onResolve({ filter: /^\/src\/utils\/Services\/VadLogger\.js$/ }, ({ path }) => ({
            path, external: true,
          }));
          build.onResolve({ filter: /^\.\/default-model-fetcher$/ }, ({ importer }) => {
            if (importer.replaceAll('\\', '/').includes('/@ricky0123/vad-web/')) {
              // Keep one cache shared with app source instead of bundling a copy.
              return { path: 'shared-model-fetcher', namespace: 'vad-model-fetcher' };
            }
          });
          build.onLoad({ filter: /.*/, namespace: 'vad-model-fetcher' }, () => ({
            contents: 'export { defaultModelFetcher } from "/src/utils/Services/VoiceModelFetcher.js";',
            loader: 'js',
          }));
          build.onResolve({ filter: /^\/src\/utils\/Services\/VoiceModelFetcher\.js$/ }, ({ path }) => ({
            path, external: true,
          }));
        },
      }],
    },
  },
  build: {
    outDir: 'dist', // 打包输出目录（固定）
    assetsDir: 'assets', // 业务资源目录
    copyPublicDir: true, // 强制复制public目录（不可关闭！）
    // Dynamic imports separate the login page, voice UI and WASM-only runtime.
    // Do not force the full ONNX backend into an eagerly shared chunk.
    commonjsOptions: {
      transformMixedEsModules: true // 兼容ESM/CommonJS混合模块
    },
    sourcemap: false,    // 关闭源码映射（生产推荐）
    minify: 'esbuild'    // 明确指定使用 terser 压缩（Vite 生产环境默认）
    // terserOptions: {
    //   // Terser 混淆配置
    //   compress: {
    //     drop_console: true, // 移除 console.log 等控制台输出（可选）
    //     drop_debugger: true, // 移除 debugger 语句（可选）
    //     pure_funcs: ['console.log', 'console.warn'] // 移除指定函数调用（可选）
    //   },
    //   mangle: {
    //     // 变量名混淆配置
    //     toplevel: true, // 混淆顶层作用域的变量/函数名
    //     eval: true, // 混淆 eval 中的变量名
    //     properties: {
    //       // 混淆对象属性名（谨慎使用，可能导致框架运行异常）
    //       keep_quoted: true, // 保留带引号的属性名，避免破坏第三方库
    //       regex: /^_/ // 只混淆以下划线开头的属性名（可选）
    //     }
    //   },
    //   output: {
    //     comments: false, // 移除所有注释
    //     beautify: false // 不格式化输出（压缩为一行）
    //   }
    // }
  },
  server: {
    proxy: speakerTarget ? {
      '/speaker-api': {
        target: speakerTarget,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/speaker-api/, ''),
      },
    } : undefined,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    https: {
      // 读取自定义证书文件
      key: fs.readFileSync(path.resolve(__dirname, './cert/localhost+3-key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, './cert/localhost+3.pem')),
    },
    port: 5173, // 可选：自定义端口
    host: '0.0.0.0',
    open: true, // 启动后自动打开浏览器
  }
};
})
