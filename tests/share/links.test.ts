import { describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { ANON_DAILY_LINK_LIMIT, createPostShareLinkHandler } from '@/lib/share/handlers/links'
import type { ShareApiDeps } from '@/lib/share/api'

const NOW = new Date('2026-09-08T12:00:00Z')

function makeDeps(overrides?: { repo?: MemoryShareLinkRepo; userId?: string | null }): ShareApiDeps {
  const repo = overrides?.repo ?? new MemoryShareLinkRepo(() => NOW)
  return {
    repo,
    pointStateRepo: {} as ShareApiDeps['pointStateRepo'],
    getStore: () => null,
    getSession: async () =>
      overrides?.userId ? ({ user: { id: overrides.userId } } as any) : null,
    now: () => NOW,
    origin: 'https://seichigo.com',
  }
}

function makeRequest(body: unknown, ip: string | null = '1.2.3.4') {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (ip !== null) headers['cf-connecting-ip'] = ip
  return new Request('https://seichigo.com/api/share/links', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const VALID = { pointId: '101:station', bangumiId: 101, locale: 'zh', layout: 'portrait' }

describe('POST /api/share/links', () => {
  it('匿名也能建，返回 201 与绝对短链', async () => {
    const handler = createPostShareLinkHandler(makeDeps())
    const res = await handler(makeRequest(VALID))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.code).toMatch(/^[A-Za-z0-9]{8}$/)
    expect(json.url).toBe(`https://seichigo.com/s/${json.code}`)
  })

  it('24 小时内同 point/locale/layout/匿名 复用旧记录，返回 200', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo }))
    const first = await (await handler(makeRequest(VALID))).json()
    const res = await handler(makeRequest(VALID))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe(first.code)
  })

  it('同 point 下不同匿名 ipHash 得到不同 code', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo }))
    const a = await (await handler(makeRequest(VALID, '1.1.1.1'))).json()
    const b = await (await handler(makeRequest(VALID, '2.2.2.2'))).json()
    expect(a.code).toMatch(/^[A-Za-z0-9]{8}$/)
    expect(b.code).not.toBe(a.code)
  })

  it('换版式就是新记录', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo }))
    const a = await (await handler(makeRequest(VALID))).json()
    const b = await (await handler(makeRequest({ ...VALID, layout: 'landscape' }))).json()
    expect(b.code).not.toBe(a.code)
  })

  it('登录用户不写 ipHash', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo, userId: 'u1' }))
    const { code } = await (await handler(makeRequest(VALID))).json()
    const row = await repo.findByCode(code)
    expect(row?.userId).toBe('u1')
    expect(row?.ipHash).toBeNull()
  })

  it('匿名超过每日上限返回 429', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const deps = makeDeps({ repo })
    vi.spyOn(repo, 'countByIpHashSince').mockResolvedValue(ANON_DAILY_LINK_LIMIT)
    const res = await createPostShareLinkHandler(deps)(makeRequest({ ...VALID, layout: 'landscape' }))
    expect(res.status).toBe(429)
  })

  it('参数不合法返回 400 且不透传 zod 错误细节', async () => {
    const handler = createPostShareLinkHandler(makeDeps())
    for (const body of [
      { ...VALID, layout: 'square' },
      { ...VALID, bangumiId: 0 },
      { ...VALID, locale: 'ko' },
      { ...VALID, pointId: '' },
      { ...VALID, pointId: 'a/b' },
    ]) {
      const res = await handler(makeRequest(body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: '参数不合法' })
    }
  })

  it('匿名请求识别不到来源 IP 时返回 429，登录用户不受影响', async () => {
    const anonRepo = new MemoryShareLinkRepo(() => NOW)
    const anonHandler = createPostShareLinkHandler(makeDeps({ repo: anonRepo }))
    const res = await anonHandler(makeRequest(VALID, null))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: '无法识别来源，暂不能创建分享' })
    expect(await anonRepo.findByCode('AbC12xYz')).toBeNull()

    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo, userId: 'u1' }))
    expect((await handler(makeRequest(VALID, null))).status).toBe(201)
  })

  it('pointId 含 / 或 .. 等非法字符返回 400', async () => {
    const handler = createPostShareLinkHandler(makeDeps())
    expect((await handler(makeRequest({ ...VALID, pointId: '../etc/passwd' }))).status).toBe(400)
    expect((await handler(makeRequest({ ...VALID, pointId: 'a/b' }))).status).toBe(400)
    expect((await handler(makeRequest({ ...VALID, pointId: 'a..b' }))).status).toBe(400)
    // 合法字符集：字母数字与 _ : . -
    expect((await handler(makeRequest({ ...VALID, pointId: '101:station-2.x' }))).status).toBe(201)
  })

  it('短码冲突时换码重试而不是 500', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const original = repo.create.bind(repo)
    let calls = 0
    vi.spyOn(repo, 'create').mockImplementation(async (input) => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('unique'), { code: 'P2002' })
      return original(input)
    })
    const res = await createPostShareLinkHandler(makeDeps({ repo }))(makeRequest(VALID))
    expect(res.status).toBe(201)
    expect(calls).toBe(2)
  })
})
