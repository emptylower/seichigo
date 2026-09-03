import type { LlmClient, LlmClientConfig } from './types'
import { createOpenAiCompatibleClient } from './openaiClient'
import { createAnthropicClient } from './anthropicClient'

export { LlmHttpError, LlmEmptyStreamError } from './http'

/** 按协议分发统一客户端实现。 */
export function createLlmClient(config: LlmClientConfig): LlmClient {
  if (config.protocol === 'anthropic') return createAnthropicClient(config)
  return createOpenAiCompatibleClient(config)
}
