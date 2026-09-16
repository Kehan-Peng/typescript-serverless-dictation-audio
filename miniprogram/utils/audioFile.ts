export type AudioFileNameResult =
  | { ok: true; fileName: string }
  | { ok: false; message: string }

const MAX_BASE_NAME_LENGTH = 80
const INVALID_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001F]/

export function normalizeMp3FileName(input: string): AudioFileNameResult {
  const trimmed = input.trim()
  const baseName = trimmed.replace(/\.mp3$/i, '').trim()

  if (!baseName) return { ok: false, message: '请输入音频文件名。' }
  if (INVALID_FILE_NAME_CHARACTERS.test(baseName)) {
    return { ok: false, message: '文件名不能包含 / \\ : * ? " < > | 等字符。' }
  }
  if (baseName.endsWith('.')) return { ok: false, message: '文件名不能以句点结尾。' }
  if (baseName.length > MAX_BASE_NAME_LENGTH) {
    return { ok: false, message: `文件名不能超过 ${MAX_BASE_NAME_LENGTH} 个字符。` }
  }

  return { ok: true, fileName: `${baseName}.mp3` }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function createDefaultAudioFileName(date = new Date()): string {
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}`
  return `听写音频-${day}-${time}.mp3`
}
