# Dictation Audio / 听写音频生成器

一个轻量的微信小程序：按行输入词语，预览汉字数量和停顿，通过微信云函数一次生成完整听写音频。云函数可使用腾讯云 TTS 或 MiniMax，普通用户无需选择服务商。

## 产品流程

```text
粘贴词语
  → 按换行解析完整词语
  → 检查并调整停顿
  → 生成内部停顿协议文本
  → 一次调用微信云函数
  → 一次调用当前 TTS Provider
  → 微信小程序播放或自定义名称导出 MP3
```

每一行都是一个完整词语。程序不会对行内文本做中文分词，因此 `赏善罚恶`、`互敬互爱` 和 `互谅互让` 都会保持为单个 Item。

## 功能

- 支持换行解析，也兼容只有一行时使用空格、全角空格或 Tab 分隔的中文词语。
- 清理行首常见列表编号：`1、`、`1.`、`1)`、`（1）`、`①`、`•`、`*`。
- 只统计 Unicode 中文汉字：`U+3400–U+4DBF` 和 `U+4E00–U+9FFF`。
- 2 个汉字默认停顿 10 秒，4 个汉字默认停顿 20 秒，其他长度默认 10 秒并显示警告。
- 所有 Item 都可以手工调整 `0.01–99.99` 秒的停顿。
- 阻止用户在词语中输入 `<#…#>` 控制标记。
- 支持腾讯云 TTS 与 MiniMax，通过云函数环境变量切换，不增加前端 Provider Picker。
- 一份听写只发起一次 TTS 请求；不会自动重试，也不切割、拼接或转码音频。
- 修改输入、停顿、音色或语速时，旧音频立即失效。
- 生成后可自定义 MP3 文件名；电脑端保存到磁盘，手机端通过微信文件界面导出。

本项目不包含登录、数据库、历史记录、云端音频存储、FFmpeg、VAD、传统后端服务或任务队列。

## 架构

```text
微信小程序
  ├─ 输入、Preview、停顿编辑
  ├─ buildTtsText() → 清晨<#10#>狂风暴雨<#20#>听写结束
  ├─ 播放、命名与 MP3 导出
  └─ wx.cloud.callFunction('generateAudio')
                         │
                         ▼
微信云函数 generateAudio
  ├─ 参数校验与稳定响应协议
  ├─ TTS_PROVIDER=minimax  → MiniMax URL
  └─ TTS_PROVIDER=tencent  → Tencent SSML → Base64 MP3
                                  │
                                  └─ 超过腾讯单次限制时可回退 MiniMax
```

`<#x#>` 是项目内部的 **Dictation Pause Protocol**：

- MiniMax adapter 原样发送。
- Tencent adapter 转换为合法 SSML，并对用户文本做 XML escape。

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
  index.ts                 Provider 选择与环境变量
  handler.ts               参数校验、fallback、稳定响应
  tts.ts                   轻量 Provider-neutral 类型
  minimax.ts               MiniMax HTTP adapter
  tencent.ts               腾讯云 SDK adapter 与 SSML 转换
  index.js                 云函数入口桥接
  dist/                    编译后的可部署 JavaScript
tests/
  dictation.test.ts
  generateAudio.test.ts
  tencent.test.ts
project.config.json
```

上一版纯 MiniMax 实现保存在 Git 标签 `minimax`。

## 本地检查

要求 Node.js 18 或更高版本。

```bash
npm install
npm test
npm run typecheck

