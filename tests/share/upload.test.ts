import { describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { USER_DAILY_UPLOAD_LIMIT, createPostShareUploadHandler } from '@/lib/share/handlers/upload'
import type { ShareApiDeps } from '@/lib/share/api'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

function jpeg(width: number, height: number, padTo = 0): Uint8Array {
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]
  const head = Uint8Array.from([0xff, 0xd8, ...sof, 0xff, 0xd9])
  if (padTo <= head.byteLength) return head
  const out = new Uint8Array(padTo)
  out.set(head, 0)
  return out
}

function makeStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(found.bytes)
            c.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
  }
  return { store, objects }
}

function makeDeps(input: {
  repo: MemoryShareLinkRepo
  store: ShareStore | null
  userId: string | null
  upsert?: ReturnType<typeof vi.fn>
}): ShareApiDeps {
  return {
    repo: input.repo,
    pointStateRepo: { upsert: input.upsert ?? vi.fn(async () => ({})) } as any,
    getStore: () => input.store,
    getSession: async () => (input.userId ? ({ user: { id: input.userId } } as any) : null),
    now: () => NOW,
    origin: 'https://seichigo.com',
  }
}

async function seed(repo: MemoryShareLinkRepo, userId: string | null = null) {
  await repo.create({
    code: 'AbC12xYz',
    pointId: '101:station',
    bangumiId: 101,
    locale: 'zh',
    layout: 'portrait',
    userId,
    ipHash: userId ? null : 'h1',
  })
}

function makeRequest(form: FormData) {
  return new Request('https://seichigo.com/api/share/links/AbC12xYz/upload', {
    method: 'POST',
    body: form,
  })
}

const ctx = { params: Promise.resolve({ code: 'AbC12xYz' }) }

function cardForm(bytes: Uint8Array, type = 'image/jpeg') {
  const form = new FormData()
  form.set('card', new File([bytes], 'card.jpg', { type }))
  return form
}

describe('POST /api/share/links/[code]/upload', () => {
  it('未登录 401', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: null }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(401)
  })

  it('短链不存在 404', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(404)
  })

  it('短链已属于别人 403', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo, 'u2')
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(403)
  })

  it('卡片类型不对 415、过大 413、尺寸不对 422', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store } = makeStore()
    const handler = createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1440), 'image/png')), ctx)).status).toBe(415)
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1440, 1_600_000))), ctx)).status).toBe(413)
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1350))), ctx)).status).toBe(422)
  })

  it('合法卡片写进 R2 并回填 imageKey/userId', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store, objects } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1200, 630))),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      imageUrl: '/api/share/img/AbC12xYz',
      photoUrl: null,
    })
    expect(objects.has('share/AbC12xYz.jpg')).toBe(true)
    const row = await repo.findByCode('AbC12xYz')
    expect(row?.imageKey).toBe('share/AbC12xYz.jpg')
    expect(row?.userId).toBe('u1')
  })

  it('带 photo 时写 checkin key 并回写 UserPointState', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store, objects } = makeStore()
    const upsert = vi.fn(async () => ({}))
    const form = cardForm(jpeg(1080, 1440))
    form.set('photo', new File([jpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }))
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1', upsert }))(
      makeRequest(form),
      ctx,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).photoUrl).toBe('/api/share/photo/u1/101%3Astation')
    expect(objects.has('checkin/u1/101:station.jpg')).toBe(true)
    expect(upsert).toHaveBeenCalledWith('u1', '101:station', 'checked_in', {
      photoUrl: '/api/share/photo/u1/101%3Astation',
      checkedInAt: NOW,
    })
  })

  it('photo 只收 JPEG', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store } = makeStore()
    const form = cardForm(jpeg(1080, 1440))
    form.set('photo', new File([jpeg(800, 600)], 'p.webp', { type: 'image/webp' }))
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(form),
      ctx,
    )
    expect(res.status).toBe(415)
  })

  it('每用户每日 30 次上限', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    vi.spyOn(repo, 'countUploadsByUserSince').mockResolvedValue(USER_DAILY_UPLOAD_LIMIT)
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(429)
  })

  it('拿不到 R2 绑定 503', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const res = await createPostShareUploadHandler(makeDeps({ repo, store: null, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(503)
  })
})
