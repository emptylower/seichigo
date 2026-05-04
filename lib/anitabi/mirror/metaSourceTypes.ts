/**
 * Reserved sourceType values used by the anitabi-mirror worker to store
 * meta-state (throttle counters, delta cursor) on the same MapImageMirrorState
 * table as real image rows. Aggregations and progress queries must filter
 * these out so meta-rows do not pollute backfill/progress numbers.
 *
 * Definitions:
 * - `__throttle__` — circuit-breaker counter row (workers/anitabi-mirror/src/throttle.ts)
 * - `__cursor__`   — delta-sync cursor row     (workers/anitabi-mirror/src/delta.ts)
 */
export const MIRROR_META_SOURCE_TYPES = ['__throttle__', '__cursor__'] as const

export type MirrorMetaSourceType = (typeof MIRROR_META_SOURCE_TYPES)[number]

export function isMirrorMetaSourceType(value: string): value is MirrorMetaSourceType {
  return (MIRROR_META_SOURCE_TYPES as readonly string[]).includes(value)
}
