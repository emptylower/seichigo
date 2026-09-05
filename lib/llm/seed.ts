import type { LlmProviderRepo } from './repo'
import { normalizeEndpointUrl } from './handlers/validate'
import { encryptSecret, apiKeyHintOf } from './secretBox'

/**
 * DeepSeek 现网口径：OpenAI SDK 在 baseURL 后直接拼 `/chat/completions`
 * （不插 `/v1`）。归一函数对空路径按通用约定补 `/v1/chat/completions`，
 * 与现网不同——这里显式按 SDK 行为拼，保证内化后的接管端点与 env 直连
 * 完全一致（已完整的 URL 幂等不再追加）。
 */
function deepseekEndpointOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.toLowerCase().endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

/**
 * 把环境变量里已有的 LLM 服务内化成面板供应商。幂等：
 * - 表非空时整体跳过（首次 GET /api/admin/llm/providers 时调用）；
 * - 即便并发调用，envKey 唯一约束（P2002）兜底防重：输掉竞争的一方静默跳过。
 *
 * 内化时 API key 以密文入库；加密失败（secret 未配置）降级为"无 key"
 * 供应商（hasApiKey=false，接管不会生效），而不是让面板 500。
 */
export async function seedProvidersFromEnv(repo: LlmProviderRepo): Promise<void> {
  const existing = await repo.list()
  if (existing.length > 0) return

  const planAgentKey = process.env.PLAN_AGENT_API_KEY
  if (planAgentKey) {
    const model = process.env.PLAN_AGENT_MODEL || 'deepseek-v4-flash'
    // M4：baseUrl 记 env 原值；endpointUrl 按现网口径拼（…/chat/completions，
    // 不再变成 /v1/chat/completions），与面板自定义供应商归一后的形态同构
    const baseUrl = process.env.PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'
    await createIgnoringDuplicate(repo, {
      name: 'DeepSeek（环境变量）',
      protocol: 'openai',
      baseUrl,
      endpointUrl: deepseekEndpointOf(baseUrl),
      ...(await keyBox(planAgentKey)),
      models: [
        {
          name: model,
          contextLength: 128000,
          maxOutputTokens: Number(process.env.PLAN_AGENT_MAX_TOKENS) || 32768,
        },
      ],
      takeoverAgent: true,
      agentModel: model,
      source: 'env',
      envKey: 'plan_agent',
    })
  }

  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    // M4：记 v1beta/openai 基地址；归一（只追加后缀）得到完整端点
    const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/openai'
    const geminiEndpoint = normalizeEndpointUrl('openai', geminiBase)
    await createIgnoringDuplicate(repo, {
      name: 'Gemini（环境变量）',
      protocol: 'openai',
      baseUrl: geminiBase,
      endpointUrl: geminiEndpoint,
      ...(await keyBox(geminiKey)),
      models: [{ name: 'gemini-2.5-flash', contextLength: 1000000, maxOutputTokens: 8192 }],
      takeoverTranslation: true,
      translationModel: 'gemini-2.5-flash',
      source: 'env',
      envKey: 'gemini',
    })
  }
}

/** 并发内化时 envKey 唯一约束冲突（P2002）= 对方已写入，静默跳过即可。 */
async function createIgnoringDuplicate(
  repo: LlmProviderRepo,
  input: Parameters<LlmProviderRepo['create']>[0],
): Promise<void> {
  try {
    await repo.create(input)
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2002') return
    throw err
  }
}

async function keyBox(
  apiKey: string,
): Promise<{ apiKeyCiphertext: string | null; apiKeyHint: string | null }> {
  try {
    return { apiKeyCiphertext: await encryptSecret(apiKey), apiKeyHint: apiKeyHintOf(apiKey) }
  } catch (err) {
    console.warn('[llm/seed] 内化环境变量供应商时加密失败，以无 key 形式落库', err)
    return { apiKeyCiphertext: null, apiKeyHint: null }
  }
}
