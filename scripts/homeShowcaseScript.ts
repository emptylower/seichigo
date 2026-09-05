/**
 * generate-home-showcase.mts 的高危分支抽出的纯函数（第十二轮审查中-12）：
 * client/fs 全部注入，逻辑可单测；脚本侧只做 Prisma/Google 的接线。
 */
import { parsePlacePhotoRefs } from '@/lib/googlePlaces/store'

/** 只读查库客户端（脚本侧由 Prisma 实现，测试注入内存实现） */
export type PhotoReferenceClient = {
  /** AnitabiPoint → googlePlaceId */
  findPointGooglePlaceId(pointId: string): Promise<string | null>
  /** ExternalPlace 的 photos 列表与根 photoReference */
  findExternalPlace(
    placeId: string
  ): Promise<{ photos: unknown; photoReference: string | null } | null>
}

/**
 * 解析 Google 图片代理 URL → 可直接打 Places Photo API 的 photoReference。
 * 三层分支：① 显式 ref 参数；② placeId（或 pointId → googlePlaceId）→
 * externalPlace.photos[i]；③ photos[i] 缺失时仅 i=0 回落到根 photoReference。
 */
export async function resolvePhotoReference(
  displayUrl: string,
  client: PhotoReferenceClient
): Promise<string | null> {
  const query = displayUrl.slice(displayUrl.indexOf('?') + 1)
  const params = new URLSearchParams(query)
  const ref = params.get('ref')
  if (ref) return ref

  let placeId = params.get('placeId')
  const pointId = params.get('pointId')
  if (!placeId && pointId) {
    placeId = await client.findPointGooglePlaceId(pointId)
  }
  if (!placeId) return null

  const index = Math.max(0, Math.min(9, Number(params.get('i') || 0) || 0))
  const place = await client.findExternalPlace(placeId)
  if (!place) return null
  const refs = parsePlacePhotoRefs(place.photos)
  const reference = refs[index]?.photoReference || (index === 0 ? place.photoReference : null)
  return reference || null
}

export type EnsureShowcaseImageDeps = {
  /** Google 图片代理 URL（下载失败的错误信息里会用到） */
  displayUrl: string
  /** 目标静态文件的绝对路径 */
  imagePath: string
  fileExists(imagePath: string): Promise<boolean>
  writeFile(imagePath: string, bytes: Uint8Array): Promise<void>
  resolveReference(displayUrl: string): Promise<string | null>
  fetchPhoto(photoReference: string): Promise<Uint8Array>
}

/**
 * 下载幂等分支：文件已存在直接复用（不发起任何网络请求）；缺失时
 * 解析 photoReference → 抓取 → 落盘。任何一步失败都抛错且不写半截文件，
 * 由调用方（rewriteShowcaseDays）决定删掉 media 回落 point.image。
 */
export async function ensureShowcaseImage(deps: EnsureShowcaseImageDeps): Promise<'reused' | 'downloaded'> {
  if (await deps.fileExists(deps.imagePath)) return 'reused'

  const photoReference = await deps.resolveReference(deps.displayUrl)
  if (!photoReference) throw new Error(`no photo reference for ${deps.displayUrl}`)
  const bytes = await deps.fetchPhoto(photoReference)
  await deps.writeFile(deps.imagePath, bytes)
  return 'downloaded'
}

export type EnsureProxiedImageDeps = {
  /** 公开 image-render 代理 URL（绝对地址或以生产站为基的相对路径） */
  url: string
  /** 目标静态文件的绝对路径 */
  imagePath: string
  fileExists(imagePath: string): Promise<boolean>
  writeFile(imagePath: string, bytes: Uint8Array): Promise<void>
  fetchImage(url: string): Promise<Uint8Array>
}

/**
 * 公开代理下载幂等分支（A1 点位图静态化）：文件已存在直接复用；缺失时抓取
 * 代理 URL 并落盘。空响应体或任何一步失败都抛错且不写半截文件，由调用方
 * （rewriteShowcaseDays / pickHeroDemo）决定保留无 media 的兜底行为。
 */
export async function ensureProxiedImage(deps: EnsureProxiedImageDeps): Promise<'reused' | 'downloaded'> {
  if (await deps.fileExists(deps.imagePath)) return 'reused'

  const bytes = await deps.fetchImage(deps.url)
  if (!bytes || bytes.length === 0) {
    throw new Error(`empty image body for ${deps.url}`)
  }
  await deps.writeFile(deps.imagePath, bytes)
  return 'downloaded'
}
