import type { PlacePhotoHandlerDeps } from '@/lib/googlePlaces/handlers/placePhoto'
import type { PointPhotoHandlerDeps } from '@/lib/googlePlaces/handlers/pointPhoto'
import { createPlaceResolver, createPlacesRateWindow } from '@/lib/googlePlaces/places'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { getPrismaExternalPlaceStore } from '@/lib/googlePlaces/storePrisma'
import { getPrismaPointPlaceLinkStore } from '@/lib/googlePlaces/pointPlaceLinkPrisma'

/**
 * Google Places 照片代理的服务端依赖。
 *
 * 注意：Cloudflare 的 ctx.waitUntil 是**请求级**绑定，绝不能进程级缓存（否则
 * 后续所有请求都会把后台镜像挂到一个早已结束的旧请求上）。这里只缓存跨请求
 * 稳定的部分（getSession 函数引用、API key、R2 bucket 引用——env 绑定在
 * 同一 Worker 部署内是同一个对象、地点库 store 单例），waitUntil 每次调用时
 * 从当前请求的 __cloudflare-context__ 重新读取。
 */

type StableDeps = {
  getSession: PlacePhotoHandlerDeps['getSession']
  apiKey: string
  bucket?: PlacePhotoHandlerDeps['bucket']
  store: PlacePhotoHandlerDeps['store']
}

let cachedStable: StableDeps | null = null

async function loadStableDeps(): Promise<StableDeps> {
  if (cachedStable) return cachedStable

  const [{ getServerAuthSession }] = await Promise.all([import('@/lib/auth/session')])

  const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!apiKey) {
    console.warn('[googlePlaces] GOOGLE_DIRECTIONS_API_KEY not set, place photo proxy will fail')
  }

  // env 绑定（bucket）在同一 Worker 部署内跨请求恒定，可随稳定部分缓存
  const bindings = getCfBindings()
  cachedStable = {
    getSession: getServerAuthSession,
    apiKey,
    ...(bindings?.env?.MAP_IMAGE_CACHE ? { bucket: bindings.env.MAP_IMAGE_CACHE } : {}),
    // 地点库单例（Prisma 惰性代理；库不可用时由解析器/handler 各自降级）
    store: getPrismaExternalPlaceStore(),
  }
  return cachedStable
}

export async function getGooglePlacesApiDeps(): Promise<PlacePhotoHandlerDeps> {
  const stable = await loadStableDeps()
  // waitUntil 每次从当前请求取；本请求没有 bindings 时缺省（镜像走浮动 promise）。
  // 必须闭包转发而不是直接传方法引用——ctx.waitUntil 脱离 ctx 调用会抛
  // "Illegal invocation"（回归第五轮 R1：所有地点图曾因此在 Cloudflare 上 500）
  const ctx = getCfBindings()?.ctx
  return {
    ...stable,
    ...(ctx?.waitUntil ? { waitUntil: ctx.waitUntil.bind(ctx) } : {}),
  }
}

/** 点位兜底图（A5）的进程级缓存部分：映射库 + 独立限速的解析器（无 onResolved，镜像由 photo 路径的 lazy put 负责） */
let cachedPointDeps: Omit<PointPhotoHandlerDeps, 'waitUntil'> | null = null

export async function getGooglePointPhotoDeps(): Promise<PointPhotoHandlerDeps> {
  const stable = await loadStableDeps()
  if (!cachedPointDeps) {
    cachedPointDeps = {
      ...stable,
      pointLinks: getPrismaPointPlaceLinkStore(),
      resolver: createPlaceResolver({
        apiKey: stable.apiKey,
        rateKey: 'point-photo',
        store: stable.store,
        rateWindow: createPlacesRateWindow({ maxCalls: 30 }),
        // 点位名多是「踏切」「阶段」这类泛词：不写查询词行、不按查询词命中（R4）
        persistQuery: false,
      }),
    }
  }
  const ctx = getCfBindings()?.ctx
  return {
    ...cachedPointDeps,
    ...(ctx?.waitUntil ? { waitUntil: ctx.waitUntil.bind(ctx) } : {}),
  }
}
