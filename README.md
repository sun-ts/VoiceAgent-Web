# Vue 3 + Vite

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).

[项目在线体验地址](https://121.41.165.69:8443/).

Use [vad-web](https://github.com/ricky0123/vad) Support for @ricky0123.
Use [阿里云百炼](https://bailian.console.aliyun.com/cn-beijing/) Support for Alibaba.
Use [讯飞开放平台](https://www.xfyun.cn/)  Support for 科大讯飞.
Use [讯飞ASR语音听写接口](wss://iat-api.xfyun.cn/v2/iat) Support for 科大讯飞.
    [讯飞TTS在线语音合成接口](wss://tts-api.xfyun.cn/v2/tts) Support for 科大讯飞.

项目构建：.
1.cd /项目目录.
2.npm install.
3.将.env_pro文件重命名为.env.
4.到阿里百炼平台注册账号，并获取API_KEY，填入.env的VITE_DASHSCOPE_API_KEY配置中，并开通对应模型的使用（DeepSeek Or 其他）.
5.登陆讯飞开放平台平台注册用户，进入控制台新建应用并开通“语音听写”、“在线语音合成”接口调用，将APPID/APISECRET/APIKEY填入对应的.env中.
6.切换HelloWorld&HelloWorld_Mobile下的initVAD方法中的对应代码用于控制本机测试和上线发布所用的代码：.
    ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/' //测试环境
    ort.env.wasm.wasmPaths = '/onnxruntime/'  //正式环境

    baseAssetPath: '/node_modules/@ricky0123/vad-web/dist/', //测试环境
    onnxWASMBasePath: '/node_modules/onnxruntime-web/dist/', //测试环境
    baseAssetPath: '/models/',          //正式环境
    onnxWASMBasePath: '/onnxruntime/',  //正式环境
7.运行npm run dev启动本机环境.
8.运行npm run build打包可部署到Tomcat中（注：Tomcat需进行Https配置）.

注：项目需要配置Https密钥
