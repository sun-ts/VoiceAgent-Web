# Vue 3 + Vite

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).

[项目在线体验地址](https://121.43.111.173:8443/).

Use [vad-web](https://github.com/ricky0123/vad) Support for @ricky0123.

Use [阿里云百炼](https://bailian.console.aliyun.com/cn-beijing/) Support for Alibaba.

Use [讯飞开放平台](https://www.xfyun.cn/)  Support for 科大讯飞.

Use [讯飞ASR语音听写接口](wss://iat-api.xfyun.cn/v2/iat) Support for 科大讯飞.

    [讯飞TTS在线语音合成接口](wss://tts-api.xfyun.cn/v2/tts) Support for 科大讯飞.


项目构建：

1.cd /项目目录

2.npm install

3.将.env_pro文件重命名为.env

4.到阿里百炼平台注册账号，并获取API_KEY，填入.env的VITE_DASHSCOPE_API_KEY配置中，并开通对应模型的使用（DeepSeek Or 其他）

5.登陆讯飞开放平台平台注册用户，进入控制台新建应用并开通“语音听写”、“在线语音合成”接口调用，将APPID/APISECRET/APIKEY填入对应的.env中

6.本地和生产环境统一使用 public 中的语音资源，无需切换源码路径：

    /models/silero_vad_v5.onnx
    /onnxruntime/ort-wasm-simd-threaded.wasm
    /onnxruntime/ort-wasm-simd-threaded.mjs

资源路径及 VAD 初始化统一位于 `src/utils/Services/VoiceRuntime.js`。登录页不加载语音页面、Element Plus 和 VAD；登录成功（或恢复登录状态）后按终端加载主页面，再并发下载上述资源。页面显示“语音引擎已就绪”后才允许开始检测，麦克风权限在点击开始时请求。初始化失败可通过“重新加载”重试。

ONNX 通过 `VoiceModelFetcher.js` 显式下载并复用内存中的数据，不使用 link preload，避免等待 WASM 时出现未使用预加载资源的警告。当前 vad-web 0.0.30 没有 MicVAD modelFetcher 配置项，由 `vite.config.js` 在生产构建和开发预构建中适配其模型加载模块；升级 vad-web 后需验证此适配及下载复用测试。

部署时保留原始资源 URL，由 Nginx 的 Content-Encoding 协商压缩传输，不要将源码路径改为 `.gz` 或 `.br`。
7.运行npm run dev启动本机环境

Web 的 VAD 参数面板支持环境预设，默认办公室；手机端默认使用同一套嘈杂环境参数。Web 检测停止后可切换预设或手动微调（显示“自定义”），参数在下次开始检测前应用。刷新后恢复各端默认值。

| 环境 | 人声阈值 | 静音阈值 | 人声确认 ms | 前置缓存 ms | 结束静音 ms |
| --- | --- | --- | --- | --- | --- |
| 办公室 | 0.55 | 0.35 | 200 | 250 | 1200 |
| 会议室 | 0.50 | 0.30 | 200 | 350 | 1600 |
| 嘈杂环境 | 0.70 | 0.50 | 300 | 400 | 1000 |
| 安静环境 | 0.50 | 0.30 | 150 | 250 | 900 |

预设位于 `src/utils/Services/VadEnvironments.js`，为现场调参起点，尚未使用真实环境录音标定。VAD 控制语音起止，不会消除噪声或区分主讲人与背景人声。嘈杂环境提高门槛可能漏掉轻声/短句，会议室延长静音等待会增加结束响应时间。人声确认和结束静音按每帧 32 ms 向上取整。

运行 `npm run test:vad` 检查环境切换、手动微调、实际参数应用及手机端默认行为；测试使用模拟的 VAD 概率帧，不请求麦克风或外部 ASR 服务。

8.运行npm run build打包可部署到Tomcat中（注：Tomcat需进行Https配置）


注：项目需要配置Https密钥

语音加载浏览器回归检查：

```bash
npx playwright install chromium
npm run test:loading
```

检查包含登录前资源隔离、成功登录、桌面/移动端 ONNX/WASM 并发下载且不重复、ONNX/WASM/MJS 失败恢复、modulepreload 不可用时的回退，以及初始化期间和就绪后退出登录的清理。移动端为 Chromium 视口和 UA 模拟。测试使用本地配置的登录账号，不输出凭据；不启动语音识别或调用大模型。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium 可执行文件。
