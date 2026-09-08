import { NextResponse } from 'next/server'
import type { ShareApiDeps } from '@/lib/share/api'
import { isAllowedShareCardSize, parseImageSize } from '@/lib/share/imageMeta'
import { isShareCode } from '@/lib/share/shortCode'
import { checkinPhotoKey, shareCardKey } from '@/lib/share/store'
import { SHARE_CARD_MAX_BYTES, SHARE_PHOTO_MAX_BYTES, type ShareUploadResponse } from '@/lib/share/types'

const DAY_MS = 24 * 60 * 60 * 1000

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

export function createPostShareUploadHandler(deps: ShareApiDeps) {
  return async function postShareUpload(
    req: Request,
    ctx: { params: Promise<{ code: string }> },
  ): Promise<Response> {
    const { code } = await ctx.params
    if (!isShareCode(code)) return NextResponse.json({ error: '短链不存在' }, { status: 404 })

    const session = await deps.getSession()
    const userId = String(session?.user?.id || '').trim()
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const link = await deps.repo.findByCode(code)
    if (!link) return NextResponse.json({ error: '短链不存在' }, { status: 404 })
    if (link.userId && link.userId !== userId) {
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

    const card = form.get('card')
    if (!isFileLike(card)) return NextResponse.json({ error: '缺少卡片图片' }, { status: 400 })
    const cardType = normalizeType(card.type)
    if (cardType !== 'image/jpeg' && cardType !== 'image/webp') {
      return NextResponse.json({ error: '卡片仅支持 JPEG 或 WebP' }, { status: 415 })
    }
    const cardBytes = new Uint8Array(await card.arrayBuffer())
    if (cardBytes.byteLength > SHARE_CARD_MAX_BYTES) {
      return NextResponse.json({ error: '卡片图片过大' }, { status: 413 })
    }
    if (!isAllowedShareCardSize(parseImageSize(cardBytes, cardType))) {
      return NextResponse.json({ error: '卡片尺寸必须是 1080×1440 或 1200×630' }, { status: 422 })
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

    const store = deps.getStore()
    if (!store) return NextResponse.json({ error: '存储暂不可用' }, { status: 503 })

    const cardKey = shareCardKey(code, cardType)
    await store.put(cardKey, cardBytes, cardType)
    const updated = await deps.repo.markUploaded(code, { imageKey: cardKey, userId })
    if (!updated) return NextResponse.json({ error: '短链不存在' }, { status: 404 })

    let photoUrl: string | null = null
    if (photoBytes) {
      await store.put(checkinPhotoKey(userId, link.pointId), photoBytes, 'image/jpeg')
      // pointId 里可能有冒号（如 101:station），进 URL 必须编码，进 R2 key 保持原样
      photoUrl = `/api/share/photo/${encodeURIComponent(userId)}/${encodeURIComponent(link.pointId)}`
      await deps.pointStateRepo.upsert(userId, link.pointId, 'checked_in', {
        photoUrl,
        checkedInAt: now,
      })
    }

    const body: ShareUploadResponse = {
      ok: true,
      imageUrl: `/api/share/img/${code}`,
      photoUrl,
    }
    return NextResponse.json(body, { status: 200 })
  }
}
