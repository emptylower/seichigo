import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET } from '@/app/api/internal/plan-agent/do-probe/route'

/**
 * DO 派发诊断探针路由：与内部执行路由同样的密钥语义（未配置 503 / 不匹配
 * 或缺失 401），且鉴权失败时不触碰 DO 绑定。
 */

function probeRequest(headers: Record<string, string> = {}) {
  return GET(new Request('http://localhost/api/internal/plan-agent/do-probe', { headers }))
}

describe('诊断探针路由 /api/internal/plan-agent/do-probe', () => {
  beforeEach(() => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 'test-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未配置密钥 → 503', async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', '')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await probeRequest({ 'x-plan-agent-secret': 'test-secret' })
      expect(res.status).toBe(503)
    } finally {
      error.mockRestore()
    }
  })

  it('缺少密钥头 → 401', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await probeRequest()
      expect(res.status).toBe(401)
    } finally {
      error.mockRestore()
    }
  })

  it('密钥错误 → 401', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await probeRequest({ 'x-plan-agent-secret': 'wrong-secret' })
      expect(res.status).toBe(401)
    } finally {
      error.mockRestore()
    }
  })

  it('密钥正确但缺 PLAN_RUN_DISPATCHER 绑定 → 503', async () => {
    const res = await probeRequest({ 'x-plan-agent-secret': 'test-secret' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'PLAN_RUN_DISPATCHER binding missing' })
  })
})
