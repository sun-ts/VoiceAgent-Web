# GX10 CAM++ 声纹服务

此目录可单独复制到 GX10。默认面向 ARM64 / NVIDIA GB10，提供音频转声纹向量与音频+参考声纹比对。文字识别继续由现有讯飞 ASR 完成，CAM++ 不输出文字。

## 启动

GX10 需已安装可运行 GPU 容器的 Docker Engine、Compose v2 和 NVIDIA Container Toolkit，并能够访问 NGC、GitHub、PyPI、ModelScope。镜像基于 NVIDIA PyTorch 25.09（CUDA 13.0.1），驱动需兼容该 CUDA 版本。首次构建会编译匹配 NVIDIA torch ABI 的 torchaudio，需要联网并耗时数分钟或更久。

```bash
# 将整个 deploy/camplus 目录复制到 GX10 后，在该目录执行
mkdir -p /home/blingcode/models/funasr/camplus
cp .env.example .env
docker compose up -d --build
docker compose logs -f camplus
curl --fail http://127.0.0.1:8008/healthz
```

模型 `iic/speech_campplus_sv_zh-cn_16k-common`（默认 `v2.0.2`）首次启动自动下载，宿主机位置固定为 `/home/blingcode/models/funasr/camplus`。下载完成标记、配置和权重存在时重启复用；下载中断会在重启时重试。模型加载和 CUDA 预热成功后才提供健康检查。首次下载超过 healthcheck 的10分钟宽限期时，容器可能暂时显示 unhealthy，查看下载日志并等待完成。不要使用缺少 FunASR `config.yaml` 的旧版 v1.0.0。

若使用手工预下载模型，确保该目录直接包含 `configuration.json`、`config.yaml` 和 `campplus_cn_common.bin`，确认文件完整后创建 `.download-complete`。更换模型版本时，停止容器、备份并更换整个模型目录；不要仅修改 `MODEL_REVISION` 期待覆盖已有权重。

本次开发机器没有可用 Docker daemon / GX10，未实机验证镜像构建、GPU 推理、吞吐或声纹识别准确率。这里提供可执行部署配置、接口和启动预热检查，最终以 GX10 上的构建和录音验收为准。

## 接口

所有音频为 **16kHz、单声道、PCM16 小端序原始字节的 Base64**，不包含 WAV 文件头。支持200–10000ms，静音、奇数字节、无效采样率、无效向量返回422，请求体超过450000字节返回413。

`POST /v1/embedding`

```json
{"pcm_base64":"<PCM16 Base64>","sample_rate":16000}
```

返回 `{"embedding":[192个浮点数],"dimension":192,"duration_ms":1500}`。向量已做 L2 归一化。接口本身允许最长10秒，应用端严格限制提问采样不超过1500ms。

`POST /v1/verify`

```json
{"pcm_base64":"<PCM16 Base64>","sample_rate":16000,"reference_embedding":[192个浮点数]}
```

返回 `{"matched":true,"score":0.82,"threshold":0.6,"embedding":[192个浮点数],"duration_ms":1024}`。`score` 是原始余弦相似度（-1到1），`matched` 为 `score >= SIMILARITY_THRESHOLD`。0.60仅为可配置起点，必须用现场同人/异人、扬声器回声、噪声录音标定，不能视为准确率保证。说话人混叠也会影响结果。

`GET /healthz` 返回模型就绪状态、实例数及排队/执行中的请求数。

使用真实 WAV 验证（必须16kHz/单声道/16bit）：

```bash
python3 smoke_test.py --base-url http://127.0.0.1:8008 \
  --reference question.wav --candidate followup.wav --concurrency 4
```

脚本分别截取最多1500ms参考音频、前1024ms候选音频，并发调用比对；打印耗时和得分，不保存声纹。

## 并发

默认单个 Uvicorn 进程持有2个独立 CAM++ 实例（`MODEL_WORKERS=2`），由异步队列分派到线程执行。同一实例始终只处理一个请求，避免 AutoModel 可变配置并发串扰。允许16个待处理请求（`MAX_PENDING=16`），容量满返回503；服务总等待超时10秒返回504。请求超时或断开后，正在运行的模型仍占用槽位直到完成，不会被第二个请求同时使用。可按 GX10 压测提高实例数；不承诺未测量的 QPS。

