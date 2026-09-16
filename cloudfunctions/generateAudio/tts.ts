export type TtsProvider = 'minimax' | 'tencent'

export function resolveTtsProvider(
  configuredProvider: string | undefined,
  hasTencentCredentials: boolean,
): TtsProvider {
  const normalized = configuredProvider?.trim().toLowerCase()
  if (normalized === 'minimax' || normalized === 'tencent') return normalized
  return hasTencentCredentials ? 'tencent' : 'minimax'
}

export interface TtsGenerateRequest {
  text: string
  voiceId: string
  speed: number
}

export type TtsGenerateResult =
  | { audioUrl: string; audioBase64?: never; audioLengthMs?: number }
  | { audioBase64: string; audioUrl?: never; audioLengthMs?: number }

export interface TtsClient {
  generate(request: TtsGenerateRequest): Promise<TtsGenerateResult>
}

export type TtsErrorCode =
  | 'CONFIG_ERROR'
  | 'TIMEOUT'
  | 'QUOTA_EXHAUSTED'
  | 'INPUT_TOO_LONG'
  | 'INPUT_UNSUPPORTED'
  | 'UPSTREAM_HTTP_ERROR'
  | 'UPSTREAM_API_ERROR'
  | 'INVALID_RESPONSE'

export class TtsError extends Error {
  constructor(
    public readonly code: TtsErrorCode,
    public readonly provider: TtsProvider,
    public readonly requestId?: string,
    public readonly upstreamCode?: string | number,
  ) {
    super(code)
    this.name = 'TtsError'
  }
}
