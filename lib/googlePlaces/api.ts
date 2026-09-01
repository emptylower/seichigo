import type { PlacePhotoHandlerDeps } from '@/lib/googlePlaces/handlers/placePhoto'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * Google Places 照片代理的服务端依赖。
 *
 * 注意：Cloudflare 的 ctx.waitUntil 是**请求级**绑定，绝不能进程级缓存（否则
 * 后续所有请求都会把后台镜像挂到一个早已结束的旧请求上）。这里只缓存跨请求
 * 稳定的部分（getSession 函数引用、API key、R2 bucket 引用——env 绑定在
 * 同一 Worker 部署内是同一个对象），waitUntil 每次调用时从当前请求的
 * __cloudflare-context__ 重新读取。
 */

type StableDeps = {
  getSession: PlacePhotoHandlerDeps['getSession']
  apiKey: string
  bucket?: PlacePhotoHandlerDeps['bucket']
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
  }
  return cachedStable
}

export async function getGooglePlacesApiDeps(): Promise<PlacePhotoHandlerDeps> {
  const stable = await loadStableDeps()
  // waitUntil 每次从当前请求取；本请求没有 bindings 时缺省（镜像走浮动 promise）
  const bindings = getCfBindings()
  return {
    ...stable,
    ...(bindings?.ctx?.waitUntil ? { waitUntil: bindings.ctx.waitUntil } : {}),
  }
}
