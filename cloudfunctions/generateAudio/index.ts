import { createGenerateAudioHandler } from './handler'
import { createMiniMaxClient } from './minimax'
import {
  TENCENT_DEFAULT_VOICE_TYPE,
  createTencentClient,
  createTencentSdkTransport,
} from './tencent'
import { resolveTtsProvider } from './tts'

const miniMaxClient = createMiniMaxClient({
  apiKey: process.env.MINIMAX_API_KEY ?? '',
})

const hasTencentCredentials = Boolean(
  process.env.TENCENTCLOUD_SECRET_ID?.trim() && process.env.TENCENTCLOUD_SECRET_KEY?.trim(),
)
const provider = resolveTtsProvider(process.env.TTS_PROVIDER, hasTencentCredentials)

function getTencentVoiceType(): number {
  const configured = Number(process.env.TENCENT_TTS_VOICE_TYPE)
  return Number.isInteger(configured) && configured > 0 ? configured : TENCENT_DEFAULT_VOICE_TYPE
}

function createMainHandler() {
  if (provider === 'minimax') return createGenerateAudioHandler(miniMaxClient)

  const secretId = process.env.TENCENTCLOUD_SECRET_ID ?? ''
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY ?? ''
  const tencentClient = createTencentClient({
    secretId,
    secretKey,
    voiceType: getTencentVoiceType(),
    transport: createTencentSdkTransport({
      secretId,
      secretKey,
      region: process.env.TENCENTCLOUD_REGION ?? '',
    }),
  })
  return createGenerateAudioHandler(tencentClient, {
    provider: 'tencent',
    ...(process.env.MINIMAX_API_KEY?.trim() ? { fallbackClient: miniMaxClient } : {}),
  })
}

export const main = createMainHandler()
