import type { DictationItem } from '../types/dictation'

const PAUSE_MARKER = /<#.*?#>/

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100
}

export function validateItemsForGeneration(items: DictationItem[]): string | null {
  if (items.length === 0) return '没有可生成的词语，请先输入并解析。'
  if (items.some((item) => PAUSE_MARKER.test(item.text))) {
    return '词语中包含特殊停顿标记，请删除后再生成。'
  }
  if (
    items.some(
      (item) =>
        !Number.isFinite(item.pauseSeconds) ||
        item.pauseSeconds < 0.01 ||
        item.pauseSeconds > 99.99 ||
        !hasAtMostTwoDecimals(item.pauseSeconds),
    )
  ) {
    return '停顿时间需为 0.01～99.99 秒，最多保留两位小数。'
  }
  return null
}

function formatPause(value: number): string {
  return String(Number(value.toFixed(2)))
}

export function buildTtsText(items: DictationItem[]): string {
  const validationError = validateItemsForGeneration(items)
  if (validationError) throw new Error(validationError)

  return `${items.map((item) => `${item.text}<#${formatPause(item.pauseSeconds)}#>`).join('')}听写结束`
}
