# Dictation Audio / 听写音频生成器

一个轻量的微信小程序：按行输入词语，预览汉字数量和停顿，调用一次 MiniMax T2A 生成可直接播放的听写音频。

## 产品流程

```text
粘贴词语
  → 按换行解析完整词语
  → 检查并调整停顿
  → 拼接 MiniMax pause marker
  → 一次调用云函数
  → 微信小程序播放音频 URL
```

每一行都是一个完整词语。程序不会对行内文本做中文分词，因此 `赏善罚恶`、`互敬互爱` 和 `互谅互让` 都会保持为单个 Item。

## 功能

- 支持换行解析，也兼容只有一行时使用空格、全角空格或 Tab 分隔的中文词语。
- 清理行首常见列表编号：`1、`、`1.`、`1)`、`（1）`、`①`、`•`、`*`。
- 只统计 Unicode 中文汉字：`U+3400–U+4DBF` 和 `U+4E00–U+9FFF`。
- 2 个汉字默认停顿 10 秒，4 个汉字默认停顿 20 秒，其他长度默认 10 秒并显示警告。
- 所有 Item 都可以手工调整 `0.01–99.99` 秒的停顿。
- 阻止用户输入 `<#…#>` MiniMax 控制标记，避免生成非法 TTS 文本。
- 一个听写列表只调用一次 MiniMax；最后一个词的停顿位于该词和“听写结束”之间。
- 使用 `wx.createInnerAudioContext()` 播放和暂停临时音频 URL。
- 修改输入、停顿、Voice ID 或语速时，旧音频立即失效。

MVP 不包含登录、数据库、历史记录、音频切割、拼接、转码、FFmpeg、VAD 或传统后端服务。

## 技术架构

```text
微信小程序 TypeScript
  ├─ miniprogram/pages/index       输入、预览、生成、播放
  ├─ miniprogram/utils              Parser、汉字计数、停顿和 TTS 文本
  └─ miniprogram/config             App 环境和默认音色配置

微信云函数 generateAudio
  ├─ handler.ts                     参数校验和稳定响应协议
  ├─ minimax.ts                     MiniMax HTTP adapter
  └─ dist/                          可部署的 JavaScript
```

云函数只负责调用 MiniMax，不保存音频、不写数据库，也不保存历史记录。

## 目录

```text
miniprogram/
  app.ts
  config/index.ts
  pages/index/
  types/dictation.ts
  utils/chinese.ts
  utils/parser.ts
  utils/pause.ts
  utils/ttsText.ts
cloudfunctions/generateAudio/
  index.ts
  index.js
  handler.ts
  minimax.ts
  dist/
tests/
  dictation.test.ts
  generateAudio.test.ts
project.config.json
```

## 本地检查

要求 Node.js 18 或更高版本。

```bash
npm install
npm test
npm run typecheck

cd cloudfunctions/generateAudio
npm install
npm run build
```

测试不会请求真实 MiniMax，HTTP transport 使用 mock。测试覆盖解析、汉字计数、默认停顿、TTS 文本、参数校验、超时、上游错误和单次调用约束。

## 微信小程序配置

1. 在微信开发者工具中导入仓库根目录。
2. 在 `project.config.json` 中把 `appid` 从 `touristappid` 改成自己的小程序 AppID。
3. 在 `miniprogram/config/index.ts` 中填写 `CLOUD_ENV_ID`。留空时使用开发者工具当前选中的云开发环境。
4. 确认小程序已开通微信云开发，并且 `generateAudio` 云函数已经部署。

默认音色是 MiniMax 系统音色 `Chinese (Mandarin)_News_Anchor`（新闻女声），默认语速为 `1`。音色也可以在页面上修改。

不要把 MiniMax API Key 写入 `miniprogram/`、`project.config.json` 或任何提交文件。

## 云函数配置与部署

云函数需要一个运行环境变量：

```text
MINIMAX_API_KEY=你的 MiniMax API Key
```

在微信云开发控制台的 `generateAudio` 云函数配置中添加该变量。API Key 只在云函数读取，不会返回小程序。

部署步骤：

```bash
cd cloudfunctions/generateAudio
npm install
npm run build
```

然后在微信开发者工具中右键 `cloudfunctions/generateAudio`，选择“上传并部署：云端安装依赖（不上传 node_modules）”。云函数入口是 `index.main`，执行超时建议设置为 60 秒；adapter 自身在 45 秒后超时，且不会自动重试。

## MiniMax 请求

当前代码使用中国区 MiniMax T2A HTTP 接口：

```text
POST https://api.minimax.cn/v1/t2a_v2
```

请求只发送一次完整听写文本，例如：

```text
清晨<#10#>狂风暴雨<#20#>功成名就<#20#>听写结束
```

请求主体的关键字段如下：

```json
{
  "model": "speech-2.8-hd",
  "text": "清晨<#10#>狂风暴雨<#20#>听写结束",
  "stream": false,
  "output_format": "url",
  "language_boost": "Chinese",
  "voice_setting": {
    "voice_id": "Chinese (Mandarin)_News_Anchor",
    "speed": 1,
    "vol": 1,
    "pitch": 0
  },
  "audio_setting": {
    "format": "mp3",
    "sample_rate": 32000,
    "bitrate": 128000,
    "channel": 1
  }
}
```

MiniMax 返回的 HTTPS 音频 URL 只保存在当前页面状态中。MVP 不上传云存储、不做永久缓存；URL 过期后需要重新生成。

如果使用其他 MiniMax 区域的 API Key，需要按对应平台文档调整 `cloudfunctions/generateAudio/minimax.ts` 中的 endpoint。

## 预览和验收

在开发者工具中粘贴：

```text
清晨
狂风暴雨
功成名就
赏善罚恶
互敬互爱
互谅互让
```

点击“解析词语”后应看到：

```text
清晨       2字  10秒
狂风暴雨   4字  20秒
功成名就   4字  20秒
赏善罚恶   4字  20秒
互敬互爱   4字  20秒
互谅互让   4字  20秒
```

生成文本应为：

```text
清晨<#10#>狂风暴雨<#20#>功成名就<#20#>赏善罚恶<#20#>互敬互爱<#20#>互谅互让<#20#>听写结束
```

真机测试时还应验证播放、暂停、返回修改、重复点击保护，以及输入 `正常词语<#50#>` 时的拦截提示。如果真机无法播放 MiniMax URL，再根据实际现象评估云存储方案；MVP 不预先实现该 fallback。

## 错误处理

云函数对外只返回稳定协议：

```ts
{ ok: true, audioUrl: string, audioLengthMs?: number }
// 或
{ ok: false, errorCode: string, message: string }
```

超时不会自动重试，避免一次用户操作造成重复计费。MiniMax 余额不足、网络失败、非法响应和音频播放失败都会显示适合普通用户的提示；详细日志不包含 API Key、Authorization 或完整请求体。

## 外部配置清单

- 微信小程序 AppID
- 微信云开发 Environment ID
- `generateAudio` 云函数环境变量 `MINIMAX_API_KEY`
- 可用的 MiniMax Voice ID 和余额/语音资源额度

这些配置不会写入公开仓库。
