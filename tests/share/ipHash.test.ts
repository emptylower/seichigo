import { describe, expect, it } from 'vitest'
import { hashIp, readClientIp, utcDateStamp } from '@/lib/share/ipHash'

describe('utcDateStamp', () => {
  it('取 UTC 的 YYYY-MM-DD', () => {
    expect(utcDateStamp(new Date('2026-09-08T23:30:00Z'))).toBe('2026-09-08')
    expect(utcDateStamp(new Date('2026-09-09T00:00:01Z'))).toBe('2026-09-09')
  })
})

describe('hashIp', () => {
  it('同 IP 同日稳定，且是 64 位 hex', async () => {
    const day = new Date('2026-09-08T10:00:00Z')
    const a = await hashIp('1.2.3.4', day)
    const b = await hashIp('1.2.3.4', day)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('跨日不同', async () => {
    const a = await hashIp('1.2.3.4', new Date('2026-09-08T10:00:00Z'))
    const b = await hashIp('1.2.3.4', new Date('2026-09-09T10:00:00Z'))
    expect(a).not.toBe(b)
  })

  it('不同 IP 不同', async () => {
    const day = new Date('2026-09-08T10:00:00Z')
    expect(await hashIp('1.2.3.4', day)).not.toBe(await hashIp('1.2.3.5', day))
  })
})

describe('readClientIp', () => {
  it('读 cf-connecting-ip，不受 x-forwarded-for 干扰', () => {
    const req = new Request('https://seichigo.com/api/share/links', {
      headers: { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
    })
    expect(readClientIp(req)).toBe('9.9.9.9')
  })

  it('cf-connecting-ip 缺失时返回 null，不再回落 x-forwarded-for', () => {
    const req = new Request('https://seichigo.com/api/share/links', {
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
    })
    expect(readClientIp(req)).toBeNull()
  })

  it('空白 cf-connecting-ip 视为缺失', () => {
    const req = new Request('https://seichigo.com/api/share/links', {
      headers: { 'cf-connecting-ip': '   ' },
    })
    expect(readClientIp(req)).toBeNull()
  })

  it('什么头都没有时返回 null', () => {
    expect(readClientIp(new Request('https://seichigo.com/api/share/links'))).toBeNull()
  })
})
