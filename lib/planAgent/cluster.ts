export type GeoPoint = { id: string; lat: number; lng: number }
export type DayCluster = { dayIndex: number; pointIds: string[] }

const EARTH_RADIUS_KM = 6371

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function orderWithinDay(points: GeoPoint[]): GeoPoint[] {
  if (points.length <= 1) return [...points]
  const remaining = [...points]
  remaining.sort((a, b) => b.lat - a.lat || a.lng - b.lng)
  const path: GeoPoint[] = [remaining.shift() as GeoPoint]
  while (remaining.length) {
    const last = path[path.length - 1]
    let bestIdx = 0
    let bestDist = Infinity
    remaining.forEach((p, idx) => {
      const d = haversineKm(last, p)
      if (d < bestDist) {
        bestDist = d
        bestIdx = idx
      }
    })
    path.push(remaining.splice(bestIdx, 1)[0])
  }
  return path
}

export function clusterIntoDays(points: GeoPoint[], dayCount: number): DayCluster[] {
  if (!points.length || dayCount < 1) return []
  const k = Math.min(dayCount, points.length)

  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  let centroids = Array.from({ length: k }, (_, i) => {
    const seed = sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) * sorted.length) / k))]
    return { lat: seed.lat, lng: seed.lng }
  })

  const assignment = new Array<number>(points.length).fill(0)
  for (let iter = 0; iter < 30; iter++) {
    let changed = false
    points.forEach((p, idx) => {
      let best = 0
      let bestDist = Infinity
      centroids.forEach((c, ci) => {
        const d = haversineKm(p, c)
        if (d < bestDist) {
          bestDist = d
          best = ci
        }
      })
      if (assignment[idx] !== best) {
        assignment[idx] = best
        changed = true
      }
    })
    centroids = centroids.map((c, ci) => {
      const members = points.filter((_, idx) => assignment[idx] === ci)
      if (!members.length) return c
      return {
        lat: members.reduce((sum, p) => sum + p.lat, 0) / members.length,
        lng: members.reduce((sum, p) => sum + p.lng, 0) / members.length,
      }
    })
    if (!changed) break
  }

  const groups = new Map<number, GeoPoint[]>()
  points.forEach((p, idx) => {
    const list = groups.get(assignment[idx]) ?? []
    list.push(p)
    groups.set(assignment[idx], list)
  })

  const ordered = [...groups.values()].sort((a, b) => {
    const lngA = a.reduce((sum, p) => sum + p.lng, 0) / a.length
    const lngB = b.reduce((sum, p) => sum + p.lng, 0) / b.length
    return lngA - lngB
  })

  return ordered.map((members, i) => ({
    dayIndex: i + 1,
    pointIds: orderWithinDay(members).map((p) => p.id),
  }))
}
