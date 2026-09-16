import { describe, expect, it, vi } from 'vitest'
import { createGenerateAudioHandler } from '../cloudfunctions/generateAudio/handler'
import { resolveTtsProvider } from '../cloudfunctions/generateAudio/tts'
import {
  TENCENT_DEFAULT_VOICE_TYPE,
  convertDictationTextToTencentSsml,
  createTencentClient,
  escapeXml,
  type TencentTransport,
} from '../cloudfunctions/generateAudio/tencent'

const request = { text: '清晨<#10#>狂风暴雨<#20#>听写结束', voiceId: 'minimax-voice', speed: 1 }

describe('provider selection', () => {
  it('prefers an explicit provider', () => {
    expect(resolveTtsProvider('minimax', true)).toBe('minimax')
    expect(resolveTtsProvider('tencent', false)).toBe('tencent')
  })

  it('defaults to Tencent only when both Tencent credentials exist', () => {
    expect(resolveTtsProvider(undefined, true)).toBe('tencent')
    expect(resolveTtsProvider(undefined, false)).toBe('minimax')
  })
})

describe('Tencent SSML conversion', () => {
  it('converts dictation pauses and splits a 20-second pause into legal breaks', () => {
    expect(convertDictationTextToTencentSsml(request.text)).toBe(
      '<speak>清晨<break time="10s"/>狂风暴雨<break time="10s"/><break time="10s"/>听写结束</speak>',
    )
  })

  it('escapes XML-sensitive user text', () => {
    expect(escapeXml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&apos;')
    expect(convertDictationTextToTencentSsml('A&B<#10#><词>“\'"<#10#>听写结束')).toBe(
      '<speak>A&amp;B<break time="10s"/>&lt;词&gt;“&apos;&quot;<break time="10s"/>听写结束</speak>',
    )
  })

  it('keeps manual decimal pauses while respecting Tencent break limits', () => {
    expect(convertDictationTextToTencentSsml('狂风暴雨<#15.5#>听写结束')).toBe(
      '<speak>狂风暴雨<break time="10s"/><break time="5500ms"/>听写结束</speak>',
    )
  })
})

describe('Tencent adapter', () => {
  it('uses the configured VoiceType, Tencent normal speed, and returns Base64 once', async () => {
    const transport: TencentTransport = vi.fn().mockResolvedValue({
      Audio: 'SUQzYXVkaW8=',
      RequestId: 'request-1',
    })
    const client = createTencentClient({
      secretId: 'secret-id',
      secretKey: 'secret-key',
      transport,
    })

    await expect(client.generate(request)).resolves.toEqual({ audioBase64: 'SUQzYXVkaW8=' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        Text: '<speak>清晨<break time="10s"/>狂风暴雨<break time="10s"/><break time="10s"/>听写结束</speak>',
        Volume: 0,
        Speed: 0,
        ModelType: 1,
        VoiceType: TENCENT_DEFAULT_VOICE_TYPE,
        PrimaryLanguage: 1,
        SampleRate: 16000,
        Codec: 'mp3',
        EnableSubtitle: false,
      }),
    )
  })

  it('returns Base64 through the stable cloud function response', async () => {
    const transport: TencentTransport = vi.fn().mockResolvedValue({ Audio: 'SUQzYXVkaW8=' })
    const client = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })

    await expect(createGenerateAudioHandler(client, { provider: 'tencent' })(request)).resolves.toEqual({
      ok: true,
      audioBase64: 'SUQzYXVkaW8=',
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('uses an explicitly configured VoiceType', async () => {
    const transport: TencentTransport = vi.fn().mockResolvedValue({ Audio: 'SUQzYXVkaW8=' })
    const client = createTencentClient({
      secretId: 'secret-id',
      secretKey: 'secret-key',
      voiceType: 101012,
      transport,
    })
    await client.generate(request)
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ VoiceType: 101012 }))
  })

  it('normalizes Tencent API failures without retrying', async () => {
    const upstreamError = Object.assign(new Error('SDK detail'), {
      code: 'FailedOperation.ServiceIsolate',
      requestId: 'request-2',
    })
    const transport: TencentTransport = vi.fn().mockRejectedValue(upstreamError)
    const client = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })
    await expect(client.generate(request)).rejects.toMatchObject({
      code: 'UPSTREAM_API_ERROR',
      provider: 'tencent',
      requestId: 'request-2',
      upstreamCode: 'FailedOperation.ServiceIsolate',
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('maps a Tencent API failure to the public TTS_FAILED response', async () => {
    const transport: TencentTransport = vi.fn().mockRejectedValue(
      Object.assign(new Error('SDK detail'), { code: 'FailedOperation.ServiceIsolate' }),
    )
    const client = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })

    await expect(createGenerateAudioHandler(client, { provider: 'tencent' })(request)).resolves.toEqual({
      ok: false,
      errorCode: 'TTS_FAILED',
      message: '生成失败，请稍后重试。',
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each(['UnsupportedOperation.NoFreeAccount', 'UnsupportedOperation.PkgExhausted'])(
    'falls back to MiniMax once when Tencent reports exhausted quota: %s',
    async (upstreamCode) => {
      const transport: TencentTransport = vi.fn().mockRejectedValue(
        Object.assign(new Error('quota exhausted'), { code: upstreamCode, requestId: 'request-quota' }),
      )
      const tencent = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })
      const minimaxGenerate = vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/fallback.mp3' })
      const handler = createGenerateAudioHandler(tencent, {
        provider: 'tencent',
        fallbackClient: { generate: minimaxGenerate },
      })

      await expect(handler(request)).resolves.toEqual({
        ok: true,
        audioUrl: 'https://example.com/fallback.mp3',
      })
      expect(transport).toHaveBeenCalledTimes(1)
      expect(minimaxGenerate).toHaveBeenCalledTimes(1)
    },
  )

  it('maps timeouts without retrying', async () => {
    const transport: TencentTransport = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const client = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })
    await expect(client.generate(request)).rejects.toMatchObject({ code: 'TIMEOUT', provider: 'tencent' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('maps a Tencent timeout to the public TTS_TIMEOUT response', async () => {
    const transport: TencentTransport = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const client = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })

    await expect(createGenerateAudioHandler(client, { provider: 'tencent' })(request)).resolves.toEqual({
      ok: false,
      errorCode: 'TTS_TIMEOUT',
      message: '生成超时，请重新尝试。',
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([{ Audio: '' }, { Audio: 'not base64!' }, { Audio: undefined }, null])(
    'rejects an invalid Audio response %#',
    async (response) => {
      const transport: TencentTransport = vi.fn().mockResolvedValue(response)
      const client = createTencentClient({ secretId: 'secret-id', secretKey: 'secret-key', transport })
      await expect(client.generate(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
      expect(transport).toHaveBeenCalledTimes(1)
    },
  )

  it('falls back to MiniMax before calling Tencent when spoken text exceeds the limit', async () => {
    const tencentTransport: TencentTransport = vi.fn()
    const tencent = createTencentClient({
      secretId: 'secret-id',
      secretKey: 'secret-key',
      transport: tencentTransport,
    })
    const minimaxGenerate = vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/fallback.mp3' })
    const handler = createGenerateAudioHandler(tencent, {
      provider: 'tencent',
      fallbackClient: { generate: minimaxGenerate },
    })

    const response = await handler({ ...request, text: `超${'长'.repeat(150)}<#10#>听写结束` })

    expect(response).toEqual({ ok: true, audioUrl: 'https://example.com/fallback.mp3' })
    expect(tencentTransport).not.toHaveBeenCalled()
    expect(minimaxGenerate).toHaveBeenCalledTimes(1)
  })
})
