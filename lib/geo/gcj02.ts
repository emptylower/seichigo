/**
 * WGS-84 ⇄ GCJ-02（火星坐标系）换算——按公开公式自写，不参考任何 AGPL 项目实现。
 * - `wgs84ToGcj02`：中国境外原样返回。
 * - `gcj02ToWgs84`：迭代反解（≤30 次至 1e-7 度）。
 * - `isOutsideChina`：粗矩形边界（经度 72.004–137.8347、纬度 0.8293–55.8271），
 *   但先排除日本（纬 24–46、经 122.9–146）与韩国（纬 33–38.7、经 124.5–131）——
 *   日本西部（京都/大阪/飞驒）落在中国矩形内，不排除会被偏移 ~500m。
 */

export type LatLng = { lat: number; lng: number }

const SEMI_MAJOR_A = 6378245.0 // 克拉索夫斯基椭球长半轴
const EE = 0.00669342162296594323 // 第一偏心率平方

function inBox(lat: number, lng: number, box: { latMin: number; latMax: number; lngMin: number; lngMax: number }): boolean {
  return lat >= box.latMin && lat <= box.latMax && lng >= box.lngMin && lng <= box.lngMax
}

const JAPAN_BOX = { latMin: 24, latMax: 46, lngMin: 122.9, lngMax: 146 }
const KOREA_BOX = { latMin: 33, latMax: 38.7, lngMin: 124.5, lngMax: 131 }

export function isOutsideChina(lat: number, lng: number): boolean {
  if (inBox(lat, lng, JAPAN_BOX) || inBox(lat, lng, KOREA_BOX)) return true
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

function delta(lat: number, lng: number): LatLng {
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((SEMI_MAJOR_A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((SEMI_MAJOR_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { lat: dLat, lng: dLng }
}

/** WGS-84 → GCJ-02；境外原样返回（日本巡礼坐标不受偏移影响） */
export function wgs84ToGcj02(lat: number, lng: number): LatLng {
  if (isOutsideChina(lat, lng)) return { lat, lng }
  const d = delta(lat, lng)
  return { lat: lat + d.lat, lng: lng + d.lng }
}

/** GCJ-02 → WGS-84：以 GCJ 为初值迭代逼近，≤30 次至残差 < 1e-7 度 */
export function gcj02ToWgs84(lat: number, lng: number): LatLng {
  if (isOutsideChina(lat, lng)) return { lat, lng }
  let wgsLat = lat
  let wgsLng = lng
  const MAX_ITER = 30
  const EPS = 1e-7
  for (let i = 0; i < MAX_ITER; i++) {
    const guess = wgs84ToGcj02(wgsLat, wgsLng)
    const dLat = guess.lat - lat
    const dLng = guess.lng - lng
    wgsLat -= dLat
    wgsLng -= dLng
    if (Math.abs(dLat) < EPS && Math.abs(dLng) < EPS) break
  }
  return { lat: wgsLat, lng: wgsLng }
}