cd cloudfunctions/generateAudio
npm install
npm run build
npm audit --omit=dev
```

测试使用 mock transport，不会请求真实腾讯云或 MiniMax，也不会产生计费调用。

## 微信小程序配置

1. 在微信开发者工具中导入仓库根目录。
2. 在 `project.config.json` 中把 `appid` 从 `touristappid` 改成自己的小程序 AppID。
3. 在 `miniprogram/config/index.ts` 中填写 `CLOUD_ENV_ID`；留空时使用开发者工具当前选中的云开发环境。
4. 在开发者工具中开通云开发，确认当前小程序 AppID 有权访问该环境。
5. 部署 `generateAudio` 云函数。

`miniprogram/config/index.ts` 中的 `DEFAULT_VOICE_ID` 供 MiniMax 使用。腾讯模式暂时忽略前端 `voiceId`，使用云函数环境变量配置整数 `VoiceType`；这是为了保持现有页面和请求协议不变。

任何 Secret 都不能写入 `miniprogram/`、`project.config.json` 或 Git。

### 下载和导出 MP3

音频生成成功后，结果卡片会预填一个带时间的文件名，例如 `听写音频-20260916-0905.mp3`。可以在下载前修改名称；程序会自动补上 `.mp3`，并拒绝路径分隔符等不安全字符。

- 腾讯云返回 Base64 MP3：先写入 `wx.env.USER_DATA_PATH`，再复制为自定义文件名。
- MiniMax 返回 HTTPS URL：使用 `wx.downloadFile` 下载为自定义文件名。正式发布前，需要把音频 URL 所在域名加入小程序的 **downloadFile 合法域名**；域名以真实 MiniMax 响应为准。
- Windows、macOS 微信客户端：点击“下载 MP3”后调用 `wx.saveFileToDisk`，打开系统保存窗口。
- 微信开发者工具：该工具不支持调试 `wx.saveFileToDisk`，页面会确认文件已写入模拟器本地，并提示使用真机验证最终导出。
- 手机微信：点击后调用 `wx.shareFileMessage` 打开微信文件导出界面，用户可以发送到文件传输助手或其他会话，再保存到手机。

微信小程序不能在手机上静默写入系统任意“下载”目录。上述手机流程保留用户选择权，也能保持自定义文件名。文件导出要求微信基础库 `2.16.1` 或更高版本；本项目当前配置满足该要求。

## 云函数环境变量

推荐显式设置 `TTS_PROVIDER=tencent`。如果未设置：同时存在腾讯 SecretId 和 SecretKey 时自动选择腾讯，否则继续使用 MiniMax；这样已有 MiniMax 部署不会因升级立即中断。

### 使用腾讯云 TTS

```text
TTS_PROVIDER=tencent
TENCENT_SECRET_ID=你的 SecretId
TENCENT_SECRET_KEY=你的 SecretKey
TENCENT_TTS_VOICE_TYPE=101011
MINIMAX_API_KEY=可选，用于腾讯超限或不兼容停顿时 fallback
```

- `TENCENT_TTS_VOICE_TYPE` 未设置时默认 `101011`，即官方音色表中的新闻女声“智燕”。可在腾讯云控制台试听后换成其他整数 VoiceType。
- `TENCENT_TTS_REGION` 对 `TextToVoice` 是可选参数，通常无需创建；只有账号或后续官方要求指定时再填写，例如 `ap-guangzhou`。
- 微信云函数禁止自定义 Key 使用 `TENCENTCLOUD_`、`SCF_` 或 `QCLOUD_` 保留前缀，因此凭证变量使用 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`。
- 没有配置 `MINIMAX_API_KEY` 时，腾讯超限或额度耗尽会返回友好错误，不会拆段或重复请求腾讯。

### 免费额度优先、MiniMax 兜底

配置腾讯凭证和 `MINIMAX_API_KEY` 后，下列情况会切到 MiniMax，并且 MiniMax 最多调用一次：

- 腾讯文本超过本项目的 150 字安全上限：不调用腾讯，直接调用 MiniMax。
- 停顿小于腾讯允许的 50ms：不调用腾讯，直接调用 MiniMax。
- 腾讯返回官方额度错误 `UnsupportedOperation.NoFreeAccount` 或 `UnsupportedOperation.PkgExhausted`：腾讯请求失败后调用一次 MiniMax。

