import { DEFAULT_SPEED, DEFAULT_VOICE_ID } from '../../config/index'
import type { BusinessStatus, DictationItem, GenerateAudioResponse } from '../../types/dictation'
import { parseInput } from '../../utils/parser'
import { buildTtsText, validateItemsForGeneration } from '../../utils/ttsText'

let audioContext: WechatMiniprogram.InnerAudioContext | null = null
const LOCAL_AUDIO_PATH = `${wx.env.USER_DATA_PATH}/dictation-audio.mp3`

interface PageData {
  rawText: string
  items: DictationItem[]
  voiceId: string
  speed: number | string
  status: BusinessStatus
  audioPath: string
  isPlaying: boolean
  errorMessage: string
}

function isGenerateAudioResponse(value: unknown): value is GenerateAudioResponse {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false
  const response = value as Record<string, unknown>
  if (response.ok === false) return typeof response.message === 'string'
  if (response.ok !== true) return false
  const hasUrl = typeof response.audioUrl === 'string' && response.audioUrl.length > 0
  const hasBase64 = typeof response.audioBase64 === 'string' && response.audioBase64.length > 0
  return hasUrl !== hasBase64
}

function disposeAudio() {
  audioContext?.stop()
  audioContext?.destroy()
  audioContext = null
  try {
    wx.getFileSystemManager().unlinkSync(LOCAL_AUDIO_PATH)
  } catch {
    // The temporary Tencent audio file may not exist yet.
  }
}

function writeBase64Audio(audioBase64: string): Promise<string> {
  if (audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) {
    return Promise.reject(new Error('INVALID_BASE64_AUDIO'))
  }
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath: LOCAL_AUDIO_PATH,
      data: audioBase64,
      encoding: 'base64',
      success: () => resolve(LOCAL_AUDIO_PATH),
      fail: reject,
    })
  })
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    rawText: '',
    items: [],
    voiceId: DEFAULT_VOICE_ID,
    speed: DEFAULT_SPEED,
    status: 'idle',
    audioPath: '',
    isPlaying: false,
    errorMessage: '',
  },

  onUnload() {
    disposeAudio()
  },

  invalidateGeneratedAudio(nextStatus: BusinessStatus = 'parsed') {
    disposeAudio()
    this.setData({
      audioPath: '',
      isPlaying: false,
      status: nextStatus,
      errorMessage: '',
    })
  },

  onRawTextInput(event: WechatMiniprogram.TextareaInput) {
    this.invalidateGeneratedAudio('idle')
    this.setData({ rawText: event.detail.value, items: [] })
  },

  onParse() {
    this.invalidateGeneratedAudio('idle')
    const items = parseInput(this.data.rawText)
    if (items.length === 0) {
      this.setData({ status: 'error', items: [], errorMessage: '请输入至少一个有效词语。' })
      return
    }
    this.setData({ items, status: 'parsed', errorMessage: '' })
  },

  onPauseInput(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index)
    const items = this.data.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, pauseSeconds: Number(event.detail.value) } : item,
    )
    this.invalidateGeneratedAudio()
    this.setData({ items })
  },

  onVoiceIdInput(event: WechatMiniprogram.Input) {
    this.invalidateGeneratedAudio()
    this.setData({ voiceId: event.detail.value })
  },

  onSpeedInput(event: WechatMiniprogram.Input) {
    this.invalidateGeneratedAudio()
    this.setData({ speed: event.detail.value })
  },

  async onGenerate() {
    if (this.data.status === 'generating') return

    const itemError = validateItemsForGeneration(this.data.items)
    if (itemError) {
      this.setData({ status: 'error', errorMessage: itemError })
      return
    }
    const voiceId = this.data.voiceId.trim()
    const speed = Number(this.data.speed)
    if (!voiceId) {
      this.setData({ status: 'error', errorMessage: '请填写可用的音色。' })
      return
    }
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      this.setData({ status: 'error', errorMessage: '语速需在 0.5～2 之间。' })
      return
    }

    disposeAudio()
    this.setData({ status: 'generating', audioPath: '', isPlaying: false, errorMessage: '' })

    try {
      const text = buildTtsText(this.data.items)
      const callResult = await wx.cloud.callFunction({
        name: 'generateAudio',
        data: { text, voiceId, speed },
      })
      if (!isGenerateAudioResponse(callResult.result)) throw new Error('INVALID_CLOUD_RESPONSE')
      if (!callResult.result.ok) {
        this.setData({ status: 'error', errorMessage: callResult.result.message })
        return
      }
      const audioPath = await this.prepareAudio(callResult.result)
      this.setData({ status: 'success', audioPath })
    } catch (error) {
      console.error('generateAudio 调用失败', error)
      this.setData({ status: 'error', errorMessage: '生成失败，请稍后重试。' })
    }
  },

  async prepareAudio(result: Extract<GenerateAudioResponse, { ok: true }>): Promise<string> {
    disposeAudio()
    const audioPath = result.audioUrl ?? (await writeBase64Audio(result.audioBase64))
    audioContext = wx.createInnerAudioContext()
    audioContext.src = audioPath
    audioContext.onPlay(() => this.setData({ isPlaying: true }))
    audioContext.onPause(() => this.setData({ isPlaying: false }))
    audioContext.onStop(() => this.setData({ isPlaying: false }))
    audioContext.onEnded(() => this.setData({ isPlaying: false }))
    audioContext.onError((error) => {
      console.error('音频播放失败', error.errCode, error.errMsg)
      this.setData({ isPlaying: false, errorMessage: '音频播放失败，请稍后重试。' })
    })
    return audioPath
  },

  onTogglePlay() {
    if (!audioContext || !this.data.audioPath) return
    if (this.data.isPlaying) audioContext.pause()
    else audioContext.play()
  },

  onBackToEdit() {
    this.invalidateGeneratedAudio()
  },
})
