import { describe, expect, it } from 'vitest'
import { getPointContextDeps } from '@/lib/share/pointContextApi'

describe('getPointContextDeps', () => {
  it('装出一套完整依赖，并且是单例', async () => {
    const deps = await getPointContextDeps()
    expect(typeof deps.repo.findPoint).toBe('function')
    expect(typeof deps.repo.findAddress).toBe('function')
    expect(typeof deps.repo.saveAddress).toBe('function')
    expect(typeof deps.geocode).toBe('function')
    expect(deps.now()).toBeInstanceOf(Date)
    expect(await getPointContextDeps()).toBe(deps)
  })
})
