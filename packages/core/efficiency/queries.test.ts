import { describe, it, expect } from 'vitest'
import { efficiencyKeys } from './queries'

describe('efficiencyKeys', () => {
  it('scopes all keys under wsId', () => {
    expect(efficiencyKeys.all('ws1')).toEqual(['efficiency', 'ws1'])
  })

  it('nests summary under wsId + dates', () => {
    expect(
      efficiencyKeys.summary('ws1', '2026-01-01', '2026-01-31'),
    ).toEqual(['efficiency', 'ws1', 'summary', '2026-01-01', '2026-01-31'])
  })

  it('handles undefined dates in summary key', () => {
    expect(efficiencyKeys.summary('ws1')).toEqual([
      'efficiency',
      'ws1',
      'summary',
      undefined,
      undefined,
    ])
  })

  it('config key is stable', () => {
    expect(efficiencyKeys.config('ws1')).toEqual([
      'efficiency',
      'ws1',
      'config',
    ])
  })
})
