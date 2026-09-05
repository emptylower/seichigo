import { NextResponse } from 'next/server'
import type { LlmProviderRepo, LlmProviderRow } from '../repo'
import { toProviderView } from '../repo'
import { seedProvidersFromEnv } from '../seed'
import { invalidateLlmRegistry } from '../registry'
import { createLlmClient } from '../client'
import { LlmHttpError } from '../http'
import { encryptSecret, decryptSecret, apiKeyHintOf } from '../secretBox'
import type { LlmModelConfig, LlmProviderView } from '../types'
import { isAdminSession } from './common'
import {
  InputError,
  normalizeEndpointUrl,
  validateApiKeyForCreate,
  validateApiKeyForUpdate,
  validateEndpointUrl,
  validateModelInList,
  validateModels,
  validateName,
  validateProtocol,
} from './validate'

export type LlmAdminApiDeps = {
  getSession: () => Promise<unknown>
  repo: LlmProviderRepo
  fetchImpl?: typeof fetch
  now?: () => Date
}

const TEST_TIMEOUT_MS = 20_000

function unauthorized() {
  return NextResponse.json({ error: '未登录或无权限' }, { status: 401 })
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function notFound() {
  return NextResponse.json({ error: '供应商不存在' }, { status: 404 })
}

function effectiveOf(rows: LlmProviderRow[]) {
  // 与运行时（registry.pickTakeoverRow）同口径：无 key 的接管不生效
  const agent = rows.find((row) => row.takeoverAgent && row.enabled && row.apiKeyCiphertext)
  const translation = rows.find(
    (row) => row.takeoverTranslation && row.enabled && row.apiKeyCiphertext,
  )
  return {
    agent: agent ? { providerId: agent.id, model: agent.agentModel ?? agent.models[0]?.name ?? null } : null,
    translation: translation
      ? {
          providerId: translation.id,
          model: translation.translationModel ?? translation.models[0]?.name ?? null,
        }
      : null,
  }
}

async function keyBoxOf(apiKey: string) {
  return { apiKeyCiphertext: await encryptSecret(apiKey), apiKeyHint: apiKeyHintOf(apiKey) }
}

/** 剔除错误文案里形如 key 的片段（sk-…/Bearer …），防止泄漏到面板。discover-models 复用。 */
export function redactKeyLikeStrings(text: string): string {
  return text
    .replace(/\b(?:sk|rk|pk|ak)-[A-Za-z0-9_\-]{6,}\b/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .slice(0, 300)
}

/**
 * L6：baseUrl 入库前剥掉 userinfo（`https://user:pass@host/path` →
 * `https://host/path`）——URL 的 origin 不含凭据，重新拼 origin+pathname+
 * search 即可；防把中转站的 Basic Auth 凭据顺带存进库里。
 */
function stripUrlCredentials(raw: string): string {
  try {
    const parsed = new URL(raw)
    return `${parsed.origin}${parsed.pathname}${parsed.search}`
  } catch {
    throw new InputError('接口地址格式不合法')
  }
}

/**
 * 第七轮 A4：URL 入参归一。POST/PUT 都接受 baseUrl（推荐，可为基地址），
 * endpointUrl 仅为旧客户端兼容——二者取其一：
 * - 给了 baseUrl → 归一成完整请求 URL（归一内部自带 SSRF/https 守卫），
 *   入库前再剥掉 userinfo（L6）；
 * - 只给 endpointUrl（完整 URL）→ 直接校验使用，baseUrl 记同一值（同样剥凭据）；
 * - 都不给 → PUT 保持原值，POST 报错。
 */
function resolveProviderUrls(
  body: Record<string, unknown>,
  protocol: 'openai' | 'anthropic',
  existing: { baseUrl: string | null; endpointUrl: string } | null,
): { baseUrl: string; endpointUrl: string } {
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    const baseUrl = stripUrlCredentials(body.baseUrl.trim())
    return { baseUrl, endpointUrl: validateEndpointUrl(normalizeEndpointUrl(protocol, baseUrl)) }
  }
  if (body.endpointUrl !== undefined) {
    const endpointUrl = validateEndpointUrl(body.endpointUrl)
    return { baseUrl: stripUrlCredentials(endpointUrl), endpointUrl }
  }
  if (existing) {
    return { baseUrl: existing.baseUrl ?? existing.endpointUrl, endpointUrl: existing.endpointUrl }
  }
  throw new InputError('接口地址（baseUrl）不能为空')
}

export function createHandlers(deps: LlmAdminApiDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => new Date())

  return {
    /** 列表 + 当前接管摘要；首次调用（表空）先从环境变量内化内置供应商。 */
    async GET() {
      const session = await deps.getSession()
      if (!isAdminSession(session)) return unauthorized()

      await seedProvidersFromEnv(deps.repo)
      const rows = await deps.repo.list()
      const providers: LlmProviderView[] = rows.map(toProviderView)
      return NextResponse.json({ ok: true, providers, effective: effectiveOf(rows) })
    },

    /** 新建供应商。apiKey 必填（一个供应商一个 key）。 */
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) return unauthorized()

      let body: Record<string, unknown>
      try {
        body = (await req.json()) as Record<string, unknown>
      } catch {
        return badRequest('请求体必须是 JSON')
      }

      try {
        const name = validateName(body.name)
        const protocol = validateProtocol(body.protocol)
        const { baseUrl, endpointUrl } = resolveProviderUrls(body, protocol, null)
        const models = validateModels(body.models)
        const apiKey = validateApiKeyForCreate(body.apiKey)
        const enabled = body.enabled === undefined ? true : Boolean(body.enabled)

        const row = await deps.repo.create({
          name,
          protocol,
          baseUrl,
          endpointUrl,
          ...(await keyBoxOf(apiKey)),
          models,
          enabled,
        })
        invalidateLlmRegistry()
        return NextResponse.json({ ok: true, provider: toProviderView(row) })
      } catch (err) {
        if (err instanceof InputError) return badRequest(err.message)
        throw err
      }
    },

    /** 部分更新；takeover 互斥（置 true 时清掉其他供应商的同 scope 位）。 */
    async PUT(req: Request, id: string) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) return unauthorized()

      const existing = await deps.repo.get(id)
      if (!existing) return notFound()

      let body: Record<string, unknown>
      try {
        body = (await req.json()) as Record<string, unknown>
      } catch {
        return badRequest('请求体必须是 JSON')
      }

      try {
        const name = body.name !== undefined ? validateName(body.name) : existing.name
        const protocol =
          body.protocol !== undefined ? validateProtocol(body.protocol) : existing.protocol
        const { baseUrl, endpointUrl } = resolveProviderUrls(
          body,
          protocol === 'anthropic' ? 'anthropic' : 'openai',
          existing,
        )
        const models = body.models !== undefined ? validateModels(body.models) : existing.models
        const enabled = body.enabled !== undefined ? Boolean(body.enabled) : existing.enabled

        const takeoverBody = (body.takeover ?? {}) as Record<string, unknown>
        const takeoverAgent =
          takeoverBody.agent !== undefined ? Boolean(takeoverBody.agent) : existing.takeoverAgent
        const takeoverTranslation =
          takeoverBody.translation !== undefined
            ? Boolean(takeoverBody.translation)
            : existing.takeoverTranslation

        const agentModel =
          body.agentModel === undefined
            ? existing.agentModel
            : body.agentModel === null
              ? null
              : validateModelInList(body.agentModel, models, 'agentModel')
        const translationModel =
          body.translationModel === undefined
            ? existing.translationModel
            : body.translationModel === null
              ? null
              : validateModelInList(body.translationModel, models, 'translationModel')

        if (takeoverAgent && !agentModel) {
          return badRequest('接管 Agent 时必须指定 agentModel')
        }
        if (takeoverTranslation && !translationModel) {
          return badRequest('接管翻译时必须指定 translationModel')
        }

        const apiKey = validateApiKeyForUpdate(body.apiKey)
        const patch = {
          name,
          protocol,
          baseUrl,
          endpointUrl,
          models,
          enabled,
          takeoverAgent,
          takeoverTranslation,
          agentModel,
          translationModel,
          ...(apiKey ? await keyBoxOf(apiKey) : {}),
        }

        // 互斥清除放在写成功之后：update 落空（行已被并发删除 → 404）时
        // 不动其他供应商的接管位
        const row = await deps.repo.update(id, patch)
        if (!row) return notFound()

        if (takeoverAgent && !existing.takeoverAgent) {
          await deps.repo.clearTakeover('agent', id)
        }
        if (takeoverTranslation && !existing.takeoverTranslation) {
          await deps.repo.clearTakeover('translation', id)
        }
        invalidateLlmRegistry()
        return NextResponse.json({ ok: true, provider: toProviderView(row) })
      } catch (err) {
        if (err instanceof InputError) return badRequest(err.message)
        throw err
      }
    },

    /** 删除；被删供应商若正接管某范围，该范围自动回退环境变量。 */
    async DELETE(id: string) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) return unauthorized()

      const deleted = await deps.repo.delete(id)
      if (!deleted) return notFound()
      invalidateLlmRegistry()
      return NextResponse.json({ ok: true })
    },

    /**
     * 连通性测试：用保存的 key 发一条最小请求（"回复 OK"，max_tokens 64——
     * 第七轮 A5：推理模型的 reasoning 也耗 completion 预算，8 根本不够出正文），
     * 计时并落 lastTest。HTTP 200 即使失败——失败信息在 result.message。
     */
    async TEST(req: Request, id: string) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) return unauthorized()

      const row = await deps.repo.get(id)
      if (!row) return notFound()

      let model: string
      try {
        const body = (await req.json()) as { model?: unknown }
        model = validateModelInList(body.model, row.models as LlmModelConfig[], 'model')
      } catch (err) {
        if (err instanceof InputError) return badRequest(err.message)
        throw err
      }

      let apiKey = ''
      if (row.apiKeyCiphertext) {
        try {
          apiKey = await decryptSecret(row.apiKeyCiphertext)
        } catch {
          return badRequest('保存的 API key 无法解密（加密密钥可能已轮换），请重新填写 key')
        }
      } else {
        return badRequest('该供应商尚未设置 API key')
      }

      const startedAt = Date.now()
      let result: { ok: boolean; latencyMs: number; message: string | null; sample?: string }
      try {
        const client = createLlmClient({
          protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
          endpointUrl: row.endpointUrl,
          apiKey,
          fetchImpl,
        })
        const sample = await client.completeText({
          model,
          prompt: '回复 OK',
          maxTokens: 64,
          signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        })
        result = {
          ok: true,
          latencyMs: Date.now() - startedAt,
          message: null,
          // 第七轮 A5：推理模型可能只输出 reasoning、content 为空——显式标注而不是留白
          sample: sample.trim() ? sample.slice(0, 40) : '(仅推理无正文)',
        }
      } catch (err) {
        const raw =
          err instanceof LlmHttpError
            ? `HTTP ${err.status}: ${err.bodySnippet.slice(0, 200)}`
            : err instanceof Error
              ? err.message
              : String(err)
        // 上游可能把明文 key 原样回显在错误文案里（Gemini 401 即如此）。
        // 明文就在本作用域内：先按整串替换，再走前缀正则兜底其余 key 形态。
        const message = redactKeyLikeStrings(
          apiKey ? raw.split(apiKey).join('[redacted]') : raw,
        )
        result = {
          ok: false,
          latencyMs: Date.now() - startedAt,
          message,
        }
      }

      await deps.repo.setLastTest(id, {
        model,
        ok: result.ok,
        latencyMs: result.latencyMs,
        message: result.message,
        testedAt: now().toISOString(),
      })
      invalidateLlmRegistry()

      return NextResponse.json({ ok: true, result })
    },
  }
}
