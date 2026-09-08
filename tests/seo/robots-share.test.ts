import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/seo/site', () => ({
  getSiteOrigin: () => 'https://seichigo.test',
}))

import robots from '@/app/robots'

describe('robots.txt', () => {
  it('`*` 规则放行读图路由前缀，disallow 保持不变', () => {
    const rules = robots().rules
    const star = Array.isArray(rules) ? rules[0] : rules
    expect(star?.userAgent).toBe('*')
    expect(star?.allow).toContain('/')
    expect(star?.allow).toContain('/api/share/img/')
    expect(star?.allow).toContain('/api/share/photo/')
    expect(star?.disallow).toEqual(['/auth/', '/admin/', '/submit', '/me/', '/api/'])
  })
})
