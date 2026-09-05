import { NextResponse } from 'next/server'
import { discoverModels } from '../discover'
import { decryptSecret } from '../secretBox'
import type { LlmAdminApiDeps } from './adminProviders'
import { redactKeyLikeStrings } from './adminProviders'
import { isAdminSession } from './common'
import { InputError, validateProtocol } from './validate'

/**
 * 第七轮 A4：POST /api/admin/llm/providers/discover-models
 * body { baseUrl, protocol, apiKey?, providerId? }（apiKey 省略时用 providerId
 * 已存的 key）→ { ok: true, models, endpointUrl }；失败 HTTP 200 { ok, message }。
 */
export function createDiscoverModelsHandler(deps: LlmAdminApiDeps) {
  return async function POST(req: Request): Promise<Response> {
    const session = await deps.getSession()
    if (!isAdminSession(session)) {
      return NextResponse.json({ error: '未登录或无权限' }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
    }
    if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) {
      return NextResponse.json({ error: '接口地址（baseUrl）不能为空' }, { status: 400 })
    }

    let protocol: 'openai' | 'anthropic'
    try {
      protocol = validateProtocol(body.protocol)
    } catch (err) {
      if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    // apiKey 优先取请求体（新建态）；缺省时解密 providerId 已存的 key（编辑态）
    let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!apiKey && typeof body.providerId === 'string' && body.providerId) {
      const row = await deps.repo.get(body.providerId)
      if (!row?.apiKeyCiphertext) {
        return NextResponse.json({ ok: false, message: '该供应商尚未保存 API key，请先填写 key 再拉取' })
      }
      try {
        apiKey = await decryptSecret(row.apiKeyCiphertext)
      } catch {
        return NextResponse.json({
          ok: false,
          message: '保存的 API key 无法解密（加密密钥可能已轮换），请重新填写 key',
        })
      }
    }
    if (!apiKey) {
      return NextResponse.json({ ok: false, message: '缺少 API key：请填写 apiKey 或提供已保存 key 的 providerId' })
    }

    const result = await discoverModels({
      protocol,
      baseUrl: body.baseUrl.trim(),
      apiKey,
      fetchImpl: deps.fetchImpl,
    })
    if (!result.ok) {
      // 上游错误文案可能回显明文 key（401 常见）：先整串替换再走前缀正则兜底
      const message = redactKeyLikeStrings(apiKey ? result.message.split(apiKey).join('[redacted]') : result.message)
      return NextResponse.json({ ok: false, message })
    }
    return NextResponse.json({ ok: true, models: result.models, endpointUrl: result.endpointUrl })
  }
}
