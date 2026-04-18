import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { serveImageRequest } from '@/lib/anitabi/handlers/imageServe'

function remapLaneErrors(
  response: Response,
  messages: { timeout: string; generic: string }
): Response {
  if (response.status === 504) {
    return new Response(JSON.stringify({ error: messages.timeout }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (response.status === 500) {
    return new Response(JSON.stringify({ error: messages.generic }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return response
}

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      return remapLaneErrors(await serveImageRequest(req, deps, 'download'), {
        timeout: '图片下载超时',
        generic: '图片下载失败',
      })
    },
  }
}

export function createRenderProxyHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      return remapLaneErrors(await serveImageRequest(req, deps, 'render'), {
        timeout: '图片代理超时',
        generic: '图片代理失败',
      })
    },
  }
}
