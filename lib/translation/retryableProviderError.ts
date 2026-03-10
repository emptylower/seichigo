import type { MapExecutionSummary } from '@/lib/translation/mapOpsShared'

const RETRYABLE_PROVIDER_ERROR_PATTERNS = [
  /gemini api error \((429|500|502|503|504)\)/i,
  /rate limit exceeded/i,
  /service unavailable/i,
  /temporarily unavailable/i,
  /resource exhausted/i,
  /gemini request timed out/i,
]

export function isRetryableProviderErrorMessage(message: string): boolean {
  const text = String(message || '').trim()
  if (!text) return false
  return RETRYABLE_PROVIDER_ERROR_PATTERNS.some((pattern) =>
    pattern.test(text)
  )
}

export function isRetryableProviderRound(
  summary: MapExecutionSummary
): boolean {
  const translatedFailures = Math.max(
    0,
    Number(summary.failed || 0) - Number(summary.reclaimedProcessing || 0)
  )

  return (
    Number(summary.processed || 0) > 0 &&
    Number(summary.success || 0) === 0 &&
    translatedFailures > 0 &&
    Array.isArray(summary.errorMessages) &&
    summary.errorMessages.length > 0 &&
    summary.errorMessages.every(isRetryableProviderErrorMessage)
  )
}
