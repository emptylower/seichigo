export type OptimizePoint = { id: string; lat: number; lng: number; fixed: boolean }
export type LatLng = { lat: number; lng: number }
export type Anchors = { start?: LatLng; end?: LatLng }

const EARTH_RADIUS_M = 6_371_000

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function dist(a: LatLng | undefined, b: LatLng | undefined): number {
  if (!a || !b) return 0
  return haversineM(a, b)
}

/** start→p0→…→pn→end 的总长（米） */
export function routeDistanceM(points: LatLng[], anchors: Anchors): number {
  let total = 0
  let cursor: LatLng | undefined = anchors.start
  for (const point of points) {
    total += dist(cursor, point)
    cursor = point
  }
  total += dist(cursor, anchors.end)
  return total
}

/** 最近邻构造初始序列：起点 = anchors.start，没有则 free[0] */
function nearestNeighbor(free: OptimizePoint[], anchors: Anchors): OptimizePoint[] {
  const remaining = [...free]
  const seq: OptimizePoint[] = []

  let cursor: LatLng | undefined = anchors.start ?? free[0]
  if (!anchors.start && remaining.length > 0) {
    seq.push(remaining.shift()!)
  }

  while (remaining.length > 0) {
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(cursor!, remaining[i])
      if (d < bestDistance) {
        bestDistance = d
        bestIndex = i
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]!
    seq.push(next)
    cursor = next
  }

  return seq
}

const MAX_2OPT_ROUNDS = 200

/** 2-opt：虚拟接 start/end，反转 seq[i..j] 直到无改进或 200 轮 */
function twoOpt(seq: OptimizePoint[], anchors: Anchors): OptimizePoint[] {
  const improved = [...seq]
  let changed = true
  let rounds = 0

  while (changed && rounds < MAX_2OPT_ROUNDS) {
    changed = false
    rounds += 1

    for (let i = 0; i < improved.length - 1 && !changed; i++) {
      for (let j = i + 1; j < improved.length; j++) {
        const prev = i === 0 ? anchors.start : improved[i - 1]
        const next = j === improved.length - 1 ? anchors.end : improved[j + 1]
        const before = dist(prev, improved[i]) + dist(improved[j], next)
        const after = dist(prev, improved[j]) + dist(improved[i], next)
        if (after < before - 1e-9) {
          const segment = improved.splice(i, j - i + 1)
          improved.splice(i, 0, ...segment.reverse())
          changed = true
          break
        }
      }
    }
  }

  return improved
}

/**
 * 返回新顺序的 id 列表；fixed 项保持原下标，free 项按优化后顺序填入其余下标。
 * free 不足 2 个时原样返回。
 */
export function optimizeDay(points: OptimizePoint[], anchors: Anchors): string[] {
  const free = points.filter((point) => !point.fixed)
  if (free.length < 2) {
    return points.map((point) => point.id)
  }

  const seq = twoOpt(nearestNeighbor(free, anchors), anchors)

  const result: string[] = new Array(points.length)
  const freeSlots: number[] = []
  points.forEach((point, index) => {
    if (point.fixed) result[index] = point.id
    else freeSlots.push(index)
  })
  seq.forEach((point, index) => {
    result[freeSlots[index]!] = point.id
  })
  return result
}