服务不保存用户ID、音频或声纹数据库。参考向量由浏览器在每次比对时发送，不同浏览器不会共享登记人。部署在受信内网，公网入口使用已有应用鉴权和 HTTPS 反向代理；前端不要存放后端密钥。

## 前端接入

客户端默认请求同源 `/speaker-api/v1/...`。HTTPS 页面不能直接请求 GX10 的 HTTP 地址；请在已有前端 HTTPS 入口加入反向代理。例如 Nginx：

```nginx
location /speaker-api/ {
    # 替换为 GX10 实际内网地址；尾部 / 用于去掉 /speaker-api/ 前缀
    proxy_pass http://GX10_IP:8008/;
    proxy_http_version 1.1;
    proxy_connect_timeout 3s;
    proxy_read_timeout 15s;
    client_max_body_size 450k;
}
```

本地 Vite 开发：在项目根 `.env` 追加 `SPEAKER_PROXY_TARGET=http://GX10_IP:8008` 并重启 Vite。生产部署需配置上面的反向代理。

也可在构建前设置 `VITE_SPEAKER_API_URL=https://你的声纹服务域名`，服务端 `.env` 中设置准确的 `CORS_ORIGINS=https://你的前端域名`；更改 Vite 环境变量后重新构建。

## 客户端行为

- 正常提问继续实时送讯飞 ASR；从 VAD 保留的有效语音中截取最多24000个采样（1500ms）提取声纹，不等待整段长问题。
- 回复生成、待播和播放期间（包括开场白），VAD 触发前至少保留1500ms音频，按32ms帧向上取整；空闲提问仍使用环境面板的声音缓存配置，降低播报时轻声起句被截断的概率。
- 回复生成、待播和播放期间，候选语音先按32帧校验（1024ms）；若不匹配，保留这32帧，再补15帧，以47帧（1504ms）复检一次。阈值不变，校验期间原回复继续。
- 47帧复检仍不匹配或请求异常时，整组丢弃，不送 ASR；后续音频从新的32帧首检开始。段尾不足首检或复检长度，在当前 VAD 配置的连续静音结束时丢弃，静音不能补齐窗口。内部短暂停顿保留在音频中。
- 匹配后把已缓存音频及后续音频按顺序送 ASR；达到页面“打断所需字数”（默认3，范围1–50）才停止 PCM/MP3 和旧回复，再接收追问。字母、数字、汉字计数，标点空格不计。
- 首组声纹在首检或复检通过后，向 ASR 补送其前面的低置信度起句缓存，缓存不参与声纹校验。整组最终失败才一并丢弃该起句缓存；等待校验期间的句中停顿按顺序保留。
- 普通回答遇到登记失败、超时、503、缺少参考声纹时不允许打断。恢复空闲后可通过新的语音问题重新登记；没有参考声纹的文字提问仍遵循此规则。
- 开场白尚无提问者，启用“播报打断”时允许首位说话人的音频直接进入 ASR，并在启用同人校验时提取声纹；达到配置的有效字数后才停止播报。首次提问生效或停止检测后退出此模式。
- Web 与手机端均提供“打断设置”：总开关“播报打断”、同一说话人限制和有效字数。开始检测前设置，启动中和检测中锁定；停止后可重新设置。总开关关闭时，开场白及正常回复期间均不接受语音打断；关闭同人限制时不请求声纹登记或比对，但仍需达到字数条件。刷新页面恢复默认开启/同人校验/3字。
- 待校验缓存最多188帧（约6秒，含句首缓存）；处理过慢导致积压则丢弃该候选段。停止检测、退出页面、文字提问会清空声纹和待处理请求；迟到结果无效。声纹只在页面内存中存在。

## 日志与故障定位

前端默认输出 INFO 级别的结构化日志，在浏览器控制台筛选 `[voice]`。每条包含事件 `event` 和时间；`utteranceId` 关联同一段语音，`requestId` 关联同一次 GX10 请求。只记录时长、窗口序号、相似度等元数据，不记录音频 Base64、声纹向量、转写内容和签名地址。

