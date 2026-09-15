import type { DictationItem } from '../types/dictation'
import { countChineseChars } from './chinese'
import { getDefaultPause } from './pause'

const LEADING_LIST_MARKER = /^(?:(?:\d{1,3}\s*[.、)]|[（(]\s*\d{1,3}\s*[）)])|[①-⑳]|[•*])\s*/

function cleanLine(line: string): string {
  return line.trim().replace(LEADING_LIST_MARKER, '').trim()
}

function splitIntoItems(rawText: string): string[] {
  const lines = rawText.split(/\r?\n/).map(cleanLine).filter(Boolean)
  if (lines.length !== 1) return lines

  const whitespaceSegments = lines[0].split(/\s+/).map(cleanLine).filter(Boolean)
  if (whitespaceSegments.length > 1 && whitespaceSegments.every((text) => countChineseChars(text) > 0)) {
    return whitespaceSegments
  }
  return lines
}

export function parseInput(rawText: string): DictationItem[] {
  return splitIntoItems(rawText).map((text, index) => {
      const charCount = countChineseChars(text)
      const defaults = getDefaultPause(charCount)
      return {
        id: `item-${index + 1}`,
        text,
        charCount,
        ...defaults,
      }
    })
}
