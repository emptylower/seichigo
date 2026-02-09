import { describe, expect, it, vi } from 'vitest'
import { VercelClient, resolveOpsVercelConfigFromEnv } from '@/lib/ops/vercelClient'

describe('resolveOpsVercelConfigFromEnv', () => {
  it('uses OPS_VERCEL_PROJECT_ID first and falls back to VERCEL_PROJECT_ID', () => {
    const configFromOps = resolveOpsVercelConfigFromEnv({
      OPS_VERCEL_API_TOKEN: 'token',
      OPS_VERCEL_PROJECT_ID: 'prj_ops',
      VERCEL_PROJECT_ID: 'prj_fallback',
    })
    expect(configFromOps.ok).toBe(true)
    if (configFromOps.ok) {
      expect(configFromOps.value.projectId).toBe('prj_ops')
    }

    const configFromFallback = resolveOpsVercelConfigFromEnv({
      OPS_VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'prj_fallback',
    })
    expect(configFromFallback.ok).toBe(true)
    if (configFromFallback.ok) {
      expect(configFromFallback.value.projectId).toBe('prj_fallback')
    }
  })
})

describe('VercelClient.listDeployments', () => {
  it('accepts uid as deployment identifier when id is absent', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          deployments: [
            {
              uid: 'dpl_uid_only',
              created: 1770637142460,
              name: 'seichigo',
              url: 'seichigo.vercel.app',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    const client = new VercelClient(
      {
        token: 'token',
        projectId: 'prj_demo',
        teamId: null,
        timeoutMs: 5_000,
      },
      fetchImpl as unknown as typeof fetch
    )

    const deployments = await client.listDeployments({ limit: 1 })
    expect(deployments).toHaveLength(1)
    expect(deployments[0]?.id).toBe('dpl_uid_only')
    expect(deployments[0]?.createdAt?.toISOString()).toBe('2026-02-09T11:39:02.460Z')
  })

  it('filters out rows without id and uid', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          deployments: [{ name: 'invalid-row', url: 'example.vercel.app' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    const client = new VercelClient(
      {
        token: 'token',
        projectId: 'prj_demo',
        teamId: null,
        timeoutMs: 5_000,
      },
      fetchImpl as unknown as typeof fetch
    )

    const deployments = await client.listDeployments({ limit: 1 })
    expect(deployments).toHaveLength(0)
  })
})
