const CHINESE_CHARACTER = /[\u3400-\u4DBF\u4E00-\u9FFF]/g

export function countChineseChars(text: string): number {
  return text.match(CHINESE_CHARACTER)?.length ?? 0
}
