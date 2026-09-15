import { MiniMaxError, type MiniMaxClient, type MiniMaxGenerateRequest } from './minimax'

const MAX_TEXT_CHARACTERS = 9_999

export type GenerateAudioResponse =
  | { ok: true; audioUrl: string; audioLengthMs?: number }
  | { ok: false; errorCode: 'INVALID_ARGUMENT' | 'TTS_TIMEOUT' | 'TTS_FAILED'; message: string }

function isValidRequest(value: unknown): value is MiniMaxGenerateRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<MiniMaxGenerateRequest>
  return (
    typeof request.text === 'string' &&
    request.text.trim().length > 0 &&
    Array.from(request.text).length <= MAX_TEXT_CHARACTERS &&
    typeof request.voiceId === 'string' &&
    request.voiceId.trim().length > 0 &&
    request.voiceId.length <= 256 &&
    typeof request.speed === 'number' &&
    Number.isFinite(request.speed) &&
    request.speed >= 0.5 &&
    request.speed <= 2
  )
}

export function createGenerateAudioHandler(client: Pick<MiniMaxClient, 'generate'>) {
  return async (event: unknown): Promise<GenerateAudioResponse> => {
    if (!isValidRequest(event)) {
      return { ok: false, errorCode: 'INVALID_ARGUMENT', message: '生成参数无效，请检查后重试。' }
    }

    const startedAt = Date.now()
    try {
      const result = await client.generate(event)
      console.info('MiniMax TTS success', { elapsedMs: Date.now() - startedAt })
      return { ok: true, ...result }
    } catch (error) {
      const code = error instanceof MiniMaxError ? error.code : 'UNEXPECTED_ERROR'
      const traceId = error instanceof MiniMaxError ? error.traceId : undefined
      const upstreamStatusCode = error instanceof MiniMaxError ? error.upstreamStatusCode : undefined
      const upstreamStatusMessage = error instanceof MiniMaxError ? error.upstreamStatusMessage : undefined
      console.error('MiniMax TTS failed', {
        code,
        traceId,
        upstreamStatusCode,
        upstreamStatusMessage,
        elapsedMs: Date.now() - startedAt,
      })
      if (code === 'TIMEOUT') {
        return { ok: false, errorCode: 'TTS_TIMEOUT', message: '生成超时，请重新尝试。' }
      }
      if (code === 'UPSTREAM_API_ERROR' && upstreamStatusCode === 1008) {
        return { ok: false, errorCode: 'TTS_FAILED', message: 'MiniMax 余额不足，请充值后重试。' }
      }
      return { ok: false, errorCode: 'TTS_FAILED', message: '生成失败，请稍后重试。' }
    }
  }
}
