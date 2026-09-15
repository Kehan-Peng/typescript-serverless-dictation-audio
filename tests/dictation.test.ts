import { describe, expect, it } from 'vitest'
import { countChineseChars } from '../miniprogram/utils/chinese'
import { getDefaultPause } from '../miniprogram/utils/pause'
import { parseInput } from '../miniprogram/utils/parser'
import { buildTtsText, validateItemsForGeneration } from '../miniprogram/utils/ttsText'

describe('countChineseChars', () => {
  it.each([
    ['清晨', 2],
    ['狂风暴雨', 4],
    ['狂风暴雨！', 4],
    ['㐀晨 A！', 2],
  ])('counts Chinese characters in %s', (text, expected) => {
    expect(countChineseChars(text)).toBe(expected)
  })
})

describe('getDefaultPause', () => {
  it('uses 10 seconds for two characters', () => {
    expect(getDefaultPause(2)).toEqual({ pauseSeconds: 10, warning: false })
  })

  it('uses 20 seconds for four characters', () => {
    expect(getDefaultPause(4)).toEqual({ pauseSeconds: 20, warning: false })
  })

  it('warns and uses 10 seconds for other lengths', () => {
    expect(getDefaultPause(3)).toEqual({ pauseSeconds: 10, warning: true })
  })
})

describe('parseInput', () => {
  it('keeps each line as exactly one item', () => {
    const items = parseInput('赏善罚恶\n互敬互爱\n互谅互让')
    expect(items.map((item) => item.text)).toEqual(['赏善罚恶', '互敬互爱', '互谅互让'])
    expect(items.every((item) => item.charCount === 4 && item.pauseSeconds === 20)).toBe(true)
  })

  it('cleans common leading numbering and bullets', () => {
    const input = [
      '1. 清晨',
      '   2、狂风暴雨',
      '   ③ 功成名就',
      '4) 赏善罚恶',
      '（5）互敬互爱',
      '• 互谅互让',
      '* 绿油油',
    ].join('\n')
    expect(parseInput(input).map((item) => item.text)).toEqual([
      '清晨',
      '狂风暴雨',
      '功成名就',
      '赏善罚恶',
      '互敬互爱',
      '互谅互让',
      '绿油油',
    ])
  })

  it('ignores empty lines and trims the remaining lines', () => {
    expect(parseInput('\n  清晨  \n\n狂风暴雨\n').map((item) => item.text)).toEqual(['清晨', '狂风暴雨'])
  })

  it('falls back to whitespace-separated items when pasted text has no line breaks', () => {
    expect(parseInput('清晨 狂风暴雨 雷电').map((item) => item.text)).toEqual(['清晨', '狂风暴雨', '雷电'])
    expect(parseInput('清晨　狂风暴雨\t雷电').map((item) => item.text)).toEqual(['清晨', '狂风暴雨', '雷电'])
  })

  it('does not use whitespace fallback when a segment has no Chinese characters', () => {
    expect(parseInput('版本 1.0').map((item) => item.text)).toEqual(['版本 1.0'])
  })

  it('does not remove normal internal or leading text', () => {
    expect(parseInput('第一名\n版本1.0').map((item) => item.text)).toEqual(['第一名', '版本1.0'])
  })

  it('marks a three-character item as a warning', () => {
    expect(parseInput('绿油油')[0]).toMatchObject({ charCount: 3, pauseSeconds: 10, warning: true })
  })
})

describe('buildTtsText', () => {
  it('matches the complete MVP acceptance text', () => {
    const items = parseInput('清晨\n狂风暴雨\n功成名就\n赏善罚恶\n互敬互爱\n互谅互让')
    expect(items.map(({ text, charCount, pauseSeconds }) => ({ text, charCount, pauseSeconds }))).toEqual([
      { text: '清晨', charCount: 2, pauseSeconds: 10 },
      { text: '狂风暴雨', charCount: 4, pauseSeconds: 20 },
      { text: '功成名就', charCount: 4, pauseSeconds: 20 },
      { text: '赏善罚恶', charCount: 4, pauseSeconds: 20 },
      { text: '互敬互爱', charCount: 4, pauseSeconds: 20 },
      { text: '互谅互让', charCount: 4, pauseSeconds: 20 },
    ])
    expect(buildTtsText(items)).toBe(
      '清晨<#10#>狂风暴雨<#20#>功成名就<#20#>赏善罚恶<#20#>互敬互爱<#20#>互谅互让<#20#>听写结束',
    )
  })

  it('keeps the last item pause before the closing phrase', () => {
    const items = parseInput('清晨\n狂风暴雨')
    expect(buildTtsText(items)).toBe('清晨<#10#>狂风暴雨<#20#>听写结束')
  })

  it('uses a manual pause override', () => {
    const [item] = parseInput('狂风暴雨')
    item.pauseSeconds = 15
    expect(buildTtsText([item])).toBe('狂风暴雨<#15#>听写结束')
  })

  it('formats valid decimal pauses without extra zeroes', () => {
    const [item] = parseInput('清晨')
    item.pauseSeconds = 10.5
    expect(buildTtsText([item])).toBe('清晨<#10.5#>听写结束')
  })
})

describe('generation validation', () => {
  it('rejects pause marker injection', () => {
    const items = parseInput('正常词语<#50#>')
    expect(validateItemsForGeneration(items)).toBe('词语中包含特殊停顿标记，请删除后再生成。')
  })

  it.each([0, 0.001, 100, 12.345])('rejects invalid pause %s', (pauseSeconds) => {
    const [item] = parseInput('清晨')
    item.pauseSeconds = pauseSeconds
    expect(validateItemsForGeneration([item])).toBe('停顿时间需为 0.01～99.99 秒，最多保留两位小数。')
  })
})
