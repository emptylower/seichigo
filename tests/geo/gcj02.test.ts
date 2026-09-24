import { describe, expect, it } from 'vitest'
import { gcj02ToWgs84, isOutsideChina, wgs84ToGcj02 } from '@/lib/geo/gcj02'

/** 两点地表距离（米），粗略用纬度/经度平均换算 */
function approxDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const toRad = (v: number) => (v / 180) * Math.PI
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const meanLat = toRad((a.lat + b.lat) / 2)
  const x = dLng * Math.cos(meanLat)
  return Math.hypot(x, dLat) * R
}

describe('isOutsideChina', () => {
  it('东京在中国外', () => {
    expect(isOutsideChina(35.6762, 139.6503)).toBe(true)
  })

  it('上海、拉萨在中国内', () => {
    expect(isOutsideChina(31.2304, 121.4737)).toBe(false)
    expect(isOutsideChina(29.65, 91.1)).toBe(false)
  })

  it('边界值：恰好落在边界上视为境内（非 outside）', () => {
    expect(isOutsideChina(0.8293, 72.004)).toBe(false)
    expect(isOutsideChina(55.8271, 137.8347)).toBe(false)
  })

  it('越界一角即为外', () => {
    expect(isOutsideChina(0.8292, 110)).toBe(true)
    expect(isOutsideChina(56, 110)).toBe(true)
    expect(isOutsideChina(40, 72.003)).toBe(true)
    expect(isOutsideChina(40, 137.8348)).toBe(true)
  })

  it('日本与韩国排除框：落框内直接视为境外（含与中国矩形重叠的日本西部）', () => {
    expect(isOutsideChina(35.0116, 135.7681)).toBe(true) // 京都
    expect(isOutsideChina(36.2381, 137.1866)).toBe(true) // 飞驒古川
    expect(isOutsideChina(37.5665, 126.978)).toBe(true) // 首尔
    expect(isOutsideChina(34.6937, 135.5013)).toBe(true) // 大阪
  })
})

describe('wgs84ToGcj02 / gcj02ToWgs84', () => {
  it('东京（境外）不偏移', () => {
    const out = wgs84ToGcj02(35.6762, 139.6503)
    expect(out).toEqual({ lat: 35.6762, lng: 139.6503 })
    const back = gcj02ToWgs84(35.6762, 139.6503)
    expect(back).toEqual({ lat: 35.6762, lng: 139.6503 })
  })

  it('日本西部（京都/飞驒）不偏移', () => {
    for (const [lat, lng] of [
      [35.0116, 135.7681],
      [36.2381, 137.1866],
    ]) {
      expect(wgs84ToGcj02(lat, lng)).toEqual({ lat, lng })
      expect(gcj02ToWgs84(lat, lng)).toEqual({ lat, lng })
    }
  })

  it('上海往返误差 < 1m', () => {
    const wgs = { lat: 31.2304, lng: 121.4737 }
    const gcj = wgs84ToGcj02(wgs.lat, wgs.lng)
    // GCJ-02 相对 WGS-84 的典型偏移在数百米量级（300–900m）
    const offsetM = approxDistanceM(wgs, gcj)
    expect(offsetM).toBeGreaterThan(200)
    expect(offsetM).toBeLessThan(1200)
    const back = gcj02ToWgs84(gcj.lat, gcj.lng)
    expect(approxDistanceM(wgs, back)).toBeLessThan(1)
  })

  it('拉萨往返误差 < 1m', () => {
    const wgs = { lat: 29.65, lng: 91.1 }
    const gcj = wgs84ToGcj02(wgs.lat, wgs.lng)
    expect(approxDistanceM(wgs, gcj)).toBeGreaterThan(200)
    expect(approxDistanceM(wgs, gcj)).toBeLessThan(1200)
    const back = gcj02ToWgs84(gcj.lat, gcj.lng)
    expect(approxDistanceM(wgs, back)).toBeLessThan(1)
  })

  it('北京往返误差 < 1m', () => {
    const wgs = { lat: 39.9042, lng: 116.4074 }
    const gcj = wgs84ToGcj02(wgs.lat, wgs.lng)
    const back = gcj02ToWgs84(gcj.lat, gcj.lng)
    expect(approxDistanceM(wgs, back)).toBeLessThan(1)
  })
})
