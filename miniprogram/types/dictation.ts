export interface DictationItem {
  id: string
  text: string
  charCount: number
  pauseSeconds: number
  warning: boolean
}

export type BusinessStatus = 'idle' | 'parsed' | 'generating' | 'success' | 'error'

export interface GenerateAudioRequest {
  text: string
  voiceId: string
  speed: number
}

export type GenerateAudioResponse =
  | { ok: true; audioUrl: string; audioBase64?: never; audioLengthMs?: number }
  | { ok: true; audioBase64: string; audioUrl?: never; audioLengthMs?: number }
  | { ok: false; errorCode: string; message: string }
