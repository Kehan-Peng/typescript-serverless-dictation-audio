import { describe, expect, it, vi } from 'vitest'
import { createGenerateAudioHandler } from '../cloudfunctions/generateAudio/handler'
import { createMiniMaxClient, MiniMaxError, TimeoutError, type HttpTransport } from '../cloudfunctions/generateAudio/minimax'

const request = { text: '清晨<#10#>听写结束', voiceId: 'test-voice', speed: 1 }

function transportReturning(body: unknown, statusCode = 200): HttpTransport {
  return vi.fn().mockResolvedValue({ statusCode, body })
}

describe('MiniMax adapter', () => {
  it('maps a successful URL response', async () => {
    const transport = transportReturning({
      data: { audio: 'https://example.com/audio.mp3' },
      extra_info: { audio_length: 12345 },
      trace_id: 'trace-1',
      base_resp: { status_code: 0, status_msg: 'success' },
    })
    const client = createMiniMaxClient({ apiKey: 'secret', transport })
    await expect(client.generate(request)).resolves.toEqual({
      audioUrl: 'https://example.com/audio.mp3',
      audioLengthMs: 12345,
    })
    expect(transport).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(transport).mock.calls[0]
    expect(url).toBe('https://api.minimax.cn/v1/t2a_v2')
    expect(options.headers.Authorization).toBe('Bearer secret')
    expect(JSON.parse(options.body)).toEqual({
      model: 'speech-2.8-hd',
      text: request.text,
      stream: false,
      output_format: 'url',
      language_boost: 'Chinese',
      voice_setting: { voice_id: 'test-voice', speed: 1, vol: 1, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
    })
  })

  it('rejects a non-2xx HTTP response', async () => {
    const client = createMiniMaxClient({ apiKey: 'secret', transport: transportReturning({}, 500) })
    await expect(client.generate(request)).rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR' })
  })

  it('rejects a MiniMax business error', async () => {
    const client = createMiniMaxClient({
      apiKey: 'secret',
      transport: transportReturning({ base_resp: { status_code: 1001, status_msg: 'failed' } }),
    })
    await expect(client.generate(request)).rejects.toMatchObject({
      code: 'UPSTREAM_API_ERROR',
      upstreamStatusCode: 1001,
      upstreamStatusMessage: 'failed',
    })
  })

  it.each([
    ['null data', { data: null, base_resp: { status_code: 0 } }],
    ['missing audio', { data: {}, base_resp: { status_code: 0 } }],
    ['invalid audio URL', { data: { audio: 'not-a-url' }, base_resp: { status_code: 0 } }],
  ])('rejects %s', async (_name, body) => {
    const client = createMiniMaxClient({ apiKey: 'secret', transport: transportReturning(body) })
    await expect(client.generate(request)).rejects.toBeInstanceOf(MiniMaxError)
  })

  it('maps a transport timeout', async () => {
    const transport: HttpTransport = vi.fn().mockRejectedValue(new TimeoutError())
    const client = createMiniMaxClient({ apiKey: 'secret', transport })
    await expect(client.generate(request)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('generateAudio handler', () => {
  it('returns a stable successful response and calls MiniMax once', async () => {
    const generate = vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio.mp3' })
    const handler = createGenerateAudioHandler({ generate })
    await expect(handler(request)).resolves.toEqual({ ok: true, audioUrl: 'https://example.com/audio.mp3' })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ ...request, text: '' }, 'INVALID_ARGUMENT'],
    [{ ...request, text: '字'.repeat(10_000) }, 'INVALID_ARGUMENT'],
    [{ ...request, voiceId: '' }, 'INVALID_ARGUMENT'],
    [{ ...request, speed: 0.49 }, 'INVALID_ARGUMENT'],
    [{ ...request, speed: 2.01 }, 'INVALID_ARGUMENT'],
  ])('rejects invalid input without calling MiniMax', async (input, errorCode) => {
    const generate = vi.fn()
    const response = await createGenerateAudioHandler({ generate })(input)
    expect(response).toMatchObject({ ok: false, errorCode })
    expect(generate).not.toHaveBeenCalled()
  })

  it('returns the dedicated timeout message without retrying', async () => {
    const generate = vi.fn().mockRejectedValue(new MiniMaxError('TIMEOUT'))
    const response = await createGenerateAudioHandler({ generate })(request)
    expect(response).toEqual({ ok: false, errorCode: 'TTS_TIMEOUT', message: '生成超时，请重新尝试。' })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('returns an actionable message for MiniMax insufficient balance', async () => {
    const generate = vi.fn().mockRejectedValue(new MiniMaxError('UPSTREAM_API_ERROR', undefined, 1008, '余额不足'))
    const response = await createGenerateAudioHandler({ generate })(request)
    expect(response).toEqual({ ok: false, errorCode: 'TTS_FAILED', message: 'MiniMax 余额不足，请充值后重试。' })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('returns a user-safe failure without retrying', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('upstream detail'))
    const response = await createGenerateAudioHandler({ generate })(request)
    expect(response).toEqual({ ok: false, errorCode: 'TTS_FAILED', message: '生成失败，请稍后重试。' })
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
