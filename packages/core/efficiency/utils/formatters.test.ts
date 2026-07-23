import { describe, it, expect } from 'vitest'
import {
  fmtCost,
  formatV2Ratio,
  formatPercent,
  formatNumber,
  fmtDays,
  formatDuration,
  formatVerifyMin,
  toPersonDays,
  personDaysValue,
  PERSON_DAY_MINUTES,
} from './formatters'

// 这些是 V1→V2 迁移后口径混淆的高发区，单测锁死契约（见记忆 react-frontend-gotchas「两套口径」）。

describe('formatV2Ratio（小数口径，×100）', () => {
  it('小数转百分比', () => {
    expect(formatV2Ratio(0.25)).toBe('25.0%')
    expect(formatV2Ratio(1.4)).toBe('140.0%')
  })
  it('digits 可调', () => expect(formatV2Ratio(0.2536, 2)).toBe('25.36%'))
  it('负提效', () => expect(formatV2Ratio(-0.5)).toBe('-50.0%'))
  it('null/空/undefined/非有限 → -', () => {
    expect(formatV2Ratio(null)).toBe('-')
    expect(formatV2Ratio('')).toBe('-')
    expect(formatV2Ratio(undefined)).toBe('-')
    expect(formatV2Ratio(Infinity)).toBe('-')
    expect(formatV2Ratio('abc')).toBe('-')
  })
})

describe('formatPercent（百分比口径，不 ×100）', () => {
  it('输入已是百分比数值', () => {
    expect(formatPercent(300)).toBe('300.0%')
    expect(formatPercent(25)).toBe('25.0%')
  })
  it('与 formatV2Ratio 口径必须不同（关键回归防护）', () => {
    // 同一个数 25：百分比口径=25%，小数口径=2500%。混用即 100 倍错误。
    expect(formatPercent(25)).toBe('25.0%')
    expect(formatV2Ratio(25)).toBe('2500.0%')
  })
  it('null/空 → -', () => {
    expect(formatPercent(null)).toBe('-')
    expect(formatPercent('')).toBe('-')
  })
})

describe('formatDuration（分钟自适应：分钟/小时/人天）', () => {
  it('0/null → -', () => {
    expect(formatDuration(0)).toBe('-')
    expect(formatDuration(null)).toBe('-')
  })
  it('<60 → 分钟', () => expect(formatDuration(45)).toBe('45分钟'))
  it('整小时', () => expect(formatDuration(120)).toBe('2小时'))
  it('小时+分钟', () => expect(formatDuration(125)).toBe('2小时5分钟'))
  it('480 边界 = 8小时（含上界走小时支）', () => expect(formatDuration(480)).toBe('8小时'))
  it('>480 → 人天（÷480）', () => expect(formatDuration(960)).toBe('2.0人天'))
})

describe('formatVerifyMin（验证时长：0 → 全角破折号 U+2014）', () => {
  it('0/null → —', () => {
    expect(formatVerifyMin(0)).toBe('—')
    expect(formatVerifyMin(null)).toBe('—')
    expect(formatVerifyMin(undefined)).toBe('—')
  })
  it('非 0 走 formatDuration', () => expect(formatVerifyMin(45)).toBe('45分钟'))
})

describe('toPersonDays / personDaysValue（÷480）', () => {
  it('PERSON_DAY_MINUTES = 480', () => expect(PERSON_DAY_MINUTES).toBe(480))
  it('480min = 1.0 人天', () => expect(toPersonDays(480)).toBe('1.0'))
  it('<=0 / 非有限 → -', () => {
    expect(toPersonDays(0)).toBe('-')
    expect(toPersonDays(-5)).toBe('-')
    expect(toPersonDays(null)).toBe('-')
  })
  it('personDaysValue 返回数值', () => {
    expect(personDaysValue(960)).toBe(2)
    expect(personDaysValue(0)).toBe(0)
    expect(personDaysValue(null)).toBe(0)
  })
})

describe('fmtCost / fmtDays / formatNumber', () => {
  it('fmtCost 2 位小数；null → 空串', () => {
    expect(fmtCost(1.5)).toBe('1.50')
    expect(fmtCost(null)).toBe('')
  })
  it('fmtDays 0/null → -', () => {
    expect(fmtDays(0)).toBe('-')
    expect(fmtDays(2.5)).toBe('2.5')
  })
  it('formatNumber 千分位', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(null)).toBe('-')
  })
})
