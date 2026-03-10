type RuntimeEnv = NodeJS.ProcessEnv

export type MapTaskExecutionProfile = {
  batchSize: number
  batchChars: number
  callOptions: {
    maxRetries: number
    requestTimeoutMs: number
    initialBackoffMs?: number
    maxBackoffMs?: number
  }
}

export type MapOneKeyPolicy = {
  approveLimit: number
  failedLimitPerType: number
  pendingLimitPerType: number
  executionConcurrency: number
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

export function isVercelRuntime(env: RuntimeEnv = process.env): boolean {
  return isTruthy(env.VERCEL) || isTruthy(env.VERCEL_ENV)
}

export function getMapTaskExecutionProfile(
  env: RuntimeEnv = process.env
): MapTaskExecutionProfile {
  if (isVercelRuntime(env)) {
    return {
      batchSize: 8,
      batchChars: 1800,
      callOptions: {
        maxRetries: 1,
        requestTimeoutMs: 15_000,
        initialBackoffMs: 250,
        maxBackoffMs: 1_000,
      },
    }
  }

  return {
    batchSize: 15,
    batchChars: 3000,
    callOptions: {
      maxRetries: 0,
      requestTimeoutMs: 8_000,
    },
  }
}

export function getMapOneKeyPolicy(
  env: RuntimeEnv = process.env
): MapOneKeyPolicy {
  if (isVercelRuntime(env)) {
    return {
      approveLimit: 20,
      failedLimitPerType: 2,
      pendingLimitPerType: 4,
      executionConcurrency: 1,
    }
  }

  return {
    approveLimit: 30,
    failedLimitPerType: 4,
    pendingLimitPerType: 6,
    executionConcurrency: 1,
  }
}
