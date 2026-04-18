import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers as createDownloadHandlers } from '@/lib/anitabi/handlers/imageDownload'

const mocks = vi.hoisted(() => ({
  getAnitabiApiDeps: vi.fn(),
  lookup: vi.fn(),
  cacheMatch: vi.fn(),
  cachePut: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}))

vi.mock('@/lib/anitabi/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/anitabi/api')>('@/lib/anitabi/api')
  return {
    ...actual,
    getAnitabiApiDeps: mocks.getAnitabiApiDeps,
  }
})

const SAFE_LOOKUP_RESULT = [{ address: '93.184.216.34', family: 4 as const }]
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

function createDeps(): AnitabiApiDeps {
  return {
    prisma: {} as never,
    getSession: async () => null,
    now: () => new Date(),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
  }
}

function setResponseUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', {
    value: url,
    configurable: true,
  })
  return response
}

function createImageResponse(input?: {
  url?: string
  contentType?: string
  contentLength?: number
  contentDisposition?: string | null
  body?: Uint8Array
  omitContentLength?: boolean
  streamBody?: ReadableStream<Uint8Array>
}) {
  const headers = new Headers({
    'content-type': input?.contentType ?? 'image/png',
  })

  if (!input?.omitContentLength) {
    headers.set('content-length', String(input?.contentLength ?? input?.body?.byteLength ?? PNG_BYTES.byteLength))
  }

  if (input?.contentDisposition) {
    headers.set('content-disposition', input.contentDisposition)
  }

  return setResponseUrl(
    new Response(input?.streamBody ?? input?.body ?? PNG_BYTES, {
      status: 200,
      headers,
    }),
    input?.url ?? 'https://bgm.tv/subject/1/cover.png',
  )
}

function createRedirectResponse(location: string) {
  return new Response('', {
    status: 302,
    headers: {
      location,
    },
  })
}

function createDownloadRequest(url: string, name?: string) {
  const reqUrl = new URL('http://localhost/api/anitabi/image-download')
  reqUrl.searchParams.set('url', url)
  if (name) {
    reqUrl.searchParams.set('name', name)
  }
  return new Request(reqUrl)
}

function createRenderRequest(url: string, name?: string) {
  const reqUrl = new URL('http://localhost/api/anitabi/image-render')
  reqUrl.searchParams.set('url', url)
  if (name) {
    reqUrl.searchParams.set('name', name)
  }
  return new Request(reqUrl)
}

async function importRenderRouteModule() {
  const moduleHref = new URL('../../app/api/anitabi/image-render/route.ts', import.meta.url).href
  return import(moduleHref) as Promise<{ GET(req: Request): Promise<Response> }>
}