如果腾讯账号已开启后付费，免费资源包用完后腾讯请求可能继续成功并产生腾讯费用，此时云函数不会收到额度错误，也就无法自动切换。要严格实现“只用免费额度，用完转 MiniMax”，请在腾讯云 TTS 控制台关闭后付费，并保留资源包耗尽通知。超时、网络失败和其他不确定错误不会自动 fallback，避免同一操作在两家都产生计费请求。

### 使用 MiniMax

```text
TTS_PROVIDER=minimax
MINIMAX_API_KEY=你的 MiniMax API Key
```

环境变量在微信云开发控制台的 **云函数 → generateAudio → 配置 → 环境变量** 中填写。修改变量后重新部署或更新云函数配置，避免把 `.env` 和真实凭证提交到仓库。

## 部署云函数

先在本地生成部署文件：

```bash
cd cloudfunctions/generateAudio
npm install
npm run build
```

然后在微信开发者工具中右键 `cloudfunctions/generateAudio`，选择 **上传并部署：云端安装依赖（不上传 node_modules）**。

- 云函数入口：`index.main`
- 云函数执行超时建议：60 秒
- 两个 adapter 的请求超时：45 秒
- 生产依赖：按产品安装的 `tencentcloud-sdk-nodejs-tts`

超时不会自动重试，避免一次操作产生两次计费请求。

## 腾讯云开通步骤