| 事件 | 含义 |
| --- | --- |
| `vad.start` / `vad.end` | 本地 VAD 开始/结束判定；记录总帧数、时长、模型分类的 `speechFrames/nonSpeechFrames` 及阈值。结束窗口为 `endWindowMs`，并不证明用户真的停止说话 |
| `speaker.enroll_start` / `speaker.enroll_ready` | 提问者声纹提取开始/成功（≤1500ms） |
| `speaker.enroll_failed` | 无法登记，查看对应 HTTP 请求是否超时或失败 |
| `speaker.question_active` | 当前回复绑定提问者，`referenceReady=false` 表示还在等待声纹或没有声纹 |
| `speaker.window_ready` | 第 `window` 次比对，`stage=short/extended` 区分32帧首检和47帧复检，包含 `durationMs` |
| `speaker.window_extend` | 32帧首检未匹配，保留音频等待补足47帧复检，尚未送给 ASR |
| `speaker.http_start` / `speaker.http_result` | 请求与结果，包含 `requestId`、耗时、`score`、`threshold`、`matched` |
| `speaker.window_match` / `speaker.window_discard` | 放行给 ASR / 丢弃当前窗口，`reason` 区分异人和校验异常 |
| `speaker.utterance_discard` | 丢弃候选段：`silence_incomplete_window` 不足首检32帧或复检47帧，`no_reference` 没有参考声纹，`buffer_overflow` 积压过多 |
| `interrupt.settings` | 应用新的总开关、同人校验、最少字数配置 |
| `interrupt.authorized` / `interrupt.rejected` | 达到配置的有效字数 / 结束时仍不足，`minCharacters` 为当前字数设置 |
| `asr_tts.result` / `asr.final` | 讯飞终态及 ASR 有效字符数量，不包含文字内容 |
| `playback.segment_discard` | TTS 分段失败，丢弃残留音频并按顺序跳过，后续段继续播放 |
| `playback.start` / `playback.end` / `playback.stop` | 实际开始播放 / 自然结束 / 新问题或停止检测导致停止 |

手机播放中无法打断时，按 `vad.start → speaker.window_ready → speaker.window_match → interrupt.authorized → playback.stop` 检查停在哪一步。开场白尚无提问者声纹，会跳过比对，直接由 ASR 字数判定。人声指示变化仅说明采集帧仍在更新，不代表声纹或字数已通过。

VAD 已开始后，概率达到持续讲话阈值（`negativeThreshold`）即清零结束计数，只有连续低于该阈值才结束。`speechFrames/nonSpeechFrames` 是送入语音处理链路的帧分类计数，包含预缓存；声纹窗口还会保留句中停顿，因此不能直接等同于声纹请求时长。

播放期间的候选人声不受首次提问记住的音量门槛限制，仍需通过 VAD、声纹和字数校验；短问题若先收到 ASR 终态，会立即提交已收集的人声音频登记声纹，无需等待本地 VAD 静音结束。手机验收时应覆盖短问题、比首次提问更轻的人声、异人拒绝，以及开场白和正常回答两种播放场景。

临时打开 DEBUG（立即生效），或关闭日志：

```javascript
localStorage.setItem('voice-log-level', 'debug')
// 恢复默认
localStorage.removeItem('voice-log-level')
// 关闭
localStorage.setItem('voice-log-level', 'off')
```

也可构建时设置 `VITE_VOICE_LOG_LEVEL=info`（支持 debug/info/warn/error/off）。不逐帧打印，DEBUG 主要增加资源关闭和迟到结果信息。

前端支持按环节独立选择日志。`.env` 中设置默认值，修改后重启开发服务或重新构建部署：

```dotenv
VITE_VOICE_LOG_LEVEL=info
VITE_VOICE_LOG_MODULES=*
# 只排查语音打断时改为：vad,speaker,asr,interrupt
```

| 环节名称 | 控制范围 |
| --- | --- |
| `capture` | 采集重置、移动端麦克风申请/复用/暂停/释放；详细麦克风日志需 debug |
| `vad` | 语音起止、初始化失败、VAD 库内部 logger（含加载 debug 日志） |
| `speaker` | 声纹登记、比对窗口及声纹 HTTP 请求 |
| `asr` | 识别 WebSocket、音频发送、识别结束和错误 |
| `llm` | 大模型请求开始、首段内容耗时、结束和错误，不打印内容 |
| `tts` | 合成 WebSocket、合成错误 |
| `playback` | 播放开始、结束、停止、失败和失败段跳过 |
| `interrupt` | 打断授权、字数不足拒绝 |

