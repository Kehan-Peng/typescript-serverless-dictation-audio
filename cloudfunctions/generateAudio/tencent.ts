import { randomUUID } from 'node:crypto'
import { TtsError, type TtsGenerateRequest, type TtsGenerateResult } from './tts'

export const TENCENT_DEFAULT_VOICE_TYPE = 101011
export const TENCENT_MAX_SPOKEN_CHARACTERS = 150

const PAUSE_MARKER = /<#(\d+(?:\.\d{1,2})?)#>/g
const TENCENT_ENDPOINT = 'tts.tencentcloudapi.com'
const REQUEST_TIMEOUT_SECONDS = 45

export interface TencentTextToVoiceRequest {
  Text: string
  SessionId: string
  Volume: number
  Speed: number
  ProjectId: number
  ModelType: number
  VoiceType: number
  PrimaryLanguage: number
  SampleRate: number
  Codec: 'mp3'
  EnableSubtitle: boolean
}

export interface TencentTextToVoiceResponse {
  Audio?: unknown
  RequestId?: unknown
}

export type TencentTransport = (request: TencentTextToVoiceRequest) => Promise<TencentTextToVoiceResponse>

interface TextPart {
  text: string
  pauseSeconds?: number
}

function parseDictationText(text: string): TextPart[] {
  if (!text.trim()) throw new TtsError('INPUT_UNSUPPORTED', 'tencent')

  const parts: TextPart[] = []
  let cursor = 0
  PAUSE_MARKER.lastIndex = 0
  for (let match = PAUSE_MARKER.exec(text); match; match = PAUSE_MARKER.exec(text)) {
    const readableText = text.slice(cursor, match.index)
    if (!readableText || readableText.includes('<#') || readableText.includes('#>')) {
      throw new TtsError('INPUT_UNSUPPORTED', 'tencent')
    }
    parts.push({ text: readableText, pauseSeconds: Number(match[1]) })
    cursor = match.index + match[0].length
  }

  const trailingText = text.slice(cursor)
  if (!trailingText || trailingText.includes('<#') || trailingText.includes('#>')) {
    throw new TtsError('INPUT_UNSUPPORTED', 'tencent')
  }
  parts.push({ text: trailingText })
  return parts
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildBreakTags(pauseSeconds: number): string {
  if (!Number.isFinite(pauseSeconds) || pauseSeconds < 0.01 || pauseSeconds > 99.99) {
    throw new TtsError('INPUT_UNSUPPORTED', 'tencent')
  }

  let centiseconds = Math.round(pauseSeconds * 100)
  if (Math.abs(centiseconds / 100 - pauseSeconds) > 1e-9 || centiseconds < 5) {
    // Tencent SSML's smallest legal break is 50ms.
    throw new TtsError('INPUT_UNSUPPORTED', 'tencent')
  }

  const tags: string[] = []
  while (centiseconds >= 1_000) {
    tags.push('<break time="10s"/>')
    centiseconds -= 1_000
  }
  if (centiseconds > 0) {
    if (centiseconds % 100 === 0) tags.push(`<break time="${centiseconds / 100}s"/>`)
    else tags.push(`<break time="${centiseconds * 10}ms"/>`)
  }
  return tags.join('')
}

export function getTencentSpokenTextLength(text: string): number {
  return parseDictationText(text).reduce((total, part) => total + Array.from(part.text).length, 0)
}

export function convertDictationTextToTencentSsml(text: string): string {
  const content = parseDictationText(text)
    .map((part) => `${escapeXml(part.text)}${part.pauseSeconds === undefined ? '' : buildBreakTags(part.pauseSeconds)}`)
    .join('')
  return `<speak>${content}</speak>`
}

function isBase64Audio(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 4 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

function readErrorField(error: unknown, field: 'code' | 'requestId'): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

function isTimeoutError(error: unknown): boolean {
  const code = readErrorField(error, 'code')?.toLowerCase()
  const name = error instanceof Error ? error.name.toLowerCase() : ''
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return (
    code === 'etimedout' ||
    code === 'econnaborted' ||
    code === 'requesttimeout' ||
    name.includes('timeout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  )
}

export function createTencentClient({
  secretId,
  secretKey,
  voiceType = TENCENT_DEFAULT_VOICE_TYPE,
  transport,
}: {
  secretId: string
  secretKey: string
  voiceType?: number
  transport: TencentTransport
}) {
  return {
    async generate(request: TtsGenerateRequest): Promise<TtsGenerateResult> {
      if (!secretId.trim() || !secretKey.trim() || !Number.isInteger(voiceType) || voiceType <= 0) {
        throw new TtsError('CONFIG_ERROR', 'tencent')
      }
      if (getTencentSpokenTextLength(request.text) > TENCENT_MAX_SPOKEN_CHARACTERS) {
        throw new TtsError('INPUT_TOO_LONG', 'tencent')
      }

      const sdkRequest: TencentTextToVoiceRequest = {
        Text: convertDictationTextToTencentSsml(request.text),
        SessionId: randomUUID(),
        Volume: 0,
        Speed: 0,
        ProjectId: 0,
        ModelType: 1,
        VoiceType: voiceType,
        PrimaryLanguage: 1,
        SampleRate: 16000,
        Codec: 'mp3',
        EnableSubtitle: false,
      }

      let response: TencentTextToVoiceResponse
      try {
        response = await transport(sdkRequest)
      } catch (error) {
        const requestId = readErrorField(error, 'requestId')
        const upstreamCode = readErrorField(error, 'code')
        if (isTimeoutError(error)) throw new TtsError('TIMEOUT', 'tencent', requestId, upstreamCode)
        if (
          upstreamCode === 'UnsupportedOperation.NoFreeAccount' ||
          upstreamCode === 'UnsupportedOperation.PkgExhausted'
        ) {
          throw new TtsError('QUOTA_EXHAUSTED', 'tencent', requestId, upstreamCode)
        }
        throw new TtsError('UPSTREAM_API_ERROR', 'tencent', requestId, upstreamCode)
      }

      if (!response || typeof response !== 'object') {
        throw new TtsError('INVALID_RESPONSE', 'tencent')
      }
      const requestId = typeof response.RequestId === 'string' ? response.RequestId : undefined
      if (!isBase64Audio(response.Audio)) {
        throw new TtsError('INVALID_RESPONSE', 'tencent', requestId)
      }
      return { audioBase64: response.Audio }
    },
  }
}

interface TencentSdkModule {
  tts: {
    v20190823: {
      Client: new (config: unknown) => {
        TextToVoice(request: TencentTextToVoiceRequest): Promise<TencentTextToVoiceResponse>
      }
    }
  }
}

export function createTencentSdkTransport({
  secretId,
  secretKey,
  region = '',
}: {
  secretId: string
  secretKey: string
  region?: string
}): TencentTransport {
  // The product-only package keeps the deployed cloud function small.
  const tencentcloud = require('tencentcloud-sdk-nodejs-tts') as TencentSdkModule
  const Client = tencentcloud.tts.v20190823.Client
  const client = new Client({
    credential: { secretId, secretKey },
    region: region.trim() || undefined,
    profile: {
      httpProfile: {
        endpoint: TENCENT_ENDPOINT,
        reqTimeout: REQUEST_TIMEOUT_SECONDS,
      },
    },
  })
  return (request) => client.TextToVoice(request)
}

export type TencentClient = ReturnType<typeof createTencentClient>
