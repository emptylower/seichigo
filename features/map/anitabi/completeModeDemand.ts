type HasImageMapLike = {
  hasImage?(id: string): boolean
}

export function buildCompleteModeCoverDemandSignature(
  candidates: Array<{ bangumiId: number; coverUrl: string }>,
): string {
  return candidates
    .map((candidate) => `${candidate.bangumiId}:${candidate.coverUrl}`)
    .join('|')
}

export function buildCompleteModePointDemandSignature(
  candidates: Array<{
    thumbnailKey: string
    pointId: string
    bangumiId: number
    imageUrl: string | null
    priority: number
    density: number | null
  }>,
): string {
  return candidates
    .map((candidate) => [
      candidate.thumbnailKey,
      candidate.pointId,
      candidate.bangumiId,
      candidate.imageUrl || '',
      candidate.priority,
      candidate.density ?? '',
    ].join(':'))
    .join('|')
}

export function shouldSkipCompleteModeDemandUpdate(input: {
  map: HasImageMapLike
  signature: string
  currentSignature: string | null
  inFlightSignature: string | null
  expectedImageIds: string[]
}): boolean {
  if (!input.signature) return false
  if (input.inFlightSignature === input.signature) return true
  if (input.currentSignature !== input.signature) return false
  if (input.expectedImageIds.length === 0) return false
  if (typeof input.map.hasImage !== 'function') return false
  return input.expectedImageIds.every((imageId) => input.map.hasImage?.(imageId))
}
