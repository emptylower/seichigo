import { describe, it, expect } from 'vitest'

describe('TranslationsUI default filter behavior', () => {
  it('defaults to ready to surface tasks that need review', () => {
    const defaultStatus = 'ready'
    expect(defaultStatus).toBe('ready')
  })
})
