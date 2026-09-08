import { afterEach, describe, expect, it } from 'vitest'
import { checkinPhotoKey, getShareStore, shareCardFingerprint, shareCardKey } from '@/lib/share/store'
import type { CfBindings } from '@/lib/anitabi/cf/bindings'

const CF_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')
type Bucket = NonNullable<NonNullable<CfBindings['env']>['ASSET_STORE']> & {
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>
}

function toStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function installBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const bucket: Bucket = {
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: toStream(found.bytes),
        size: found.bytes.byteLength,
        httpMetadata: { contentType: found.contentType },
      }
    },
    async head(key) {
      const found = objects.get(key)
      if (!found) return null
      return { size: found.bytes.byteLength, httpMetadata: { contentType: found.contentType } }
    },
    async put(key, value, options) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType })
    },
  }
  ;(globalThis as any)[CF_CONTEXT_SYMBOL] = { env: { ASSET_STORE: bucket } } satisfies CfBindings
  return objects
}

afterEach(() => {
  delete (globalThis as any)[CF_CONTEXT_SYMBOL]
})

describe('share key 规则', () => {
  it('卡片 key 带 8 位内容指纹，按 contentType 决定扩展名', () => {
    expect(shareCardKey('AbC12xYz', 'ab12cd34', 'image/jpeg')).toBe('share/AbC12xYz-ab12cd34.jpg')
    expect(shareCardKey('AbC12xYz', 'ab12cd34', 'image/webp')).toBe('share/AbC12xYz-ab12cd34.webp')
  })

  it('shareCardFingerprint 解析新格式 key，旧格式返回 null', () => {
    expect(shareCardFingerprint('share/AbC12xYz-ab12cd34.jpg')).toBe('ab12cd34')
    expect(shareCardFingerprint('share/AbC12xYz-00000000.webp')).toBe('00000000')
    expect(shareCardFingerprint('share/AbC12xYz.jpg')).toBeNull()
    expect(shareCardFingerprint('checkin/u1/101:station.jpg')).toBeNull()
  })

  it('实拍固定 jpg，pointId 里的冒号原样进 key', () => {
    expect(checkinPhotoKey('u1', '101:station')).toBe('checkin/u1/101:station.jpg')
  })
})

describe('getShareStore', () => {
  it('没有 ASSET_STORE 绑定时返回 null', () => {
    expect(getShareStore()).toBeNull()
  })

  it('写进去能读回来，contentType 保留', async () => {
    installBucket()
    const store = getShareStore()
    expect(store).not.toBeNull()
    await store!.put('share/AbC12xYz.jpg', Uint8Array.from([1, 2, 3]), 'image/jpeg')
    const got = await store!.get('share/AbC12xYz.jpg')
    expect(got?.contentType).toBe('image/jpeg')
    expect(Array.from(await readAll(got!.body))).toEqual([1, 2, 3])
    expect(await store!.get('share/none.jpg')).toBeNull()
  })

  it('head 只回元数据不读 body，存在性探测用这个', async () => {
    installBucket()
    const store = getShareStore()
    expect(store).not.toBeNull()
    await store!.put('share/AbC12xYz.jpg', Uint8Array.from([1, 2, 3, 4]), 'image/jpeg')
    await expect(store!.head('share/AbC12xYz.jpg')).resolves.toEqual({
      size: 4,
      contentType: 'image/jpeg',
    })
    await expect(store!.head('share/none.jpg')).resolves.toBeNull()
  })
})
