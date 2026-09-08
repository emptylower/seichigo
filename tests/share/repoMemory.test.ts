import { describe, expect, it } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'

function baseInput(overrides: Partial<Parameters<MemoryShareLinkRepo['create']>[0]> = {}) {
  return {
    code: 'AAAAAAAA',
    pointId: '101:station',
    bangumiId: 101,
    locale: 'zh' as const,
    layout: 'portrait' as const,
    userId: null,
    ipHash: 'hash-1',
    ...overrides,
  }
}

describe('MemoryShareLinkRepo', () => {
  it('create 后能按 code 查回', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T00:00:00Z'))
    const created = await repo.create(baseInput())
    expect(created.code).toBe('AAAAAAAA')
    expect(created.clicks).toBe(0)
    expect(created.imageKey).toBeNull()
    expect(await repo.findByCode('AAAAAAAA')).toEqual(created)
    expect(await repo.findByCode('ZZZZZZZZ')).toBeNull()
  })

  it('code 重复抛 P2002', async () => {
    const repo = new MemoryShareLinkRepo()
    await repo.create(baseInput())
    await expect(repo.create(baseInput())).rejects.toMatchObject({ code: 'P2002' })
  })

  it('findRecentDuplicate 只匹配同 point/locale/layout/user 且在窗口内', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput())
    const since = new Date('2026-09-07T12:00:00Z')
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'portrait', userId: null, ipHash: 'hash-1', since }),
    ).not.toBeNull()
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'landscape', userId: null, ipHash: 'hash-1', since }),
    ).toBeNull()
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'portrait', userId: 'u1', ipHash: null, since }),
    ).toBeNull()
    expect(
      await repo.findRecentDuplicate({
        pointId: '101:station',
        locale: 'zh',
        layout: 'portrait',
        userId: null,
        since: new Date('2026-09-08T13:00:00Z'),
        ipHash: 'hash-1',
      }),
    ).toBeNull()
  })

  it('匿名去重在 userId 为 null 时还要求 ipHash 相同', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput())
    const since = new Date('2026-09-07T12:00:00Z')
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'portrait', userId: null, ipHash: 'hash-2', since }),
    ).toBeNull()
    // 登录用户不受 ipHash 影响（ipHash 恒为 null，按 userId 匹配）
    await repo.create(baseInput({ code: 'DDDDDDDD', userId: 'u1', ipHash: null }))
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'portrait', userId: 'u1', ipHash: null, since }),
    ).not.toBeNull()
  })

  it('countByIpHashSince 只数窗口内同一 ipHash', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput({ code: 'AAAAAAAA' }))
    await repo.create(baseInput({ code: 'BBBBBBBB', layout: 'landscape' }))
    await repo.create(baseInput({ code: 'CCCCCCCC', ipHash: 'hash-2' }))
    expect(await repo.countByIpHashSince('hash-1', new Date('2026-09-07T12:00:00Z'))).toBe(2)
    expect(await repo.countByIpHashSince('hash-1', new Date('2026-09-08T13:00:00Z'))).toBe(0)
  })

  it('markUploaded 回填并自增 uploadCount，countUploadsByUserSince 按次数求和', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput({ code: 'AAAAAAAA' }))
    await repo.create(baseInput({ code: 'BBBBBBBB', userId: 'u1', ipHash: null, layout: 'landscape' }))
    const since = new Date('2026-09-07T12:00:00Z')
    expect(await repo.countUploadsByUserSince('u1', since)).toBe(0)
    const updated = await repo.markUploaded('AAAAAAAA', { imageKey: 'share/AAAAAAAA-ab12cd34.jpg', userId: 'u1' })
    expect(updated?.imageKey).toBe('share/AAAAAAAA-ab12cd34.jpg')
    expect(updated?.userId).toBe('u1')
    expect(updated?.uploadCount).toBe(1)
    // 建了链但从没上传过的记录不计次
    expect(await repo.countUploadsByUserSince('u1', since)).toBe(1)
    // 同一 code 第二次上传：uploadCount 累加、updatedAt 刷新，配额跟着涨
    await repo.markUploaded('AAAAAAAA', { imageKey: 'share/AAAAAAAA-99887766.jpg', userId: 'u1' })
    expect((await repo.findByCode('AAAAAAAA'))?.uploadCount).toBe(2)
    expect(await repo.countUploadsByUserSince('u1', since)).toBe(2)
    expect(await repo.markUploaded('ZZZZZZZZ', { imageKey: 'x', userId: 'u1' })).toBeNull()
  })

  it('incrementClicks 累加', async () => {
    const repo = new MemoryShareLinkRepo()
    await repo.create(baseInput())
    await repo.incrementClicks('AAAAAAAA')
    await repo.incrementClicks('AAAAAAAA')
    expect((await repo.findByCode('AAAAAAAA'))?.clicks).toBe(2)
    await expect(repo.incrementClicks('ZZZZZZZZ')).resolves.toBeUndefined()
  })

  it('markUploaded 传 null imageKey 时只自增 uploadCount', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    const created = await repo.create(
      baseInput({ code: 'AbC12xYz', userId: 'u1', ipHash: null }),
    )
    expect(created.imageKey).toBeNull()
    const updated = await repo.markUploaded('AbC12xYz', { imageKey: null, userId: 'u1' })
    expect(updated?.imageKey).toBeNull()
    expect(updated?.uploadCount).toBe(1)
  })
})