1. 登录[腾讯云语音合成控制台](https://console.cloud.tencent.com/tts)，完成实名认证并开通通用语音合成。
2. 进入控制台的“语音合成资源包”，手动领取免费资源包。
3. 在[访问管理 API 密钥管理](https://console.cloud.tencent.com/cam/capi)创建 SecretId / SecretKey。个人工具可使用单独的子用户并只授予调用 TTS 所需权限。
4. 在音色列表或控制台试听音色。默认新闻女声为 `101011`；将选中的整数 ID 写入 `TENCENT_TTS_VOICE_TYPE`。
5. 把 Secret 与 Provider 写入微信云函数环境变量，重新部署 `generateAudio`。

腾讯云当前官方免费额度仅适用于通用语音合成，需要手动领取，每个账号只能领取一次，领取后 3 个月有效：

- 基础/精品音色：800 万字符。
- 大模型音色：10 万字符。
- 超自然大模型音色：2 万字符。

免费额度用尽后的行为取决于腾讯云账号是否开通后付费。需要“免费额度用完即转 MiniMax”时，应关闭腾讯云 TTS 后付费；否则资源包耗尽后可能自动按量计费。

官方参考：

- [基础语音合成 TextToVoice](https://cloud.tencent.com/document/api/1073/37995)
- [SSML 标记语言](https://cloud.tencent.com/document/product/1073/49575)
- [音色列表](https://cloud.tencent.com/document/product/1073/92668)
- [Node.js 服务端接入](https://cloud.tencent.com/document/product/1073/56640)
- [计费与免费额度](https://cloud.tencent.com/document/product/1073/34112)
- [资源包领取](https://cloud.tencent.com/document/product/1073/56352)

## 腾讯云请求

调用 API：

```text
Action: TextToVoice
Version: 2019-08-23
Endpoint: tts.tencentcloudapi.com
```

最终请求参数：

```ts
{
  Text: '<speak>...</speak>',
  SessionId: '<每次请求一个 UUID>',
  Volume: 0,
  Speed: 0,
  ProjectId: 0,
  ModelType: 1,
  VoiceType: 101011,
  PrimaryLanguage: 1,
  SampleRate: 16000,
  Codec: 'mp3',
  EnableSubtitle: false
}
```

腾讯 `Speed=0` 才是正常 1.0 倍语速。前端的 MiniMax `speed=1` 不会直接传给腾讯，避免错误复用两家的参数语义。

### 停顿转换

内部文本：

```text
清晨<#10#>狂风暴雨<#20#>听写结束
```

腾讯 SSML：

```xml
<speak>清晨<break time="10s"/>狂风暴雨<break time="10s"/><break time="10s"/>听写结束</speak>
```

腾讯官方 `<break>` 规则是：秒值只能是 `1–10` 的整数，毫秒值只能是 `50–10000` 的整数。因此 20 秒拆成两个相邻的 10 秒 break；最后一个词的完整停顿仍位于该词和“听写结束”之间。官方文档没有禁止相邻 break。

用户文本中的 `& < > " '` 会分别转换为 XML entity，不会直接拼进 SSML。内部停顿小于 50ms 时无法被腾讯合法表达；若配置了 MiniMax，会在调用腾讯前回退 MiniMax。

### 单次长度限制与 fallback

`TextToVoice` 当前官方限制为：中文最多 150 个汉字（全角标点计数），英文最多 500 个字母（半角标点计数）。本项目是中文听写工具，因此腾讯 adapter 采用保守规则：只统计实际朗读内容，SSML 标签和内部 pause marker 不计入，并以 150 个 Unicode 字符为上限。

超过上限时，或腾讯明确返回官方额度耗尽错误时：

```text
长度超限：Tencent API 0 次，MiniMax API 1 次
额度耗尽：Tencent API 1 次（失败），MiniMax API 1 次
```

不会先请求腾讯再判断，也不会分段、多次合成或拼接音频。

## 音频返回与播放

云函数使用稳定的内部响应协议：

```ts
{ ok: true, audioUrl: string, audioBase64?: never }
// 或
{ ok: true, audioBase64: string, audioUrl?: never }
// 或
{ ok: false, errorCode: string, message: string }
```

- MiniMax 返回 HTTPS URL，小程序直接交给 `wx.createInnerAudioContext()`。
- 腾讯返回 Base64 MP3，小程序覆盖写入 `${wx.env.USER_DATA_PATH}/dictation-audio.mp3`，再播放本地路径。
- 修改内容、重新解析、修改停顿/音色/语速或页面卸载时，播放器会停止并删除腾讯临时文件。
- 不写数据库、不上传云存储、不永久缓存音频。

## MiniMax 保留行为

MiniMax 仍使用：

```text
POST https://api.minimax.cn/v1/t2a_v2
```

关键参数保持不变：`speech-2.8-hd`、非流式、`output_format=url`、MP3 32kHz / 128kbps / 单声道、`language_boost=Chinese`。完整听写文本只调用一次 MiniMax，且不自动重试。

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

Preview 应显示：

```text
清晨       2字  10秒
狂风暴雨   4字  20秒
功成名就   4字  20秒
赏善罚恶   4字  20秒
互敬互爱   4字  20秒
互谅互让   4字  20秒
```

内部生成文本应为：

```text
清晨<#10#>狂风暴雨<#20#>功成名就<#20#>赏善罚恶<#20#>互敬互爱<#20#>互谅互让<#20#>听写结束
```

在微信开发者工具中点击“编译”，完成解析、生成、播放、暂停和返回修改测试。再点击“预览”生成二维码，用绑定该小程序的微信真机扫码，确认云函数环境、Base64 临时 MP3 写入和 `InnerAudioContext` 播放均正常。

还应验证：

- 连续点击生成只产生一次请求。
- 修改内容后旧音频不能继续播放。
- 输入 `正常词语<#50#>` 时生成被阻止。
- 腾讯模式下 20 秒停顿完整保留。
- 超过腾讯单次限制时，在配置 MiniMax 的情况下只调用一次 fallback。

## 安全与日志

Secret 只由云函数从环境变量读取。日志仅记录 Provider、RequestId、上游错误码和耗时，不记录 SecretId、SecretKey、Authorization、完整请求文本或完整音频 Base64。

普通用户只会看到稳定提示：

```text
生成失败，请稍后重试。
生成超时，请重新尝试。
```

## 外部配置清单

- 微信小程序 AppID
- 微信云开发 Environment ID
- 腾讯云 TTS 服务和免费资源包
- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- 可选的 `TENCENT_TTS_VOICE_TYPE`
- MiniMax 模式或 fallback 使用的 `MINIMAX_API_KEY`

这些值都不会写入公开仓库。
