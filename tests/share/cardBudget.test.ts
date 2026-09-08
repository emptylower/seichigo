import { beforeEach, describe, expect, it } from 'vitest'
import {
  ANON_DAILY_CARD_LIMIT,
  DAILY_RENDER_BUDGET,
  bumpRenderBudget,
  cardBudgetKey,
  checkCardRate,
  readRenderBudget,
  resetCardRate,
} from '@/lib/share/cardBudget'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

function makeStore(seed?: Record<string, string>) {
  const objects = new Map<string, string>(Object.entries(seed ?? {}))
  const store: ShareStore = {
    async put(key, bytes) {
      objects.set(key, new TextDecoder().decode(bytes))
    },
    async get(key) {
      const found = objects.get(key)
      if (found === undefined) return null
      const bytes = new TextEncoder().encode(found)
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
        contentType: 'application/json',
        size: bytes.byteLength,
      }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

beforeEach(() => resetCardRate())

describe('checkCardRate', () => {
  it('同一 IP 当日放行到上限，之后拒绝', () => {
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) {
      expect(checkCardRate('ip-a', NOW), `第 ${i + 1} 次`).toBe(true)
    }
    expect(checkCardRate('ip-a', NOW)).toBe(false)
  })

  it('不同 IP 各算各的', () => {
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) checkCardRate('ip-a', NOW)
    expect(checkCardRate('ip-b', NOW)).toBe(true)
  })

  it('跨日重置', () => {
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) checkCardRate('ip-a', NOW)
    expect(checkCardRate('ip-a', new Date('2026-09-09T00:01:00Z'))).toBe(true)
  })
})

describe('cardBudgetKey', () => {
  it('按 UTC 日期分对象', () => {
    expect(cardBudgetKey(NOW)).toBe('og-cards/_budget/2026-09-08.json')
    expect(cardBudgetKey(new Date('2026-09-08T23:59:59Z'))).toBe('og-cards/_budget/2026-09-08.json')
  })
})

describe('readRenderBudget / bumpRenderBudget', () => {
  it('没有对象时读到 0', async () => {
    const { store } = makeStore()
    expect(await readRenderBudget(store, NOW)).toBe(0)
  })

  it('读得回已有计数', async () => {
    const { store } = makeStore({ 'og-cards/_budget/2026-09-08.json': '{"count":42}' })
    expect(await readRenderBudget(store, NOW)).toBe(42)
  })

  it('坏 JSON 当 0，不抛', async () => {
    const { store } = makeStore({ 'og-cards/_budget/2026-09-08.json': 'not json' })
    expect(await readRenderBudget(store, NOW)).toBe(0)
  })

  it('bump 写回 +1', async () => {
    const { store, objects } = makeStore()
    await bumpRenderBudget(store, NOW)
    await bumpRenderBudget(store, NOW)
    expect(objects.get('og-cards/_budget/2026-09-08.json')).toBe('{"count":2}')
  })

  it('预算常量为 3000', () => {
    expect(DAILY_RENDER_BUDGET).toBe(3000)
  })
})
