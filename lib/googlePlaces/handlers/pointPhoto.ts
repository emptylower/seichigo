import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { sanitizeMaxWidth, servePlacePhotoByPlaceId, type PlacePhotoHandlerDeps } from '@/lib/googlePlaces/handlers/placePhoto'
import { isValidPlaceId, type PlaceResolver } from '@/lib/googlePlaces/places'
import {
  POINT_LINK_MAX_DISTANCE_KM,
  POINT_LINK_NOT_FOUND_RETRY_MS,
  type PointPlaceLinkStore,
} from '@/lib/googlePlaces/pointPlaceLink'
import { haversineKm } from '@/lib/planAgent/cluster'

/**
 * 点位兜底图接口（回归第四轮 A5）：`GET /api/google/point-photo?pointId=...`。
 * 站内点位自身 image 缺失/加载失败时，前端把它作为候选梯最后一档；服务端按
 * 点位名 + 坐标解析 Google 地点，落库映射（AnitabiPoint.googlePlace* 三列）后
 * 复用 place-photo 的 placeId 路径回图（含 R2 镜像）。未登录 401；点位不存在
 * 404；解析不到 404（结果也落库，7 天内不再重试）。响应头与 place-photo 相同。
 */

export type PointPhotoHandlerDeps = PlacePhotoHandlerDeps & {
  pointLinks: PointPlaceLinkStore
  /** 解析器：rateKey 固定 'point-photo'，与计划无关；测试注入 */
  resolver: PlaceResolver
}

const POINT_ID_MAX_LENGTH = 200

export function createPointPhotoHandlers(deps: PointPhotoHandlerDeps) {
  /**
   * placeId 路径回图（R5）：servePlacePhotoByPlaceId 抛异常（非 404——404 是
   * 正常返回值）时不吞成 500 空响应，console.error 带 pointId/placeId 后返回
   * 502 { error: '图片读取失败' }，前端候选梯据此回退占位图。
   */
  async function servePlacePhotoSafely(pointId: string, placeId: string, maxWidth: number): Promise<Response> {
    try {
      return await servePlacePhotoByPlaceId(deps, placeId, maxWidth, 0)
    } catch (err) {
      console.error('[googlePlaces/point-photo] serve photo failed', { pointId, placeId }, err)
      return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
    }
  }

  async function resolvePointLink(pointId: string, maxWidth: number): Promise<Response> {
    const point = await deps.pointLinks.findPoint(pointId)
    if (!point) {
      return NextResponse.json({ error: '点位不存在' }, { status: 404 })
    }
    // 已有有效链接：直接按 placeId 路径回图；404 视为链接失效——只清空内存副本
    // （R3：不落库 not_found，一次瞬时 404 不能把点位封 7 天），继续走解析流程
    if (point.googlePlaceId && isValidPlaceId(point.googlePlaceId)) {
      const served = await servePlacePhotoSafely(pointId, point.googlePlaceId, maxWidth)
      if (served.status !== 404) return served
      point.googlePlaceId = null
      point.googlePlaceStatus = null
      point.googlePlaceResolvedAt = null
    }
    // not_found 且 7 天内：不再重试
    if (
      point.googlePlaceStatus === 'not_found' &&
      point.googlePlaceResolvedAt &&
      Date.now() - point.googlePlaceResolvedAt.getTime() < POINT_LINK_NOT_FOUND_RETRY_MS
    ) {
      return NextResponse.json({ error: '该点位没有可用的 Google 图片' }, { status: 404 })
    }
    // 解析：点位中文名优先；带坐标时用 near 偏置（300m）+ 距离守卫（≤1km）
    const query = point.nameZh || point.name
    const near =
      typeof point.lat === 'number' && typeof point.lng === 'number' && Number.isFinite(point.lat) && Number.isFinite(point.lng)
        ? { lat: point.lat, lng: point.lng }
        : undefined
    const resolution = await deps.resolver.resolveByText(query, {
      ...(near ? { near, radiusM: 300 } : {}),
    })
    if (!resolution.ok) {
      // 限流/服务端错误不落库（下次可重试）；其余按 not_found 落库
      if (resolution.code === 'rate_limited' || resolution.code === 'provider_error') {
        return NextResponse.json({ error: '图片服务暂时不可用，请稍后再试' }, { status: 503 })
      }
      await deps.pointLinks
        .setLink(pointId, { placeId: null, status: 'not_found', resolvedAt: new Date() })
        .catch(() => undefined)
      return NextResponse.json({ error: '该点位没有可用的 Google 图片' }, { status: 404 })
    }
    const place = resolution.place
    if (near && haversineKm(place, near) > POINT_LINK_MAX_DISTANCE_KM) {
      await deps.pointLinks
        .setLink(pointId, { placeId: null, status: 'not_found', resolvedAt: new Date() })
        .catch(() => undefined)
      return NextResponse.json({ error: '该点位没有可用的 Google 图片' }, { status: 404 })
    }
    await deps.pointLinks
      .setLink(pointId, { placeId: place.placeId, status: 'resolved', resolvedAt: new Date() })
      .catch(() => undefined)
    return servePlacePhotoSafely(pointId, place.placeId, maxWidth)
  }

  return {
    async GET(req: Request): Promise<Response> {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '未登录' }, { status: 401 })
      }
      const url = new URL(req.url)
      const pointId = String(url.searchParams.get('pointId') || '').trim()
      if (!pointId || pointId.length > POINT_ID_MAX_LENGTH) {
        return NextResponse.json({ error: '点位参数错误' }, { status: 400 })
      }
      const maxWidth = sanitizeMaxWidth(url.searchParams.get('maxwidth'))
      try {
        return await resolvePointLink(pointId, maxWidth)
      } catch (err) {
        console.error('[googlePlaces/point-photo] resolve failed', err)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
      }
    },
  }
}
