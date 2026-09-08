import { describe, expect, it, vi } from 'vitest'
import {
  SHARE_CODE_LENGTH,
  allocateShareCode,
  generateShareCode,
  isShareCode,
} from '@/lib/share/shortCode'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

describe('generateShareCode', () => {
  it('产出 8 位 base62', () => {
    const code = generateShareCode()
    expect(code).toHaveLength(SHARE_CODE_LENGTH)
    expect(code).toMatch(/^[A-Za-z0-9]{8}$/)
  })

  it('丢弃 >=248 的字节以保证 62 个字符等概率', () => {
    // 前 8 个字节全部越界，必须被跳过，最终取到的是后面的 0..7
    const bytes = Uint8Array.from([248, 249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7])
    const code = generateShareCode(() => bytes)
    expect(code).toBe(ALPHABET.slice(0, 8))
  })

  it('1000 次不产生非法字符', () => {
    for (let i = 0; i < 1000; i++) {
      expect(isShareCode(generateShareCode())).toBe(true)
    }
  })
})

describe('isShareCode', () => {
  it('只认 8 位字母数字', () => {
    expect(isShareCode('AbC12xYz')).toBe(true)
    expect(isShareCode('AbC12xY')).toBe(false)
    expect(isShareCode('AbC12xY-')).toBe(false)
    expect(isShareCode(null)).toBe(false)
  })
})

describe('allocateShareCode', () => {
  it('首次成功直接返回', async () => {
    const insert = vi.fn(async (code: string) => ({ code }))
    const result = await allocateShareCode(insert, { generate: () => 'AAAAAAAA' })
    expect(result).toEqual({ code: 'AAAAAAAA' })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('唯一键冲突最多重试到第 3 次', async () => {
    const codes = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC']
    let index = 0
    const insert = vi.fn(async (code: string) => {
      if (code !== 'CCCCCCCC') {
        throw Object.assign(new Error('unique'), { code: 'P2002' })
      }
      return { code }
    })
    const result = await allocateShareCode(insert, { generate: () => codes[index++]! })
    expect(result).toEqual({ code: 'CCCCCCCC' })
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('第 3 次仍冲突就把最后一个错误抛出去', async () => {
    const insert = vi.fn(async () => {
      throw Object.assign(new Error('unique'), { code: 'P2002' })
    })
    await expect(allocateShareCode(insert, { generate: () => 'AAAAAAAA' })).rejects.toThrow('unique')
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('非冲突错误立刻上抛，不重试', async () => {
    const insert = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(allocateShareCode(insert, { generate: () => 'AAAAAAAA' })).rejects.toThrow('db down')
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
