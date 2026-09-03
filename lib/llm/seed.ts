import type { LlmProviderRepo } from './repo'
import { encryptSecret, apiKeyHintOf } from './secretBox'

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
    const baseUrl = process.env.PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'
    await createIgnoringDuplicate(repo, {
      name: 'DeepSeek（环境变量）',
      protocol: 'openai',
      endpointUrl: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
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
    await createIgnoringDuplicate(repo, {
      name: 'Gemini（环境变量）',
      protocol: 'openai',
      endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
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
