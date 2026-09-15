import https from 'node:https'

const MINIMAX_ENDPOINT = 'https://api.minimax.cn/v1/t2a_v2'
const REQUEST_TIMEOUT_MS = 45_000

export interface MiniMaxGenerateRequest {
  text: string
  voiceId: string
  speed: number
}

export interface MiniMaxGenerateResult {
  audioUrl: string
  audioLengthMs?: number
}

export interface TransportResponse {
  statusCode: number
  body: unknown
}

export interface TransportOptions {
  headers: Record<string, string>
  body: string
  timeoutMs: number
}

export type HttpTransport = (url: string, options: TransportOptions) => Promise<TransportResponse>

export class TimeoutError extends Error {
  constructor() {
    super('Request timed out')
    this.name = 'TimeoutError'
  }
}

export class MiniMaxError extends Error {
  constructor(
    public readonly code: 'CONFIG_ERROR' | 'TIMEOUT' | 'UPSTREAM_HTTP_ERROR' | 'UPSTREAM_API_ERROR' | 'INVALID_RESPONSE',
    public readonly traceId?: string,
    public readonly upstreamStatusCode?: number,
    public readonly upstreamStatusMessage?: string,
  ) {
    super(code)
    this.name = 'MiniMaxError'
  }
}

export const nodeHttpsTransport: HttpTransport = (url, options) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8')
          let body: unknown = rawBody
          try {
            body = JSON.parse(rawBody)
          } catch {
            // The adapter validates the non-JSON response as invalid data.
          }
          resolve({ statusCode: response.statusCode ?? 0, body })
        })
      },
    )
    request.setTimeout(options.timeoutMs, () => request.destroy(new TimeoutError()))
    request.on('error', reject)
    request.end(options.body)
  })

interface MiniMaxResponse {
  data?: { audio?: unknown } | null
  extra_info?: { audio_length?: unknown }
  trace_id?: unknown
  base_resp?: { status_code?: unknown; status_msg?: unknown }
}

function asMiniMaxResponse(value: unknown): MiniMaxResponse | null {
  return value !== null && typeof value === 'object' ? (value as MiniMaxResponse) : null
}

function isPlayableUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function createMiniMaxClient({
  apiKey,
  transport = nodeHttpsTransport,
}: {
  apiKey: string
  transport?: HttpTransport
}) {
  return {
    async generate(request: MiniMaxGenerateRequest): Promise<MiniMaxGenerateResult> {
      if (!apiKey.trim()) throw new MiniMaxError('CONFIG_ERROR')

      const body = JSON.stringify({
        model: 'speech-2.8-hd',
        text: request.text,
        stream: false,
        output_format: 'url',
        language_boost: 'Chinese',
        voice_setting: {
          voice_id: request.voiceId,
          speed: request.speed,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          format: 'mp3',
          sample_rate: 32000,
          bitrate: 128000,
          channel: 1,
        },
      })

      let response: TransportResponse
      try {
        response = await transport(MINIMAX_ENDPOINT, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(body)),
          },
          body,
          timeoutMs: REQUEST_TIMEOUT_MS,
        })
      } catch (error) {
        if (error instanceof TimeoutError) throw new MiniMaxError('TIMEOUT')
        throw new MiniMaxError('UPSTREAM_HTTP_ERROR')
      }

      const parsed = asMiniMaxResponse(response.body)
      const traceId = typeof parsed?.trace_id === 'string' ? parsed.trace_id : undefined
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new MiniMaxError('UPSTREAM_HTTP_ERROR', traceId)
      }
      if (!parsed) throw new MiniMaxError('INVALID_RESPONSE')
      if (parsed.base_resp?.status_code !== 0) {
        const statusCode = parsed.base_resp?.status_code
        const statusMessage = parsed.base_resp?.status_msg
        throw new MiniMaxError(
          'UPSTREAM_API_ERROR',
          traceId,
          typeof statusCode === 'number' ? statusCode : undefined,
          typeof statusMessage === 'string' ? statusMessage : undefined,
        )
      }
      if (!parsed.data || !isPlayableUrl(parsed.data.audio)) {
        throw new MiniMaxError('INVALID_RESPONSE', traceId)
      }

      const audioLength = parsed.extra_info?.audio_length
      return {
        audioUrl: parsed.data.audio,
        ...(typeof audioLength === 'number' && Number.isFinite(audioLength)
          ? { audioLengthMs: audioLength }
          : {}),
      }
    },
  }
}

export type MiniMaxClient = ReturnType<typeof createMiniMaxClient>
