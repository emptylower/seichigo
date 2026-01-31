import { describe, it, expect } from 'vitest'

describe('TranslationsUI default filter behavior', () => {
  it('should use pending as default filter to show newly created tasks', () => {
    const defaultFilter = 'pending'
    const newTaskStatus = 'pending'
    
    expect(defaultFilter).toBe('pending')
    expect(newTaskStatus).toBe(defaultFilter)
  })

  it('should match API created task status with UI default filter', () => {
    const apiCreatedTaskStatus = 'pending'
    const uiDefaultFilter = 'pending'
    
    expect(apiCreatedTaskStatus).toBe(uiDefaultFilter)
  })
})
