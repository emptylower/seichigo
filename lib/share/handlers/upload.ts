import { NextResponse } from 'next/server'
import type { ShareApiDeps } from '@/lib/share/api'
import { isAllowedShareCardSize, parseImageSize } from '@/lib/share/imageMeta'
import { isShareCode } from '@/lib/share/shortCode'
import { checkinPhotoKey, shareCardKey } from '@/lib/share/store'
import { SHARE_CARD_MAX_BYTES, SHARE_PHOTO_MAX_BYTES, type ShareUploadResponse } from '@/lib/share/types'

const DAY_MS = 24 * 60 * 60 * 1000

/** 卡片 1.5MB + 实拍 5MB + 表单开销；formData() 前先按声明值拒收，避免把超大 body 缓进内存 */
const MAX_UPLOAD_BODY_BYTES = SHARE_CARD_MAX_BYTES + SHARE_PHOTO_MAX_BYTES + 64 * 1024

/** 每用户每日 30 次上传（计数方式同 lib/tripPlan/repoPrisma.ts:261 的按日配额） */
export const USER_DAILY_UPLOAD_LIMIT = 30

type FileLike = { type: string; arrayBuffer(): Promise<ArrayBuffer> }

function isFileLike(value: unknown): value is FileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileLike).arrayBuffer === 'function'
  )
}

function normalizeType(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

/** 卡片字节 sha256 hex 前 8 位：内容一变指纹就变，R2 key 与 `?v=` 缓存击穿都靠它 */
async function cardFingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  let hex = ''
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0')
  return hex.slice(0, 8)
}

export function createPostShareUploadHandler(deps: ShareApiDeps) {
  return async function postShareUpload(
    req: Request,
    ctx: { params: Promise<{ code: string }> },
  ): Promise<Response> {
    const { code } = await ctx.params
    if (!isShareCode(code)) return NextResponse.json({ error: '短链不存在' }, { status: 404 })

    const declared = Number(req.headers.get('content-length') || '')
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BODY_BYTES) {
      return NextResponse.json({ error: '上传内容过大' }, { status: 413 })
    }

    const session = await deps.getSession()
    const userId = String(session?.user?.id || '').trim()
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const link = await deps.repo.findByCode(code)
    if (!link) return NextResponse.json({ error: '短链不存在' }, { status: 404 })
    // 匿名链没有卡片（/s/[code] 已有点位截图兜底），一律不允许被登录用户认领
    if (link.userId !== userId) {
      return NextResponse.json({ error: '无权修改该分享' }, { status: 403 })
    }

    const now = deps.now()
    const since = new Date(now.getTime() - DAY_MS)
    const used = await deps.repo.countUploadsByUserSince(userId, since)
    if (used >= USER_DAILY_UPLOAD_LIMIT) {
      return NextResponse.json({ error: '今日上传次数已达上限，请明天再试' }, { status: 429 })
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: '无效的表单数据' }, { status: 400 })
    }

    // card 自 2026-09-08 服务端渲染改造后可选：前端不再生成卡片，只补传实拍。
    // 传了就一条校验不放（尺寸/类型/体积），没传就跳过整段。
    const card = form.get('card')
    const hasCard = isFileLike(card)
    let cardBytes: Uint8Array<ArrayBuffer> | null = null
    let cardType = ''
    if (hasCard) {
      cardType = normalizeType(card.type)
      if (cardType !== 'image/jpeg' && cardType !== 'image/webp') {
        return NextResponse.json({ error: '卡片仅支持 JPEG 或 WebP' }, { status: 415 })
      }
      cardBytes = new Uint8Array(await card.arrayBuffer())
      if (cardBytes.byteLength > SHARE_CARD_MAX_BYTES) {
        return NextResponse.json({ error: '卡片图片过大' }, { status: 413 })
      }
      if (!isAllowedShareCardSize(parseImageSize(cardBytes, cardType))) {
        return NextResponse.json({ error: '卡片尺寸必须是 1080×1440 或 1200×630' }, { status: 422 })
      }
    }

    // photo 的类型/大小校验放在写 R2 之前，避免卡片已落库但整个请求还是 4xx
    const photo = form.get('photo')
    let photoBytes: Uint8Array | null = null
    if (isFileLike(photo)) {
      if (normalizeType(photo.type) !== 'image/jpeg') {
        return NextResponse.json({ error: '实拍请先转成 JPEG 再上传' }, { status: 415 })
      }
      photoBytes = new Uint8Array(await photo.arrayBuffer())
      if (photoBytes.byteLength > SHARE_PHOTO_MAX_BYTES) {
        return NextResponse.json({ error: '实拍图片过大' }, { status: 413 })
      }
    }

    if (!cardBytes && !photoBytes) {
      return NextResponse.json({ error: '缺少上传内容' }, { status: 400 })
    }

    const store = deps.getStore()
    if (!store) return NextResponse.json({ error: '存储暂不可用' }, { status: 503 })

    let cardKey: string | null = null
    if (cardBytes) {
      const fingerprint = await cardFingerprint(cardBytes)
      cardKey = shareCardKey(code, fingerprint, cardType)
      await store.put(cardKey, cardBytes, cardType)
    }

    const previousKey = link.imageKey
    // photo-only 也走这里：imageKey 传 null 不动原值，但 uploadCount 照样 +1，
    // 否则「只传实拍」就成了没配额的上传口子
    const updated = await deps.repo.markUploaded(code, { imageKey: cardKey, userId })
    if (!updated) return NextResponse.json({ error: '短链不存在' }, { status: 404 })

    // 换内容后清掉旧卡片对象；失败只记日志，不影响本次上传结果
    if (cardKey && previousKey && previousKey !== cardKey) {
      await store.delete(previousKey).catch((error) => {
        console.error('[share.upload.delete_stale_failed]', { code, key: previousKey, error })
      })
    }

    let photoUrl: string | null = null
    let photoKey: string | null = null
    if (photoBytes) {
      photoKey = checkinPhotoKey(userId, link.pointId)
      await store.put(photoKey, photoBytes, 'image/jpeg')
      // pointId 里可能有冒号（如 101:station），进 URL 必须编码，进 R2 key 保持原样
      photoUrl = `/api/share/photo/${encodeURIComponent(userId)}/${encodeURIComponent(link.pointId)}`
      await deps.pointStateRepo.upsert(userId, link.pointId, 'checked_in', {
        photoUrl,
        checkedInAt: now,
      })
    }

    const body: ShareUploadResponse = {
      ok: true,
      imageUrl: cardKey ? `/api/share/img/${code}` : null,
      photoUrl,
      photoKey,
    }
    return NextResponse.json(body, { status: 200 })
  }
}
