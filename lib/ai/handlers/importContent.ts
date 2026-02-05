import { NextResponse } from 'next/server'
import { gunzipSync } from 'zlib'
import type { AiApiDeps } from '@/lib/ai/api'
import { authorizeAiRequest } from '@/lib/ai/auth'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

type Ctx = { params?: Promise<{ id: string }> }

function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

function extractContentJson(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  if (!('contentJson' in payload)) return payload
  return (payload as { contentJson?: unknown }).contentJson
}

async function readJsonFromBytes(bytes: Buffer): Promise<unknown> {
  const text = bytes.toString('utf8').trim()
  if (!text) {
    throw new Error('请求体为空')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('JSON 解析失败')
  }
}

async function readImportPayload(req: Request): Promise<unknown> {
  const contentType = String(req.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()

    const file = form.get('file')
    if (file instanceof File) {
      const buf = Buffer.from(await file.arrayBuffer())
      const bytes = file.name.toLowerCase().endsWith('.gz') || isGzip(buf) ? gunzipSync(buf) : buf
      return readJsonFromBytes(bytes)
    }

    const raw = form.get('contentJson') ?? form.get('content') ?? null
    if (typeof raw === 'string') {
      return readJsonFromBytes(Buffer.from(raw, 'utf8'))
    }

    throw new Error('缺少上传文件（file）或 contentJson')
  }

  const buf = Buffer.from(await req.arrayBuffer())
  if (!buf.length) {
    throw new Error('请求体为空')
  }

  const encoding = String(req.headers.get('content-encoding') || '').toLowerCase()
  const bytes = encoding.includes('gzip') || isGzip(buf) ? gunzipSync(buf) : buf
  return readJsonFromBytes(bytes)
}

function computeWeakEtag(article: { id: string; updatedAt: Date }): string {
  return `W/"${article.id}:${article.updatedAt.getTime()}"`
}

export function createHandlers(deps: AiApiDeps) {
  return {
    async POST(req: Request, ctx: Ctx) {
      const auth = await authorizeAiRequest(req, deps)
      if (!auth.ok) {
        const status = auth.reason === 'forbidden' ? 403 : 401
        const error = auth.reason === 'forbidden' ? 'Forbidden: Admin access required' : 'Unauthorized'
        return NextResponse.json({ error }, { status })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const existing = await deps.repo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      if (existing.status !== 'draft' && existing.status !== 'rejected') {
        return NextResponse.json({ error: '当前状态不可编辑' }, { status: 409 })
      }

      let payload: unknown
      try {
        payload = await readImportPayload(req)
      } catch (err) {
        const msg = err instanceof Error ? err.message : '参数错误'
        return NextResponse.json({ error: msg || '参数错误' }, { status: 400 })
      }

      const contentJson = extractContentJson(payload)
      if (contentJson == null) {
        return NextResponse.json({ error: 'contentJson 不能为空' }, { status: 400 })
      }

      const contentHtml = renderArticleContentHtmlFromJson(contentJson)
      const updated = await deps.repo.updateDraft(id, { contentJson, contentHtml })
      if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })

      const etag = computeWeakEtag(updated)
      return NextResponse.json(
        { ok: true, article: { id: updated.id, status: updated.status, updatedAt: updated.updatedAt, revision: updated.updatedAt } },
        { headers: { ETag: etag } }
      )
    },
  }
}
