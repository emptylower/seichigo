import { describe, it, expect } from 'vitest'
import { getAiApiDeps } from '@/lib/ai/api'

describe('getAiApiDeps', () => {
  it('returns valid deps object with required properties', async () => {
    const deps = await getAiApiDeps()

    expect(deps).toBeDefined()
    expect(deps.repo).toBeDefined()
    expect(typeof deps.getSession).toBe('function')
    expect(typeof deps.sanitizeHtml).toBe('function')
    expect(typeof deps.isAdminEmail).toBe('function')
  })

  it('caches deps on subsequent calls', async () => {
    const deps1 = await getAiApiDeps()
    const deps2 = await getAiApiDeps()

    expect(deps1).toBe(deps2)
  })
})