浏览器控制台设置立即生效，无需刷新；环节开关和日志级别必须同时满足才输出：

```javascript
// 只看打断相关环节（如果要同时看播放器停止，再加 playback）
localStorage.setItem('voice-log-modules', 'vad,speaker,asr,interrupt')
localStorage.setItem('voice-log-level', 'debug')
// 只看识别和合成；共享 WebSocket 日志会自动归到 asr 或 tts
localStorage.setItem('voice-log-modules', 'asr,tts')
// 开启所有环节 / 关闭所有环节（包括错误日志）
localStorage.setItem('voice-log-modules', '*')
localStorage.setItem('voice-log-modules', 'off')
// 恢复构建时默认配置
localStorage.removeItem('voice-log-modules')
localStorage.removeItem('voice-log-level')
```

名称忽略大小写和首尾空格。`all` 等同 `*`；`none` 或空字符串等同 `off`，未知环节名被忽略。未配置时默认所有环节、INFO；日志包含 `module` 字段便于筛选。浏览器存储不可用时回退到构建默认值。该开关控制前端项目日志和适配过的 VAD 内部 logger，不控制浏览器原生错误、第三方直接 console 输出或后端日志。仍只记录白名单元数据，不输出音频、声纹、转写正文或签名地址。

后端日志为 JSON 行，通过 Docker 查看：

```bash
docker compose logs --tail=200 -f camplus
# 将下面的值替换为前端 speaker.http_* 中的 requestId
docker compose logs --since=10m camplus | grep '你的requestId'
```

服务启动应依次看到 `model.cache_hit` 或 `model.download_*`、`service.starting`、每个实例的 `model.ready`、`service.ready`。比对请求应看到 `inference.queued`、`inference.start`、`inference.done`、`speaker.verify`、`http.complete`。其中 `queue_ms` 是等待模型的时间，`inference_ms` 是实际推理时间，HTTP `elapsed_ms` 是服务端总处理时间；前端 `elapsedMs` 还包含网络和代理时间。

后端 `.env` 的 `LOG_LEVEL=INFO` 控制日志级别，可改为 DEBUG/WARNING/ERROR。修改后执行 `docker compose up -d` 重建容器配置；修改 Python 代码则执行 `docker compose up -d --build`。健康检查正常访问只在 DEBUG 打印，避免每15秒刷屏。

原“循环200次，耗时2S未检测到结束发送标识”来自前端重复的 ASR 发送队列：讯飞已结束但外层轮询仍存活。现在终态会关闭发送器，不再等待已结束会话的结束帧。真正的异常分别记录：

- `asr_tts.connect_timeout`：10秒内未连上讯飞 WebSocket。
- `asr_tts.input_stalled`：5秒没有收到新的音频帧；正常静音仍有32ms PCM帧，不会触发此项。检查麦克风、页面是否进入后台、VAD是否停止产出帧。
- `asr_tts.result_timeout`：结束帧发出后连续15秒没有收到响应；正常流式分片会续期，避免截断仍在合成的长回复。
- `asr_tts.socket_error` / `asr_tts.remote_close`：网络错误或服务端提前断开。
- `speaker.http_error` / `speaker.http_failed`：声纹接口HTTP错误、网络故障、5秒超时；到后端查相同 `request_id`。503表示推理队列满或推理失败，504表示服务端等待超时。

更新部署时，前端也要重新 `npm run build` 并替换网站文件，否则浏览器仍会运行旧的2秒计时器。新请求携带 `X-Request-ID`，跨域部署时须同时更新后端 CORS 配置；同源反向代理默认会转发该请求头。

## 自动化测试

```bash
python3 -m venv .venv
.venv/bin/pip install fastapi==0.115.12 httpx==0.28.1 numpy pytest
PYTHONPATH=. .venv/bin/python -m pytest tests -q
```

测试覆盖输入校验、接口、独立参考向量、并发/过载和取消后的槽位安全。模型边界使用确定性替身，不能代替 GX10 上的真实模型验收。

实现参考：[FunASR CAM++](https://github.com/modelscope/FunASR/tree/main/examples/industrial_data_pretraining/campplus_sv)、[NVIDIA PyTorch 25.09](https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-25-09.html)。
