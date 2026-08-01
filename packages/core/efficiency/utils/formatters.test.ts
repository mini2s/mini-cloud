import { describe, it, expect } from 'vitest'
import {
  fmtCost,
  formatV2Ratio,
  formatPercent,
  formatNumber,
  formatCurrency,
  getDurationParts,
  fmtDays,
  toPersonDays,
  personDaysValue,
  PERSON_DAY_MINUTES,
} from './formatters'

// These are high-risk areas for scope confusion after the V1→V2 migration; unit tests lock the contract (see the "two scopes" note in the react-frontend-gotchas memory).

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
    // Same number 25: percentage scope = 25%, decimal scope = 2500%. Mixing them produces a 100x error.
    expect(formatPercent(25)).toBe('25.0%')
    expect(formatV2Ratio(25)).toBe('2500.0%')
  })
  it('null/空 → -', () => {
    expect(formatPercent(null)).toBe('-')
    expect(formatPercent('')).toBe('-')
  })
})

describe('locale-neutral display values', () => {
  it('formats numbers with an explicit locale', () => {
    expect(formatNumber(1234.5, 1, 'en')).toBe('1,234.5')
    expect(formatNumber(1234.5, 1, 'de')).toBe('1.234,5')
  })

  it('formats the configured currency without deriving it from locale', () => {
    expect(formatCurrency(1234.5, 'CNY', 'en')).toContain('1,234.50')
    expect(formatCurrency(1234.5, 'USD', 'zh-Hans')).toContain('1,234.50')
  })

  it('returns structured duration parts without localized labels', () => {
    expect(getDurationParts(45)).toEqual({ kind: 'minutes', minutes: 45 })
    expect(getDurationParts(125)).toEqual({ kind: 'hours_minutes', hours: 2, minutes: 5 })
    expect(getDurationParts(480)).toEqual({ kind: 'hours', hours: 8 })
    expect(getDurationParts(960)).toEqual({ kind: 'person_days', personDays: 2 })
    expect(getDurationParts(0)).toEqual({ kind: 'empty' })
  })
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
