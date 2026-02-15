import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'
import { authorizeAiRequest } from '@/lib/ai/auth'
import { createPostAssetsHandlerWithOwner } from '@/lib/asset/handlers'
import type { AssetRepo } from '@/lib/asset/repo'

export type AiAssetsDeps = AiApiDeps & {
  assetRepo: AssetRepo
}

function resolveTokenOwnerId(req: Request): string | null {
  const headerKeys = ['x-seichigo-owner-id', 'x-owner-id', 'x-author-id']
  for (const key of headerKeys) {
    const value = String(req.headers.get(key) || '').trim()
    if (value) return value
  }

  try {
    const url = new URL(req.url)
    const queryValue = String(url.searchParams.get('ownerId') || url.searchParams.get('authorId') || '').trim()
    if (queryValue) return queryValue
  } catch {
    return null
  }

  return null
}

export function createHandlers(deps: AiAssetsDeps) {
  const postAssets = createPostAssetsHandlerWithOwner({
    assetRepo: deps.assetRepo,
    resolveOwnerId: async (req) => {
      const auth = await authorizeAiRequest(req, deps)
      if (!auth.ok) {
        const status = auth.reason === 'forbidden' ? 403 : 401
        const error = auth.reason === 'forbidden' ? '无权限' : '请先登录'
        return { ok: false, response: NextResponse.json({ error }, { status }) }
      }

      if (auth.mode === 'session') {
        const ownerId = String(auth.session.user?.id || '').trim()
        if (!ownerId) {
          return { ok: false, response: NextResponse.json({ error: '请先登录' }, { status: 401 }) }
        }
        return { ok: true, ownerId }
      }

      const ownerId = resolveTokenOwnerId(req)
      if (!ownerId) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: '缺少 ownerId（请通过 X-SEICHIGO-OWNER-ID 或 ownerId 参数传入）',
            },
            { status: 400 }
          ),
        }
      }

      return { ok: true, ownerId }
    },
  })

  return {
    POST(req: Request) {
      return postAssets(req)
    },
  }
}
