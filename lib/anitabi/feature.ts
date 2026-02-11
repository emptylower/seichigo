export function isMapReplicaEnabled(): boolean {
  const raw = String(process.env.FEATURE_MAP_REPLICA_ENABLED ?? '1').toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(raw)
}
