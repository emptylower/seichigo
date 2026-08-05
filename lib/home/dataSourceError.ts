export type HomeDataFailureKind = 'failure' | 'timeout'

export class HomeDataSourceError extends Error {
  constructor(
    readonly source: string,
    readonly kind: HomeDataFailureKind,
    readonly reason: unknown
  ) {
    const detail = reason instanceof Error ? reason.message : String(reason)
    super(`[home:data-source-error] source=${source} kind=${kind}: ${detail}`)
    this.name = 'HomeDataSourceError'
  }
}

export class HomePortalDataUnavailableError extends Error {
  constructor(
    readonly locale: string,
    readonly failures: HomeDataSourceError[]
  ) {
    const summary = failures.map(({ source, kind }) => `${source}:${kind}`).join(', ')
    super(`[home:portal-unavailable] locale=${locale} failures=${summary}`)
    this.name = 'HomePortalDataUnavailableError'
  }
}

export function toHomeDataSourceError(
  source: string,
  kind: HomeDataFailureKind,
  reason: unknown
): HomeDataSourceError {
  return reason instanceof HomeDataSourceError
    ? reason
    : new HomeDataSourceError(source, kind, reason)
}