describe('anitabi image proxy phase 2', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mocks.lookup.mockResolvedValue(SAFE_LOOKUP_RESULT)
    mocks.getAnitabiApiDeps.mockResolvedValue(createDeps())
    vi.stubGlobal('fetch', vi.fn())
    mocks.cacheMatch.mockResolvedValue(undefined)
    mocks.cachePut.mockResolvedValue(undefined)
    vi.stubGlobal('caches', {
      default: {
        match: (...args: any[]) => mocks.cacheMatch(...args),
        put: (...args: any[]) => mocks.cachePut(...args),
      },
    })
  })

  describe('download lane safety', () => {
    it('rejects non-http(s) urls', async () => {
      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('ftp://bgm.tv/subject/1/cover.png'),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: '参数错误' })
    })

    it('rejects credentialed urls', async () => {
      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('https://user:pass@bgm.tv/subject/1/cover.png'),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: '参数错误' })
    })

    it('rejects localhost and private targets before fetch', async () => {
      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('http://127.0.0.1/internal.png'),
      )

      expect(res.status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
      await expect(res.json()).resolves.toEqual({ error: '不支持该图片来源' })
    })

    it('rejects redirects that resolve to a disallowed host', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createRedirectResponse('http://127.0.0.1/escaped.png'),
      )

      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('https://bgm.tv/subject/1/cover.png'),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: '不支持该图片来源' })
    })

    it('rejects non-image upstream responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          contentType: 'text/html',
        }),
      )

      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('https://bgm.tv/subject/1/cover.png'),
      )

      expect(res.status).toBe(415)
      await expect(res.json()).resolves.toEqual({ error: '文件类型不支持' })
    })

    it('rejects oversized upstream responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          contentLength: MAX_IMAGE_BYTES + 1,
        }),
      )

      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('https://bgm.tv/subject/1/cover.png'),
      )

      expect(res.status).toBe(413)
      await expect(res.json()).resolves.toEqual({ error: '图片文件过大' })
    })

    it('returns timeout error when upstream fetch aborts', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))

      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('https://bgm.tv/subject/1/cover.png'),
      )

      expect(res.status).toBe(504)
      await expect(res.json()).resolves.toEqual({ error: '图片下载超时' })
    })
  })

  describe('render lane contract', () => {
    it('returns cacheable inline image responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      expect(res.headers.get('Content-Disposition')).not.toContain('attachment')
      expect(res.headers.get('Content-Disposition')).toBe('inline')
      expect(res.headers.get('Cache-Control')).toContain('public')
      expect(res.headers.get('Cache-Control')).not.toContain('no-store')
      expect(res.headers.get('X-Seichigo-Render-Cache')).toBe('MISS')
      expect(mocks.cachePut).toHaveBeenCalledTimes(1)
    })

    it('ignores name query semantics for render responses', async () => {
      vi.mocked(fetch).mockImplementation(async () => createImageResponse())
      const { GET } = await importRenderRouteModule()

      const fooResponse = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png', 'foo-name'))
      const canonicalResponse = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(fooResponse.status).toBe(307)
      expect(fooResponse.headers.get('location')).toBe(
        'http://localhost/api/anitabi/image-render?url=https%3A%2F%2Fbgm.tv%2Fsubject%2F1%2Fcover.png',
      )
      expect(canonicalResponse.status).toBe(200)
      expect(canonicalResponse.headers.get('Content-Disposition')).toBe('inline')
      expect(mocks.cacheMatch).toHaveBeenCalledTimes(1)
    })

    it('buffers unknown-length render responses instead of writing Content-Length: 0', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          omitContentLength: true,
        }),
      )
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Length')).toBe(String(PNG_BYTES.byteLength))
      await expect(res.arrayBuffer()).resolves.toEqual(PNG_BYTES.buffer)
    })

    it('serves cached render responses without refetching upstream', async () => {
      mocks.cacheMatch.mockResolvedValueOnce(createImageResponse())
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Seichigo-Render-Cache')).toBe('HIT')
      expect(fetch).not.toHaveBeenCalled()
      expect(mocks.cachePut).not.toHaveBeenCalled()
    })

    it('uses Cloudflare cache hints when fetching uncached render responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(200)
      expect(fetch).toHaveBeenCalledTimes(1)
      const requestInit = vi.mocked(fetch).mock.calls[0]?.[1] as {
        cf?: { cacheEverything?: boolean; cacheTtl?: number; cacheKey?: string }
      }
      expect(requestInit.cf).toMatchObject({
        cacheEverything: true,
        cacheTtl: 86400,
        cacheKey: 'https://bgm.tv/subject/1/cover.png',
      })
    })

    it('rejects credentialed urls for render requests', async () => {
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://user:pass@bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: '参数错误' })
    })

    it('rejects redirects that escape to localhost', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createRedirectResponse('http://localhost/internal.png'),
      )
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: '不支持该图片来源' })
    })

    it('rejects non-image responses for render requests', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          contentType: 'application/json',
        }),
      )
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(415)
      await expect(res.json()).resolves.toEqual({ error: '文件类型不支持' })
    })

    it('rejects oversized render responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          contentLength: MAX_IMAGE_BYTES + 1,
        }),
      )
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(413)
      await expect(res.json()).resolves.toEqual({ error: '图片文件过大' })
    })

    it('fast-fails render timeouts', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      const { GET } = await importRenderRouteModule()

      const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))

      expect(res.status).toBe(504)
      await expect(res.json()).resolves.toEqual({ error: '图片代理超时' })
    })

    it('aborts slow streaming bodies after the render timeout window', async () => {
      process.env.ANITABI_IMAGE_RENDER_TIMEOUT_MS = '20'
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          contentLength: 1,
          streamBody: new ReadableStream<Uint8Array>({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, 50))
              controller.enqueue(Uint8Array.from([1]))
              controller.close()
            },
          }),
        }),
      )
      const { GET } = await importRenderRouteModule()

      try {
        const res = await GET(createRenderRequest('https://bgm.tv/subject/1/cover.png'))
        expect(res.status).toBe(200)
        await expect(res.arrayBuffer()).rejects.toBeDefined()
      } finally {
        delete process.env.ANITABI_IMAGE_RENDER_TIMEOUT_MS
      }
    })
  })

  describe('download lane contract', () => {
    it('keeps attachment filename and private no-store headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createImageResponse({
          contentDisposition: `attachment; filename*=UTF-8''upstream-cover.webp`,
          contentType: 'image/webp',
        }),
      )

      const res = await createDownloadHandlers(createDeps()).GET(
        createDownloadRequest('https://bgm.tv/subject/1/cover', 'download-name'),
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/webp')
      expect(res.headers.get('Content-Disposition')).toContain('attachment;')
      expect(res.headers.get('Content-Disposition')).toContain('upstream-cover.webp')
      expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    })
  })
})
