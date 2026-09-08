# 点位分享卡片 + 短链 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在任意点位上两步之内拿到一张 1080×1440 / 1200×630 的分享卡片和一条带预览图的短链，并把登录用户的每次分享沉淀成站点的实景图与打卡记录。

**Architecture:** 后端新增 `ShareLink` 表与 `/api/share/*` 三条路由（建短链、登录后上传卡片与实拍到 R2 `ASSET_STORE`、公开读图），配一个 `force-dynamic` 的 `/s/[code]` 服务端页，只负责吐 OG 元数据再用 `<meta http-equiv="refresh">` 跳回地图深链。前端在点位详情面板常驻「分享」按钮，打开一个纯客户端 canvas 卡片渲染器 + 分享面板，图片一律经 `toCanvasSafeImageUrl` 取以免污染 canvas。两条 Track 文件集合不相交，唯一共享契约是 Track A 先建的 `lib/share/types.ts`。

**Tech Stack:** Next.js 15 App Router、Prisma + Neon Postgres、Cloudflare Workers（opennextjs-cloudflare，R2 桶 `seichigo-assets` 绑定名 `ASSET_STORE`）、Web Crypto（`crypto.getRandomValues` / `crypto.subtle.digest`）、zod、qrcode、vitest（node + jsdom 双 project）、Tailwind、三语 `lib/i18n`。

---

## File Structure

### 共享契约（Track A 先建，Track B 只 import 不改）

| 文件 | 单一职责 |
| --- | --- |
| `lib/share/types.ts` **[新建 · Task A1]** | 分享 API 的请求/响应类型、版式尺寸常量、渠道枚举与 `c → utm_medium` 映射。前后端唯一共享面。 |

### Track A（后端：Prisma 模型与迁移、`/api/share/*`、`/s/[code]`、地图 OG 修复、ja/en OG images）

| 文件 | 动作 | 单一职责 |
| --- | --- | --- |
| `lib/share/shortCode.ts` | 新建 | 8 位 base62 短码生成（`crypto.getRandomValues` + 拒绝采样）与冲突重试 3 次的分配器。 |
| `lib/share/imageMeta.ts` | 新建 | 只读文件头解析 JPEG（SOF）/ WebP（VP8、VP8L、VP8X）像素尺寸，并校验是否命中允许的卡片尺寸。 |
| `lib/share/ipHash.ts` | 新建 | `sha256(ip + UTC 日期)` hex 与客户端 IP 读取。 |
| `lib/share/repo.ts` | 新建 | `ShareLinkRepo` 接口与记录类型。 |
| `lib/share/repoMemory.ts` | 新建 | 内存实现，供 handler 单测使用。 |
| `lib/share/repoPrisma.ts` | 新建 | Prisma 实现。 |
| `lib/share/store.ts` | 新建 | R2 `ASSET_STORE` 的分享对象读写与 key 规则（`share/<code>.<ext>`、`checkin/<userId>/<pointId>.jpg`）。 |
| `lib/share/background.ts` | 新建 | `ctx.waitUntil` 的 fire-and-forget 包装（必须以 ctx 为 this 调用）。 |
| `lib/share/api.ts` | 新建 | 依赖装配 `ShareApiDeps`（repo、pointStateRepo、store、session、now、origin）。 |
| `lib/share/handlers/links.ts` | 新建 | `POST /api/share/links` 的 handler：去重、匿名 IP 限流、短码分配。 |
| `lib/share/handlers/upload.ts` | 新建 | `POST /api/share/links/[code]/upload` 的 handler：登录校验、类型/大小/尺寸校验、写 R2、回写 `UserPointState`。 |
| `lib/share/handlers/media.ts` | 新建 | `GET /api/share/img/[code]`、`GET /api/share/photo/[userId]/[pointId]` 的 handler。 |
| `lib/share/view.ts` | 新建 | `/s/[code]` 的三语标题/描述与跳转目标 URL 构造（纯函数）。 |
| `app/api/share/links/route.ts` | 新建 | 路由壳。 |
| `app/api/share/links/[code]/upload/route.ts` | 新建 | 路由壳。 |
| `app/api/share/img/[code]/route.ts` | 新建 | 路由壳。 |
| `app/api/share/photo/[userId]/[pointId]/route.ts` | 新建 | 路由壳。 |
| `app/s/[code]/page.tsx` | 新建 | 短链页：`generateMetadata` 出 OG，页面体只有 refresh meta + 内联 script。 |
| `prisma/schema.prisma` | 修改（文件尾追加） | `ShareLink` model。 |
| `prisma/migrations/20260908010000_share_link/migration.sql` | 新建 | 建表与四个索引。 |
| `lib/anitabi/share.ts` | 修改（第 14-25、91-127 行） | `MapShareSnapshot` 增 `pointImage`/`bangumiCover`；`buildMapShareImageUrl` 改 async 并返回 R2 公共域 URL。 |
| `app/(site)/map/page.tsx` | 修改（第 17 行） | `await buildMapShareImageUrl`。 |
| `app/ja/map/page.tsx` | 修改（第 17 行） | 同上。 |
| `app/en/map/page.tsx` | 修改（第 17 行） | 同上。 |
| `app/api/anitabi/share-image/route.tsx` | 删除 | 302 到 logo 的紧急降级，已被 R2 直出取代。 |
| `package.json` | 修改（第 61 行） | 移除 `@vercel/og`。 |
| `app/ja/posts/[slug]/page.tsx` | 修改（第 131-145 行） | OG/twitter images 指向 zh 的 `/posts/<slug>/opengraph-image`、`/posts/<slug>/twitter-image`。 |
| `app/en/posts/[slug]/page.tsx` | 修改（第 134-144 行） | 同上。 |
| `app/ja/anime/[id]/page.tsx` | 修改（第 103-113 行） | 指向 `/anime/<id>/opengraph-image`。 |
| `app/en/anime/[id]/page.tsx` | 修改（第 90-102 行） | 把兜底 `/opengraph-image` 换成 `/anime/<id>/opengraph-image`。 |
| `app/ja/city/[id]/page.tsx` | 修改（第 93-105 行） | 换成 `/city/<slug>/opengraph-image`。 |
| `app/en/city/[id]/page.tsx` | 修改（第 96-108 行） | 同上。 |
| `tests/anitabi/share.test.ts` | 修改（第 29-32 行） | 旧断言换成新的三级回退断言。 |
| `tests/share/shortCode.test.ts` | 新建 | 短码格式、字符集、冲突重试。 |
| `tests/share/imageMeta.test.ts` | 新建 | 手工构造的最小 JPEG/WebP 字节数组。 |
| `tests/share/ipHash.test.ts` | 新建 | 哈希稳定性与跨日不同。 |
| `tests/share/links.test.ts` | 新建 | 建短链 handler。 |
| `tests/share/upload.test.ts` | 新建 | 上传 handler 全部校验分支。 |
| `tests/share/media.test.ts` | 新建 | 读图/读实拍 handler。 |
| `tests/share/view.test.ts` | 新建 | 三语标题与跳转目标 URL。 |
| `tests/seo/share-link-metadata.test.ts` | 新建 | `/s/[code]` 的 `generateMetadata` 有/无 `imageKey` 两种情况。 |

### Track B（前端：卡片渲染器、分享面板、面板接入、i18n、删除旧 CheckInCard 入口）

| 文件 | 动作 | 单一职责 |
| --- | --- | --- |
| `lib/i18n/locales/zh.json` | 修改（顶层新增 `share` 命名空间） | 中文分享文案。 |
| `lib/i18n/locales/en.json` | 修改（同上） | 英文。 |
| `lib/i18n/locales/ja.json` | 修改（同上） | 日文。 |
| `components/share/shareText.ts` | 新建 | 文案模板填充与 X/Reddit/LINE 的 URL 构造、短链渠道参数拼接。 |
| `components/share/pointShareCardDraw.ts` | 新建 | 卡片版面纯函数：cover 裁剪矩形、文本换行、两种版式两种布局的槽位。 |
| `components/share/PointShareCard.tsx` | 新建 | canvas 渲染组件：加载图 → 画 → 出 JPEG Blob（>1.5 MB 降质重试一次）。 |
| `components/share/shareClient.ts` | 新建 | 浏览器侧动作：建短链、上传、系统分享/复制图片/复制文案/下载、版式记忆。 |
| `components/share/PointSharePanel.tsx` | 新建 | 面板 UI：预览、版式切换、添加实拍、文案、动作行与平台按钮。 |
| `components/share/CheckInCard.tsx` | 删除 | 能力并入分享面板。 |
| `features/map/anitabi/DetailPanel.tsx` | 修改（第 31、42、66、77、181-190 行） | 点位模式常驻「分享」按钮；删除「打卡卡片」按钮与 `checkedInSelectedPoint`。 |
| `features/map/anitabi/MapDialogs.tsx` | 修改（第 7、66-67、111-112、309-322 行） | 用 `PointSharePanel` 换掉 `CheckInCard` 装配。 |
| `features/map/anitabi/AnitabiMapLayout.tsx` | 修改（第 111、121、189-191、220、512-513、532 行） | 传参改名、去掉 `checkedInSelectedPoint`。 |
| `features/map/anitabi/useAnitabiMapController.ts` | 修改（第 186、856、865 行） | `showCheckInCard` → `showSharePanel` 等行数重命名。 |
| `tests/map/mapDialogs.test.tsx` | 修改（第 55-56 行） | 同步 props 改名。 |
| `tests/components/shareText.test.ts` | 新建 | 文案与平台 URL 编码。 |
| `tests/components/pointShareCardDraw.test.ts` | 新建 | 版面纯函数。 |
| `tests/components/pointSharePanel.test.tsx` | 新建 | 三语渲染、平台按钮 href。 |
| `tests/components/shareClient.test.ts` | 新建 | 建短链/上传的 fetch 契约、版式记忆。 |

**两条 Track 的文件集合不相交。** Track A 不碰 `components/**`、`features/**`、`lib/i18n/locales/**`；Track B 不碰 `prisma/**`、`lib/share/**`（只 import `lib/share/types.ts`）、`app/**`、`package.json`。

### 执行约定

- **Task A1 是同步点**：Track B 必须等 A1 落到 `main`（或 Track B 的 worktree 已 merge 到含 A1 的提交）后才能开工，因为 B 的每个文件都 import `lib/share/types.ts`。
- 每个 Task 结束都跑一次 `npm test`（它会先跑 `node scripts/check-line-budget.mjs`，750 行预算，allowlist 在 `line-budget.allowlist.json`）。
- **`features/map/anitabi/useAnitabiMapController.ts` 现在 883 行，正好等于 allowlist 里给它的 883**，Track B 在该文件里只能做等行数改名，一行都不能加。
- 迁移在部署前对生产库执行，必须同时注入 `DATABASE_URL` 与 `DATABASE_URL_UNPOOLED`。

---

# Track A — 后端

## Task A1: 建共享契约 `lib/share/types.ts`

**Files:**
- Create: `lib/share/types.ts`
- Test: `tests/share/types.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/types.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  SHARE_CARD_SIZES,
  SHARE_CHANNELS,
  SHARE_CHANNEL_UTM_MEDIUM,
  isShareChannel,
  isShareCardLayout,
  shareLinkPath,
} from '@/lib/share/types'

describe('share 契约常量', () => {
  it('两种版式尺寸与设计一致', () => {
    expect(SHARE_CARD_SIZES.portrait).toEqual({ width: 1080, height: 1440 })
    expect(SHARE_CARD_SIZES.landscape).toEqual({ width: 1200, height: 630 })
  })

  it('八个渠道都有 utm_medium 映射', () => {
    expect(SHARE_CHANNELS).toEqual(['x', 'rd', 'ln', 'xhs', 'wx', 'sys', 'copy', 'save'])
    expect(SHARE_CHANNEL_UTM_MEDIUM).toEqual({
      x: 'twitter',
      rd: 'reddit',
      ln: 'line',
      xhs: 'xiaohongshu',
      wx: 'wechat',
      sys: 'native',
      copy: 'copy',
      save: 'image',
    })
  })

  it('守卫函数只认合法值', () => {
    expect(isShareChannel('x')).toBe(true)
    expect(isShareChannel('weibo')).toBe(false)
    expect(isShareCardLayout('portrait')).toBe(true)
    expect(isShareCardLayout('square')).toBe(false)
  })

  it('短链路径按需要带渠道参数', () => {
    expect(shareLinkPath('AbC12xYz')).toBe('/s/AbC12xYz')
    expect(shareLinkPath('AbC12xYz', 'xhs')).toBe('/s/AbC12xYz?c=xhs')
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/types.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/types" from "tests/share/types.test.ts"`，`Test Files  1 failed`。

- [ ] **Step 3: 最小实现 `lib/share/types.ts`**

```ts
import type { SupportedLocale } from '@/lib/i18n/types'

/** 分享卡片版式：竖版给小红书/B 站/微信/Instagram，横版给 X/Reddit/LINE 的链接预览 */
export type ShareCardLayout = 'portrait' | 'landscape'

/** 卡片布局：默认只有动画截图；用户加了实拍才切 compare */
export type ShareCardVariant = 'default' | 'compare'

/** 短链渠道参数 `?c=` 的取值 */
export type ShareChannel = 'x' | 'rd' | 'ln' | 'xhs' | 'wx' | 'sys' | 'copy' | 'save'

export const SHARE_CHANNELS: readonly ShareChannel[] = [
  'x',
  'rd',
  'ln',
  'xhs',
  'wx',
  'sys',
  'copy',
  'save',
] as const

/** `c` → `utm_medium`：/s/[code] 跳转到地图深链时写进 URL */
export const SHARE_CHANNEL_UTM_MEDIUM: Readonly<Record<ShareChannel, string>> = {
  x: 'twitter',
  rd: 'reddit',
  ln: 'line',
  xhs: 'xiaohongshu',
  wx: 'wechat',
  sys: 'native',
  copy: 'copy',
  save: 'image',
}

export const SHARE_CARD_SIZES: Readonly<Record<ShareCardLayout, { width: number; height: number }>> = {
  portrait: { width: 1080, height: 1440 },
  landscape: { width: 1200, height: 630 },
}

/** 卡片体积上限 1.5 MB；客户端超出时降质量重试一次 */
export const SHARE_CARD_MAX_BYTES = 1_500_000
/** 实拍上限 5 MB；HEIC/WebP 由客户端转 JPEG 后再传 */
export const SHARE_PHOTO_MAX_BYTES = 5_000_000

export type CreateShareLinkRequest = {
  pointId: string
  bangumiId: number
  locale: SupportedLocale
  layout: ShareCardLayout
}

export type CreateShareLinkResponse = {
  code: string
  /** 绝对短链，形如 https://seichigo.com/s/AbC12xYz */
  url: string
}

export type ShareUploadResponse = {
  ok: true
  /** 卡片公开读取地址 /api/share/img/<code> */
  imageUrl: string
  /** 写进 UserPointState.photoUrl 的地址；没传 photo 时为 null */
  photoUrl: string | null
}

export type ShareErrorResponse = { error: string }

export function isShareCardLayout(value: unknown): value is ShareCardLayout {
  return value === 'portrait' || value === 'landscape'
}

export function isShareChannel(value: unknown): value is ShareChannel {
  return typeof value === 'string' && (SHARE_CHANNELS as readonly string[]).includes(value)
}

/** 短链相对路径；渠道参数只在真正要发出去时才带 */
export function shareLinkPath(code: string, channel?: ShareChannel): string {
  return channel ? `/s/${code}?c=${channel}` : `/s/${code}`
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/types.test.ts
```

预期：`Test Files  1 passed`，`Tests  4 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/types.ts tests/share/types.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 新增前后端共享的分享 API 契约 lib/share/types.ts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

> **同步点**：本次提交进入 `main` 后 Track B 才能开工。

---

## Task A2: 短码生成与冲突重试 `lib/share/shortCode.ts`

**Files:**
- Create: `lib/share/shortCode.ts`
- Test: `tests/share/shortCode.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/shortCode.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  SHARE_CODE_LENGTH,
  allocateShareCode,
  generateShareCode,
  isShareCode,
} from '@/lib/share/shortCode'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

describe('generateShareCode', () => {
  it('产出 8 位 base62', () => {
    const code = generateShareCode()
    expect(code).toHaveLength(SHARE_CODE_LENGTH)
    expect(code).toMatch(/^[A-Za-z0-9]{8}$/)
  })

  it('丢弃 >=248 的字节以保证 62 个字符等概率', () => {
    // 前 8 个字节全部越界，必须被跳过，最终取到的是后面的 0..7
    const bytes = Uint8Array.from([248, 249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7])
    const code = generateShareCode(() => bytes)
    expect(code).toBe(ALPHABET.slice(0, 8))
  })

  it('1000 次不产生非法字符', () => {
    for (let i = 0; i < 1000; i++) {
      expect(isShareCode(generateShareCode())).toBe(true)
    }
  })
})

describe('isShareCode', () => {
  it('只认 8 位字母数字', () => {
    expect(isShareCode('AbC12xYz')).toBe(true)
    expect(isShareCode('AbC12xY')).toBe(false)
    expect(isShareCode('AbC12xY-')).toBe(false)
    expect(isShareCode(null)).toBe(false)
  })
})

describe('allocateShareCode', () => {
  it('首次成功直接返回', async () => {
    const insert = vi.fn(async (code: string) => ({ code }))
    const result = await allocateShareCode(insert, { generate: () => 'AAAAAAAA' })
    expect(result).toEqual({ code: 'AAAAAAAA' })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('唯一键冲突最多重试到第 3 次', async () => {
    const codes = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC']
    let index = 0
    const insert = vi.fn(async (code: string) => {
      if (code !== 'CCCCCCCC') {
        throw Object.assign(new Error('unique'), { code: 'P2002' })
      }
      return { code }
    })
    const result = await allocateShareCode(insert, { generate: () => codes[index++]! })
    expect(result).toEqual({ code: 'CCCCCCCC' })
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('第 3 次仍冲突就把最后一个错误抛出去', async () => {
    const insert = vi.fn(async () => {
      throw Object.assign(new Error('unique'), { code: 'P2002' })
    })
    await expect(allocateShareCode(insert, { generate: () => 'AAAAAAAA' })).rejects.toThrow('unique')
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('非冲突错误立刻上抛，不重试', async () => {
    const insert = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(allocateShareCode(insert, { generate: () => 'AAAAAAAA' })).rejects.toThrow('db down')
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/shortCode.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/shortCode"`。

- [ ] **Step 3: 最小实现 `lib/share/shortCode.ts`**

```ts
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const SHARE_CODE_LENGTH = 8
export const SHARE_CODE_MAX_ATTEMPTS = 3

/** 62 * 4 = 248：>=248 的字节会让取模偏向前 8 个字符，直接丢弃 */
const REJECT_THRESHOLD = 248

function defaultRandomBytes(size: number): Uint8Array {
  const buffer = new Uint8Array(size)
  globalThis.crypto.getRandomValues(buffer)
  return buffer
}

export function generateShareCode(
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): string {
  let out = ''
  while (out.length < SHARE_CODE_LENGTH) {
    const chunk = randomBytes(SHARE_CODE_LENGTH * 2)
    for (const byte of chunk) {
      if (byte >= REJECT_THRESHOLD) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === SHARE_CODE_LENGTH) break
    }
  }
  return out
}

export function isShareCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{8}$/.test(value)
}

function defaultIsConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/**
 * 冲突重试：insert 抛唯一键冲突（Prisma P2002）时换一个码再试，最多 3 次。
 * 第 3 次仍冲突就把最后一个错误抛出去，交给路由层转 500。
 */
export async function allocateShareCode<T>(
  insert: (code: string) => Promise<T>,
  options?: { generate?: () => string; isConflict?: (error: unknown) => boolean },
): Promise<T> {
  const generate = options?.generate ?? (() => generateShareCode())
  const isConflict = options?.isConflict ?? defaultIsConflict
  let lastError: unknown = new Error('share code allocation failed')
  for (let attempt = 0; attempt < SHARE_CODE_MAX_ATTEMPTS; attempt++) {
    try {
      return await insert(generate())
    } catch (error) {
      if (!isConflict(error)) throw error
      lastError = error
    }
  }
  throw lastError
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/shortCode.test.ts
```

预期：`Tests  8 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/shortCode.ts tests/share/shortCode.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 8 位 base62 短码生成与冲突重试 3 次

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A3: 读文件头解析图片尺寸 `lib/share/imageMeta.ts`

**Files:**
- Create: `lib/share/imageMeta.ts`
- Test: `tests/share/imageMeta.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/imageMeta.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  isAllowedShareCardSize,
  parseImageSize,
  parseJpegSize,
  parseWebpSize,
} from '@/lib/share/imageMeta'

function ascii(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0))
}

/** 最小 JPEG：SOI + 可选 APP0 + SOF0(1200x630) + EOI */
function makeJpeg(width: number, height: number, withApp0: boolean): Uint8Array {
  const app0 = withApp0
    ? [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
    : []
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9])
}

/** 最小有损 WebP：RIFF/WEBP/'VP8 ' + 同步码 9d 01 2a + 14 位宽高 */
function makeWebpLossy(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(ascii('RIFF'), 0)
  bytes.set([22, 0, 0, 0], 4)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8 '), 12)
  bytes.set([10, 0, 0, 0], 16)
  bytes.set([0x00, 0x00, 0x00], 20)
  bytes.set([0x9d, 0x01, 0x2a], 23)
  bytes[26] = width & 0xff
  bytes[27] = (width >> 8) & 0x3f
  bytes[28] = height & 0xff
  bytes[29] = (height >> 8) & 0x3f
  return bytes
}

/** 最小无损 WebP：'VP8L' + 0x2f 签名 + 位域里的 (宽-1)|(高-1)<<14 */
function makeWebpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(ascii('RIFF'), 0)
  bytes.set([22, 0, 0, 0], 4)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8L'), 12)
  bytes.set([10, 0, 0, 0], 16)
  bytes[20] = 0x2f
  const bits = (width - 1) | ((height - 1) << 14)
  bytes[21] = bits & 0xff
  bytes[22] = (bits >>> 8) & 0xff
  bytes[23] = (bits >>> 16) & 0xff
  bytes[24] = (bits >>> 24) & 0xff
  return bytes
}

/** 最小扩展 WebP：'VP8X' + 4 字节标志 + 3 字节小端的画布宽-1/高-1 */
function makeWebpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(ascii('RIFF'), 0)
  bytes.set([22, 0, 0, 0], 4)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8X'), 12)
  bytes.set([10, 0, 0, 0], 16)
  bytes.set([0x10, 0x00, 0x00, 0x00], 20)
  const w = width - 1
  const h = height - 1
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24)
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27)
  return bytes
}

describe('parseJpegSize', () => {
  it('读 SOF0 的宽高', () => {
    expect(parseJpegSize(makeJpeg(1200, 630, false))).toEqual({ width: 1200, height: 630 })
  })

  it('跳过 APP0 段后仍能读到 SOF0', () => {
    expect(parseJpegSize(makeJpeg(1080, 1440, true))).toEqual({ width: 1080, height: 1440 })
  })

  it('不是 JPEG 返回 null', () => {
    expect(parseJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it('只有 SOI 时返回 null', () => {
    expect(parseJpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })
})

describe('parseWebpSize', () => {
  it('VP8 有损', () => {
    expect(parseWebpSize(makeWebpLossy(1080, 1440))).toEqual({ width: 1080, height: 1440 })
  })

  it('VP8L 无损', () => {
    expect(parseWebpSize(makeWebpLossless(1200, 630))).toEqual({ width: 1200, height: 630 })
  })

  it('VP8X 扩展', () => {
    expect(parseWebpSize(makeWebpExtended(1080, 1440))).toEqual({ width: 1080, height: 1440 })
  })

  it('RIFF 头不对返回 null', () => {
    const broken = makeWebpLossy(1080, 1440)
    broken[0] = 0x00
    expect(parseWebpSize(broken)).toBeNull()
  })
})

describe('parseImageSize / isAllowedShareCardSize', () => {
  it('按 contentType 分派', () => {
    expect(parseImageSize(makeJpeg(1080, 1440, false), 'image/jpeg')).toEqual({ width: 1080, height: 1440 })
    expect(parseImageSize(makeWebpLossy(1200, 630), 'image/webp')).toEqual({ width: 1200, height: 630 })
    expect(parseImageSize(makeJpeg(1080, 1440, false), 'image/png')).toBeNull()
  })

  it('只放行 1080x1440 与 1200x630', () => {
    expect(isAllowedShareCardSize({ width: 1080, height: 1440 })).toBe(true)
    expect(isAllowedShareCardSize({ width: 1200, height: 630 })).toBe(true)
    expect(isAllowedShareCardSize({ width: 1080, height: 1350 })).toBe(false)
    expect(isAllowedShareCardSize(null)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/imageMeta.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/imageMeta"`。

- [ ] **Step 3: 最小实现 `lib/share/imageMeta.ts`**

```ts
import { SHARE_CARD_SIZES } from '@/lib/share/types'

export type ImageSize = { width: number; height: number }

/** SOF0..SOF15，扣掉 DHT(C4)、JPG(C8)、DAC(CC) */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0)
  return out
}

/**
 * 只走段头，不解码熵编码数据：SOI 之后逐段跳，遇到 SOF 就读
 * precision(1) + height(2) + width(2)。
 */
export function parseJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4) return null
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    let marker = bytes[offset + 1]!
    // 0xFF 填充字节：连续的 FF 只算一个标记前缀
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1
      marker = bytes[offset + 1]!
    }
    // 无长度字段的独立标记
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // 到了 SOS/EOI 还没见到 SOF，说明这张图读不出尺寸
    if (marker === 0xda || marker === 0xd9) return null

    const length = ((bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
    if (length < 2) return null

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 8 >= bytes.length) return null
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += 2 + length
  }
  return null
}

/**
 * RIFF(0-3) size(4-7) WEBP(8-11) fourcc(12-15) chunkSize(16-19) payload(20-)。
 * VP8 有损：同步码 9d 01 2a 之后是两个 14 位小端宽高。
 * VP8L 无损：0x2f 签名之后 4 字节里 14 位宽-1 + 14 位高-1。
 * VP8X 扩展：4 字节标志之后是 3 字节小端的画布宽-1 / 高-1。
 */
export function parseWebpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null
  if (readAscii(bytes, 0, 4) !== 'RIFF') return null
  if (readAscii(bytes, 8, 4) !== 'WEBP') return null

  const fourcc = readAscii(bytes, 12, 4)

  if (fourcc === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    const width = ((bytes[27]! << 8) | bytes[26]!) & 0x3fff
    const height = ((bytes[29]! << 8) | bytes[28]!) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null
    const bits =
      (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0
    const width = (bits & 0x3fff) + 1
    const height = ((bits >>> 14) & 0x3fff) + 1
    return { width, height }
  }

  if (fourcc === 'VP8X') {
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }

  return null
}

export function parseImageSize(bytes: Uint8Array, contentType: string): ImageSize | null {
  const type = String(contentType || '').trim().toLowerCase()
  if (type === 'image/jpeg' || type === 'image/jpg') return parseJpegSize(bytes)
  if (type === 'image/webp') return parseWebpSize(bytes)
  return null
}

export function isAllowedShareCardSize(size: ImageSize | null): boolean {
  if (!size) return false
  return Object.values(SHARE_CARD_SIZES).some(
    (allowed) => allowed.width === size.width && allowed.height === size.height,
  )
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/imageMeta.test.ts
```

预期：`Tests  10 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/imageMeta.ts tests/share/imageMeta.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 读文件头解析 JPEG/WebP 像素尺寸，不解码整图

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A4: 匿名限流用的 ipHash `lib/share/ipHash.ts`

**Files:**
- Create: `lib/share/ipHash.ts`
- Test: `tests/share/ipHash.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/ipHash.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { hashIp, readClientIp, utcDateStamp } from '@/lib/share/ipHash'

describe('utcDateStamp', () => {
  it('取 UTC 的 YYYY-MM-DD', () => {
    expect(utcDateStamp(new Date('2026-09-08T23:30:00Z'))).toBe('2026-09-08')
    expect(utcDateStamp(new Date('2026-09-09T00:00:01Z'))).toBe('2026-09-09')
  })
})

describe('hashIp', () => {
  it('同 IP 同日稳定，且是 64 位 hex', async () => {
    const day = new Date('2026-09-08T10:00:00Z')
    const a = await hashIp('1.2.3.4', day)
    const b = await hashIp('1.2.3.4', day)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('跨日不同', async () => {
    const a = await hashIp('1.2.3.4', new Date('2026-09-08T10:00:00Z'))
    const b = await hashIp('1.2.3.4', new Date('2026-09-09T10:00:00Z'))
    expect(a).not.toBe(b)
  })

  it('不同 IP 不同', async () => {
    const day = new Date('2026-09-08T10:00:00Z')
    expect(await hashIp('1.2.3.4', day)).not.toBe(await hashIp('1.2.3.5', day))
  })
})

describe('readClientIp', () => {
  it('优先 cf-connecting-ip', () => {
    const req = new Request('https://seichigo.com/api/share/links', {
      headers: { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
    })
    expect(readClientIp(req)).toBe('9.9.9.9')
  })

  it('回落 x-forwarded-for 的第一段', () => {
    const req = new Request('https://seichigo.com/api/share/links', {
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
    })
    expect(readClientIp(req)).toBe('1.1.1.1')
  })

  it('都没有时返回空串', () => {
    expect(readClientIp(new Request('https://seichigo.com/api/share/links'))).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/ipHash.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/ipHash"`。

- [ ] **Step 3: 最小实现 `lib/share/ipHash.ts`**

```ts
function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** 当日盐：UTC 日期字符串。跨日自然过期，不需要清理任务 */
export function utcDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** sha256(ip + 当日 UTC 日期) hex —— 不落原始 IP */
export async function hashIp(ip: string, now: Date = new Date()): Promise<string> {
  const material = `${String(ip || '').trim()}${utcDateStamp(now)}`
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  )
  return bytesToHex(new Uint8Array(digest))
}

export function readClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf && cf.trim()) return cf.trim()
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded && forwarded.trim()) return forwarded.split(',')[0]!.trim()
  return ''
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/ipHash.test.ts
```

预期：`Tests  7 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/ipHash.ts tests/share/ipHash.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 匿名限流用的 sha256(ip + 当日 UTC 日期) 哈希

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A5: Prisma `ShareLink` 模型与迁移

**Files:**
- Modify: `prisma/schema.prisma`（文件尾追加，紧跟 `BillingWebhookEvent`，即当前第 1238 行之后）
- Create: `prisma/migrations/20260908010000_share_link/migration.sql`

- [ ] **Step 1: 追加 model 到 `prisma/schema.prisma` 末尾**

写法对齐 `UserPointState`（`prisma/schema.prisma:839-856`）的 `@@unique`/`@@index` 风格。**不建到 `User` 的外键关系**——一旦加 relation 就要同时改 `User` model 并多生成一段迁移；`userId` 保持裸字符串列。

```prisma
/// 2026-09-08 点位分享：一次分享 = 一条短链。code 是 8 位 base62，服务端生成、
/// 冲突重试 3 次。imageKey 只有登录用户上传卡片后才有；ipHash 是当日盐哈希，
/// 只用于匿名限流，不落原始 IP。userId 不建外键，保持列可空的裸字符串。
model ShareLink {
  id        String   @id @default(cuid())
  code      String   @unique
  kind      String   @default("point")
  pointId   String
  bangumiId Int
  locale    String
  layout    String
  imageKey  String?
  userId    String?
  ipHash    String?
  clicks    Int      @default(0)
  createdAt DateTime @default(now())

  @@index([pointId])
  @@index([userId, createdAt])
  @@index([ipHash, createdAt])
}
```

- [ ] **Step 2: 建迁移目录与 SQL**

命名沿用 `prisma/migrations/2026MMDD000000_<name>`（最近一个是 `20260908000000_asset_r2_storage_columns`），本期用 `20260908010000_share_link`。SQL 写法照抄 `20260907000000_billing_checkout_intent/migration.sql`（带 `"public".` 前缀、`CONSTRAINT "<Model>_pkey"`）。

```bash
mkdir -p prisma/migrations/20260908010000_share_link
```

`prisma/migrations/20260908010000_share_link/migration.sql`：

```sql
-- CreateTable (2026-09-08 点位分享短链：ShareLink)
CREATE TABLE "public"."ShareLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'point',
    "pointId" TEXT NOT NULL,
    "bangumiId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "imageKey" TEXT,
    "userId" TEXT,
    "ipHash" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_code_key" ON "public"."ShareLink"("code");
CREATE INDEX "ShareLink_pointId_idx" ON "public"."ShareLink"("pointId");
CREATE INDEX "ShareLink_userId_createdAt_idx" ON "public"."ShareLink"("userId", "createdAt");
CREATE INDEX "ShareLink_ipHash_createdAt_idx" ON "public"."ShareLink"("ipHash", "createdAt");
```

- [ ] **Step 3: 重新生成 client 并验证**

```bash
npx prisma generate
npx prisma validate
```

预期：`✔ Generated Prisma Client`、`The schema at prisma/schema.prisma is valid 🚀`。
`prisma migrate dev` **不要在这里跑**——本地 `.env` 指向开发库，库里有两条本地缺失的历史迁移，dev 会要求 reset（见 memory `seichigo-db-env-split`）。迁移在部署前用 `prisma migrate deploy` 对生产库执行。

- [ ] **Step 4: 确认类型可用**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

预期：无输出（退出码 0）。

- [ ] **Step 5: commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260908010000_share_link
git commit -m "$(cat <<'EOF'
feat(share): 新增 ShareLink 模型与迁移，userId 不建外键

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A6: `ShareLinkRepo` 接口与内存实现

**Files:**
- Create: `lib/share/repo.ts`
- Create: `lib/share/repoMemory.ts`
- Test: `tests/share/repoMemory.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/repoMemory.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'

function baseInput(overrides: Partial<Parameters<MemoryShareLinkRepo['create']>[0]> = {}) {
  return {
    code: 'AAAAAAAA',
    pointId: '101:station',
    bangumiId: 101,
    locale: 'zh' as const,
    layout: 'portrait' as const,
    userId: null,
    ipHash: 'hash-1',
    ...overrides,
  }
}

describe('MemoryShareLinkRepo', () => {
  it('create 后能按 code 查回', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T00:00:00Z'))
    const created = await repo.create(baseInput())
    expect(created.code).toBe('AAAAAAAA')
    expect(created.clicks).toBe(0)
    expect(created.imageKey).toBeNull()
    expect(await repo.findByCode('AAAAAAAA')).toEqual(created)
    expect(await repo.findByCode('ZZZZZZZZ')).toBeNull()
  })

  it('code 重复抛 P2002', async () => {
    const repo = new MemoryShareLinkRepo()
    await repo.create(baseInput())
    await expect(repo.create(baseInput())).rejects.toMatchObject({ code: 'P2002' })
  })

  it('findRecentDuplicate 只匹配同 point/locale/layout/user 且在窗口内', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput())
    const since = new Date('2026-09-07T12:00:00Z')
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'portrait', userId: null, since }),
    ).not.toBeNull()
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'landscape', userId: null, since }),
    ).toBeNull()
    expect(
      await repo.findRecentDuplicate({ pointId: '101:station', locale: 'zh', layout: 'portrait', userId: 'u1', since }),
    ).toBeNull()
    expect(
      await repo.findRecentDuplicate({
        pointId: '101:station',
        locale: 'zh',
        layout: 'portrait',
        userId: null,
        since: new Date('2026-09-08T13:00:00Z'),
      }),
    ).toBeNull()
  })

  it('countByIpHashSince 只数窗口内同一 ipHash', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput({ code: 'AAAAAAAA' }))
    await repo.create(baseInput({ code: 'BBBBBBBB', layout: 'landscape' }))
    await repo.create(baseInput({ code: 'CCCCCCCC', ipHash: 'hash-2' }))
    expect(await repo.countByIpHashSince('hash-1', new Date('2026-09-07T12:00:00Z'))).toBe(2)
    expect(await repo.countByIpHashSince('hash-1', new Date('2026-09-08T13:00:00Z'))).toBe(0)
  })

  it('markUploaded 写 imageKey 与 userId，countUploadsByUserSince 只数已上传的', async () => {
    const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))
    await repo.create(baseInput({ code: 'AAAAAAAA' }))
    await repo.create(baseInput({ code: 'BBBBBBBB', userId: 'u1', ipHash: null, layout: 'landscape' }))
    const since = new Date('2026-09-07T12:00:00Z')
    expect(await repo.countUploadsByUserSince('u1', since)).toBe(0)
    const updated = await repo.markUploaded('AAAAAAAA', { imageKey: 'share/AAAAAAAA.jpg', userId: 'u1' })
    expect(updated?.imageKey).toBe('share/AAAAAAAA.jpg')
    expect(updated?.userId).toBe('u1')
    expect(await repo.countUploadsByUserSince('u1', since)).toBe(1)
    expect(await repo.markUploaded('ZZZZZZZZ', { imageKey: 'x', userId: 'u1' })).toBeNull()
  })

  it('incrementClicks 累加', async () => {
    const repo = new MemoryShareLinkRepo()
    await repo.create(baseInput())
    await repo.incrementClicks('AAAAAAAA')
    await repo.incrementClicks('AAAAAAAA')
    expect((await repo.findByCode('AAAAAAAA'))?.clicks).toBe(2)
    await expect(repo.incrementClicks('ZZZZZZZZ')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/repoMemory.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/repoMemory"`。

- [ ] **Step 3a: 实现 `lib/share/repo.ts`**

```ts
import type { SupportedLocale } from '@/lib/i18n/types'
import type { ShareCardLayout } from '@/lib/share/types'

export type ShareLinkRecord = {
  id: string
  code: string
  kind: string
  pointId: string
  bangumiId: number
  locale: SupportedLocale
  layout: ShareCardLayout
  imageKey: string | null
  userId: string | null
  ipHash: string | null
  clicks: number
  createdAt: Date
}

export type CreateShareLinkInput = {
  code: string
  pointId: string
  bangumiId: number
  locale: SupportedLocale
  layout: ShareCardLayout
  userId: string | null
  ipHash: string | null
}

export type FindRecentDuplicateInput = {
  pointId: string
  locale: SupportedLocale
  layout: ShareCardLayout
  userId: string | null
  since: Date
}

export interface ShareLinkRepo {
  create(input: CreateShareLinkInput): Promise<ShareLinkRecord>
  findByCode(code: string): Promise<ShareLinkRecord | null>
  /** 24 小时窗口内同 (pointId, locale, layout, userId) 的既有记录 */
  findRecentDuplicate(input: FindRecentDuplicateInput): Promise<ShareLinkRecord | null>
  countByIpHashSince(ipHash: string, since: Date): Promise<number>
  /** 只数 imageKey 非空的记录：配额算的是「上传」而不是「建链」 */
  countUploadsByUserSince(userId: string, since: Date): Promise<number>
  markUploaded(
    code: string,
    input: { imageKey: string; userId: string },
  ): Promise<ShareLinkRecord | null>
  incrementClicks(code: string): Promise<void>
}
```

- [ ] **Step 3b: 实现 `lib/share/repoMemory.ts`**

```ts
import type {
  CreateShareLinkInput,
  FindRecentDuplicateInput,
  ShareLinkRecord,
  ShareLinkRepo,
} from '@/lib/share/repo'

/** handler 单测用的内存实现，行为对齐 PrismaShareLinkRepo（含 code 唯一键 P2002） */
export class MemoryShareLinkRepo implements ShareLinkRepo {
  private readonly rows = new Map<string, ShareLinkRecord>()
  private seq = 0

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    if (this.rows.has(input.code)) {
      throw Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
        code: 'P2002',
      })
    }
    this.seq += 1
    const record: ShareLinkRecord = {
      id: `share_${this.seq}`,
      code: input.code,
      kind: 'point',
      pointId: input.pointId,
      bangumiId: input.bangumiId,
      locale: input.locale,
      layout: input.layout,
      imageKey: null,
      userId: input.userId,
      ipHash: input.ipHash,
      clicks: 0,
      createdAt: this.now(),
    }
    this.rows.set(record.code, record)
    return { ...record }
  }

  async findByCode(code: string): Promise<ShareLinkRecord | null> {
    const found = this.rows.get(code)
    return found ? { ...found } : null
  }

  async findRecentDuplicate(input: FindRecentDuplicateInput): Promise<ShareLinkRecord | null> {
    for (const row of this.rows.values()) {
      if (row.pointId !== input.pointId) continue
      if (row.locale !== input.locale) continue
      if (row.layout !== input.layout) continue
      if ((row.userId ?? null) !== (input.userId ?? null)) continue
      if (row.createdAt.getTime() < input.since.getTime()) continue
      return { ...row }
    }
    return null
  }

  async countByIpHashSince(ipHash: string, since: Date): Promise<number> {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.ipHash !== ipHash) continue
      if (row.createdAt.getTime() < since.getTime()) continue
      count += 1
    }
    return count
  }

  async countUploadsByUserSince(userId: string, since: Date): Promise<number> {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.userId !== userId) continue
      if (!row.imageKey) continue
      if (row.createdAt.getTime() < since.getTime()) continue
      count += 1
    }
    return count
  }

  async markUploaded(
    code: string,
    input: { imageKey: string; userId: string },
  ): Promise<ShareLinkRecord | null> {
    const found = this.rows.get(code)
    if (!found) return null
    found.imageKey = input.imageKey
    found.userId = input.userId
    return { ...found }
  }

  async incrementClicks(code: string): Promise<void> {
    const found = this.rows.get(code)
    if (!found) return
    found.clicks += 1
  }
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/repoMemory.test.ts
```

预期：`Tests  6 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/repo.ts lib/share/repoMemory.ts tests/share/repoMemory.test.ts
git commit -m "$(cat <<'EOF'
feat(share): ShareLinkRepo 接口与内存实现

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A7: Prisma 实现与 R2 存储层

**Files:**
- Create: `lib/share/repoPrisma.ts`
- Create: `lib/share/store.ts`
- Test: `tests/share/store.test.ts`

`repoPrisma.ts` 照 `lib/userPointState/repoPrisma.ts:1-13` 的写法（`import { prisma } from '@/lib/db/prisma'` + 一个 `toRecord` 转换函数）；`store.ts` 照 `lib/asset/store.ts:44-84`（`getCfBindings()?.env?.ASSET_STORE`，拿不到绑定返回 `null`）。

- [ ] **Step 1: 写失败测试 `tests/share/store.test.ts`**（Prisma 实现由 `tests/share/links.test.ts` 之外的集成验证覆盖，这里只测 key 规则与 R2 读写）

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { checkinPhotoKey, getShareStore, shareCardKey } from '@/lib/share/store'
import type { CfBindings } from '@/lib/anitabi/cf/bindings'

const CF_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')
type Bucket = NonNullable<NonNullable<CfBindings['env']>['ASSET_STORE']>

function toStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function installBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const bucket: Bucket = {
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: toStream(found.bytes),
        size: found.bytes.byteLength,
        httpMetadata: { contentType: found.contentType },
      }
    },
    async put(key, value, options) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType })
    },
  }
  ;(globalThis as any)[CF_CONTEXT_SYMBOL] = { env: { ASSET_STORE: bucket } } satisfies CfBindings
  return objects
}

afterEach(() => {
  delete (globalThis as any)[CF_CONTEXT_SYMBOL]
})

describe('share key 规则', () => {
  it('卡片按 contentType 决定扩展名', () => {
    expect(shareCardKey('AbC12xYz', 'image/jpeg')).toBe('share/AbC12xYz.jpg')
    expect(shareCardKey('AbC12xYz', 'image/webp')).toBe('share/AbC12xYz.webp')
  })

  it('实拍固定 jpg，pointId 里的冒号原样进 key', () => {
    expect(checkinPhotoKey('u1', '101:station')).toBe('checkin/u1/101:station.jpg')
  })
})

describe('getShareStore', () => {
  it('没有 ASSET_STORE 绑定时返回 null', () => {
    expect(getShareStore()).toBeNull()
  })

  it('写进去能读回来，contentType 保留', async () => {
    installBucket()
    const store = getShareStore()
    expect(store).not.toBeNull()
    await store!.put('share/AbC12xYz.jpg', Uint8Array.from([1, 2, 3]), 'image/jpeg')
    const got = await store!.get('share/AbC12xYz.jpg')
    expect(got?.contentType).toBe('image/jpeg')
    expect(Array.from(await readAll(got!.body))).toEqual([1, 2, 3])
    expect(await store!.get('share/none.jpg')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/store.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/store"`。

- [ ] **Step 3a: 实现 `lib/share/store.ts`**

```ts
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 分享资产复用 asset 的 R2 桶（绑定名 ASSET_STORE，桶 seichigo-assets）。
 * - 卡片 key：`share/<code>.<jpg|webp>`
 * - 实拍 key：`checkin/<userId>/<pointId>.jpg`
 * 拿不到绑定（next dev / vitest）返回 null，调用方转 503。
 */
export type ShareObject = {
  body: ReadableStream<Uint8Array>
  contentType: string
  size: number
}

export interface ShareStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<ShareObject | null>
}

export function shareCardKey(code: string, contentType: string): string {
  const ext = String(contentType || '').toLowerCase() === 'image/webp' ? 'webp' : 'jpg'
  return `share/${code}.${ext}`
}

export function checkinPhotoKey(userId: string, pointId: string): string {
  return `checkin/${userId}/${pointId}.jpg`
}

type ShareBucket = NonNullable<
  NonNullable<import('@/lib/anitabi/cf/bindings').CfBindings['env']>['ASSET_STORE']
>

class R2ShareStore implements ShareStore {
  constructor(private readonly bucket: ShareBucket) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } })
  }

  async get(key: string): Promise<ShareObject | null> {
    const object = await this.bucket.get(key)
    if (!object) return null
    return {
      body: object.body,
      contentType: String(object.httpMetadata?.contentType || 'application/octet-stream'),
      size: object.size,
    }
  }
}

export function getShareStore(): ShareStore | null {
  const bucket = getCfBindings()?.env?.ASSET_STORE
  if (!bucket) return null
  return new R2ShareStore(bucket)
}
```

- [ ] **Step 3b: 实现 `lib/share/repoPrisma.ts`**

```ts
import type { ShareLink as PrismaShareLink } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { isPrismaKnownRequestError } from '@/lib/db/prismaError'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  CreateShareLinkInput,
  FindRecentDuplicateInput,
  ShareLinkRecord,
  ShareLinkRepo,
} from '@/lib/share/repo'
import type { ShareCardLayout } from '@/lib/share/types'

function toRecord(row: PrismaShareLink): ShareLinkRecord {
  return {
    ...row,
    locale: row.locale as SupportedLocale,
    layout: row.layout as ShareCardLayout,
  }
}

export class PrismaShareLinkRepo implements ShareLinkRepo {
  async create(input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const created = await prisma.shareLink.create({
      data: {
        code: input.code,
        kind: 'point',
        pointId: input.pointId,
        bangumiId: input.bangumiId,
        locale: input.locale,
        layout: input.layout,
        userId: input.userId,
        ipHash: input.ipHash,
      },
    })
    return toRecord(created)
  }

  async findByCode(code: string): Promise<ShareLinkRecord | null> {
    const found = await prisma.shareLink.findUnique({ where: { code } })
    return found ? toRecord(found) : null
  }

  async findRecentDuplicate(input: FindRecentDuplicateInput): Promise<ShareLinkRecord | null> {
    const found = await prisma.shareLink.findFirst({
      where: {
        pointId: input.pointId,
        locale: input.locale,
        layout: input.layout,
        userId: input.userId,
        createdAt: { gte: input.since },
      },
      orderBy: { createdAt: 'desc' },
    })
    return found ? toRecord(found) : null
  }

  async countByIpHashSince(ipHash: string, since: Date): Promise<number> {
    return prisma.shareLink.count({ where: { ipHash, createdAt: { gte: since } } })
  }

  async countUploadsByUserSince(userId: string, since: Date): Promise<number> {
    return prisma.shareLink.count({
      where: { userId, imageKey: { not: null }, createdAt: { gte: since } },
    })
  }

  async markUploaded(
    code: string,
    input: { imageKey: string; userId: string },
  ): Promise<ShareLinkRecord | null> {
    try {
      const updated = await prisma.shareLink.update({
        where: { code },
        data: { imageKey: input.imageKey, userId: input.userId },
      })
      return toRecord(updated)
    } catch (error) {
      if (isPrismaKnownRequestError(error) && error.code === 'P2025') return null
      throw error
    }
  }

  async incrementClicks(code: string): Promise<void> {
    // updateMany：短码不存在时是 count=0 而不是抛 P2025，正好适合 fire-and-forget
    await prisma.shareLink.updateMany({ where: { code }, data: { clicks: { increment: 1 } } })
  }
}
```

- [ ] **Step 4: 跑通过并类型检查**

```bash
npx vitest run --project node tests/share/store.test.ts && npx tsc -p tsconfig.app.json --noEmit
```

预期：`Tests  4 passed`，`tsc` 无输出。

- [ ] **Step 5: commit**

```bash
git add lib/share/repoPrisma.ts lib/share/store.ts tests/share/store.test.ts
git commit -m "$(cat <<'EOF'
feat(share): ShareLink 的 Prisma 实现与 R2 分享对象存储层

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A8: 依赖装配与 `ctx.waitUntil` 包装

**Files:**
- Create: `lib/share/background.ts`
- Create: `lib/share/api.ts`
- Test: `tests/share/background.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/background.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runShareBackground } from '@/lib/share/background'

const CF_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

afterEach(() => {
  delete (globalThis as any)[CF_CONTEXT_SYMBOL]
  vi.restoreAllMocks()
})

describe('runShareBackground', () => {
  it('有 ctx 时以 ctx 为 this 调用 waitUntil，不 await', async () => {
    const seen: unknown[] = []
    const ctx = {
      marker: 'ctx',
      waitUntil(promise: Promise<unknown>) {
        // 解构调用会丢 this 抛 Illegal invocation，这里断言 this 还在
        expect((this as { marker?: string }).marker).toBe('ctx')
        seen.push(promise)
      },
    }
    ;(globalThis as any)[CF_CONTEXT_SYMBOL] = { ctx }
    runShareBackground(Promise.resolve('ok'))
    expect(seen).toHaveLength(1)
  })

  it('没有 ctx 时吞掉 rejection，不炸调用方', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runShareBackground(Promise.reject(new Error('boom')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(error).toHaveBeenCalledWith('[share.background.failed]', expect.any(Object))
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/background.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/background"`。

- [ ] **Step 3a: 实现 `lib/share/background.ts`**

```ts
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 点击计数这类后台收尾：有 waitUntil 就挂上去，拿不到（next dev / vitest）就自生自灭。
 * 必须以 ctx 为 this 调用 —— 把 waitUntil 拆下来单独调用会抛 "Illegal invocation"
 * （2026-09-08 资产迁 R2 上线后实测，见 lib/asset/handlers.ts:114-121）。
 */
export function runShareBackground(promise: Promise<unknown>): void {
  const guarded = promise.then(
    () => undefined,
    (error: unknown) => {
      console.error('[share.background.failed]', {
        event: 'share_background_failed',
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
      })
    },
  )
  const ctx = getCfBindings()?.ctx
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(guarded)
  }
}
```

- [ ] **Step 3b: 实现 `lib/share/api.ts`**（照 `lib/userPointState/api.ts:14-35` 的懒加载 + 模块级缓存写法）

```ts
import type { Session } from 'next-auth'
import type { UserPointStateRepo } from '@/lib/userPointState/repo'
import type { ShareLinkRepo } from '@/lib/share/repo'
import type { ShareStore } from '@/lib/share/store'

export type ShareApiDeps = {
  repo: ShareLinkRepo
  pointStateRepo: UserPointStateRepo
  /** 每次请求现取：R2 绑定挂在 per-request 的 cloudflare context 上 */
  getStore: () => ShareStore | null
  getSession: () => Promise<Session | null>
  now: () => Date
  /** 站点权威 origin，用于拼绝对短链与绝对 OG 图 URL */
  origin: string
}

let cached: ShareApiDeps | null = null

export async function getShareApiDeps(): Promise<ShareApiDeps> {
  if (cached) return cached

  const [{ PrismaShareLinkRepo }, { PrismaUserPointStateRepo }, { getShareStore }, { getServerAuthSession }, { getSiteOrigin }] =
    await Promise.all([
      import('@/lib/share/repoPrisma'),
      import('@/lib/userPointState/repoPrisma'),
      import('@/lib/share/store'),
      import('@/lib/auth/session'),
      import('@/lib/seo/site'),
    ])

  cached = {
    repo: new PrismaShareLinkRepo(),
    pointStateRepo: new PrismaUserPointStateRepo(),
    getStore: getShareStore,
    getSession: getServerAuthSession,
    now: () => new Date(),
    origin: getSiteOrigin(),
  }

  return cached
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/background.test.ts && npx tsc -p tsconfig.app.json --noEmit
```

预期：`Tests  2 passed`，`tsc` 无输出。

- [ ] **Step 5: commit**

```bash
git add lib/share/background.ts lib/share/api.ts tests/share/background.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 分享依赖装配与以 ctx 为 this 调用的 waitUntil 包装

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A9: `POST /api/share/links`

**Files:**
- Create: `lib/share/handlers/links.ts`
- Create: `app/api/share/links/route.ts`
- Test: `tests/share/links.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/links.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { ANON_DAILY_LINK_LIMIT, createPostShareLinkHandler } from '@/lib/share/handlers/links'
import type { ShareApiDeps } from '@/lib/share/api'

const NOW = new Date('2026-09-08T12:00:00Z')

function makeDeps(overrides?: { repo?: MemoryShareLinkRepo; userId?: string | null }): ShareApiDeps {
  const repo = overrides?.repo ?? new MemoryShareLinkRepo(() => NOW)
  return {
    repo,
    pointStateRepo: {} as ShareApiDeps['pointStateRepo'],
    getStore: () => null,
    getSession: async () =>
      overrides?.userId ? ({ user: { id: overrides.userId } } as any) : null,
    now: () => NOW,
    origin: 'https://seichigo.com',
  }
}

function makeRequest(body: unknown, ip = '1.2.3.4') {
  return new Request('https://seichigo.com/api/share/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  })
}

const VALID = { pointId: '101:station', bangumiId: 101, locale: 'zh', layout: 'portrait' }

describe('POST /api/share/links', () => {
  it('匿名也能建，返回 201 与绝对短链', async () => {
    const handler = createPostShareLinkHandler(makeDeps())
    const res = await handler(makeRequest(VALID))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.code).toMatch(/^[A-Za-z0-9]{8}$/)
    expect(json.url).toBe(`https://seichigo.com/s/${json.code}`)
  })

  it('24 小时内同 point/locale/layout/匿名 复用旧记录，返回 200', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo }))
    const first = await (await handler(makeRequest(VALID))).json()
    const res = await handler(makeRequest(VALID))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe(first.code)
  })

  it('换版式就是新记录', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo }))
    const a = await (await handler(makeRequest(VALID))).json()
    const b = await (await handler(makeRequest({ ...VALID, layout: 'landscape' }))).json()
    expect(b.code).not.toBe(a.code)
  })

  it('登录用户不写 ipHash', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const handler = createPostShareLinkHandler(makeDeps({ repo, userId: 'u1' }))
    const { code } = await (await handler(makeRequest(VALID))).json()
    const row = await repo.findByCode(code)
    expect(row?.userId).toBe('u1')
    expect(row?.ipHash).toBeNull()
  })

  it('匿名超过每日上限返回 429', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const deps = makeDeps({ repo })
    vi.spyOn(repo, 'countByIpHashSince').mockResolvedValue(ANON_DAILY_LINK_LIMIT)
    const res = await createPostShareLinkHandler(deps)(makeRequest({ ...VALID, layout: 'landscape' }))
    expect(res.status).toBe(429)
  })

  it('参数不合法返回 400', async () => {
    const handler = createPostShareLinkHandler(makeDeps())
    expect((await handler(makeRequest({ ...VALID, layout: 'square' }))).status).toBe(400)
    expect((await handler(makeRequest({ ...VALID, bangumiId: 0 }))).status).toBe(400)
    expect((await handler(makeRequest({ ...VALID, locale: 'ko' }))).status).toBe(400)
    expect((await handler(makeRequest({ ...VALID, pointId: '' }))).status).toBe(400)
  })

  it('短码冲突时换码重试而不是 500', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const original = repo.create.bind(repo)
    let calls = 0
    vi.spyOn(repo, 'create').mockImplementation(async (input) => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('unique'), { code: 'P2002' })
      return original(input)
    })
    const res = await createPostShareLinkHandler(makeDeps({ repo }))(makeRequest(VALID))
    expect(res.status).toBe(201)
    expect(calls).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/links.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/handlers/links"`。

- [ ] **Step 3a: 实现 `lib/share/handlers/links.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ShareApiDeps } from '@/lib/share/api'
import { hashIp, readClientIp } from '@/lib/share/ipHash'
import { allocateShareCode } from '@/lib/share/shortCode'
import type { CreateShareLinkResponse } from '@/lib/share/types'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 匿名每 24 小时最多 100 条短链（按 ipHash 数 ShareLink 表；wrangler 里没有 KV
 * 绑定，计数方式同 lib/tripPlan/repoPrisma.ts:261 的按日配额）。登录用户不受
 * 这条限制，改由上传配额兜底 —— 否则同一 NAT 出口下的用户会互相挤兑。
 */
export const ANON_DAILY_LINK_LIMIT = 100

const bodySchema = z.object({
  pointId: z.string().min(1).max(200),
  bangumiId: z.number().int().positive(),
  locale: z.enum(['zh', 'en', 'ja']),
  layout: z.enum(['portrait', 'landscape']),
})

function toResponse(code: string, origin: string): CreateShareLinkResponse {
  return { code, url: `${origin}/s/${code}` }
}

export function createPostShareLinkHandler(deps: ShareApiDeps) {
  return async function postShareLink(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 },
      )
    }

    const now = deps.now()
    const since = new Date(now.getTime() - DAY_MS)
    const session = await deps.getSession()
    const userId = String(session?.user?.id || '').trim() || null
    const ipHash = userId ? null : await hashIp(readClientIp(req), now)

    const existing = await deps.repo.findRecentDuplicate({
      pointId: parsed.data.pointId,
      locale: parsed.data.locale,
      layout: parsed.data.layout,
      userId,
      since,
    })
    if (existing) {
      return NextResponse.json(toResponse(existing.code, deps.origin), { status: 200 })
    }

    if (!userId && ipHash) {
      const used = await deps.repo.countByIpHashSince(ipHash, since)
      if (used >= ANON_DAILY_LINK_LIMIT) {
        return NextResponse.json({ error: '今日分享次数已达上限，请明天再试' }, { status: 429 })
      }
    }

    const created = await allocateShareCode((code) =>
      deps.repo.create({
        code,
        pointId: parsed.data.pointId,
        bangumiId: parsed.data.bangumiId,
        locale: parsed.data.locale,
        layout: parsed.data.layout,
        userId,
        ipHash,
      }),
    )

    return NextResponse.json(toResponse(created.code, deps.origin), { status: 201 })
  }
}
```

- [ ] **Step 3b: 实现 `app/api/share/links/route.ts`**（壳子照 `app/api/me/point-states/route.ts:37-45` 的 try/catch 包裹）

```ts
import { NextResponse } from 'next/server'
import { getShareApiDeps } from '@/lib/share/api'
import { createPostShareLinkHandler } from '@/lib/share/handlers/links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const deps = await getShareApiDeps()
    return await createPostShareLinkHandler(deps)(req)
  } catch (err) {
    console.error('[api/share/links] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/links.test.ts
```

预期：`Tests  7 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/handlers/links.ts app/api/share/links/route.ts tests/share/links.test.ts
git commit -m "$(cat <<'EOF'
feat(share): POST /api/share/links 建短链，匿名可用并按 ipHash 限流

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A10: `POST /api/share/links/[code]/upload`

**Files:**
- Create: `lib/share/handlers/upload.ts`
- Create: `app/api/share/links/[code]/upload/route.ts`
- Test: `tests/share/upload.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/upload.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { USER_DAILY_UPLOAD_LIMIT, createPostShareUploadHandler } from '@/lib/share/handlers/upload'
import type { ShareApiDeps } from '@/lib/share/api'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

function jpeg(width: number, height: number, padTo = 0): Uint8Array {
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]
  const head = Uint8Array.from([0xff, 0xd8, ...sof, 0xff, 0xd9])
  if (padTo <= head.byteLength) return head
  const out = new Uint8Array(padTo)
  out.set(head, 0)
  return out
}

function makeStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(found.bytes)
            c.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
  }
  return { store, objects }
}

function makeDeps(input: {
  repo: MemoryShareLinkRepo
  store: ShareStore | null
  userId: string | null
  upsert?: ReturnType<typeof vi.fn>
}): ShareApiDeps {
  return {
    repo: input.repo,
    pointStateRepo: { upsert: input.upsert ?? vi.fn(async () => ({})) } as any,
    getStore: () => input.store,
    getSession: async () => (input.userId ? ({ user: { id: input.userId } } as any) : null),
    now: () => NOW,
    origin: 'https://seichigo.com',
  }
}

async function seed(repo: MemoryShareLinkRepo, userId: string | null = null) {
  await repo.create({
    code: 'AbC12xYz',
    pointId: '101:station',
    bangumiId: 101,
    locale: 'zh',
    layout: 'portrait',
    userId,
    ipHash: userId ? null : 'h1',
  })
}

function makeRequest(form: FormData) {
  return new Request('https://seichigo.com/api/share/links/AbC12xYz/upload', {
    method: 'POST',
    body: form,
  })
}

const ctx = { params: Promise.resolve({ code: 'AbC12xYz' }) }

function cardForm(bytes: Uint8Array, type = 'image/jpeg') {
  const form = new FormData()
  form.set('card', new File([bytes], 'card.jpg', { type }))
  return form
}

describe('POST /api/share/links/[code]/upload', () => {
  it('未登录 401', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: null }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(401)
  })

  it('短链不存在 404', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(404)
  })

  it('短链已属于别人 403', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo, 'u2')
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(403)
  })

  it('卡片类型不对 415、过大 413、尺寸不对 422', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store } = makeStore()
    const handler = createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1440), 'image/png')), ctx)).status).toBe(415)
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1440, 1_600_000))), ctx)).status).toBe(413)
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1350))), ctx)).status).toBe(422)
  })

  it('合法卡片写进 R2 并回填 imageKey/userId', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store, objects } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1200, 630))),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      imageUrl: '/api/share/img/AbC12xYz',
      photoUrl: null,
    })
    expect(objects.has('share/AbC12xYz.jpg')).toBe(true)
    const row = await repo.findByCode('AbC12xYz')
    expect(row?.imageKey).toBe('share/AbC12xYz.jpg')
    expect(row?.userId).toBe('u1')
  })

  it('带 photo 时写 checkin key 并回写 UserPointState', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store, objects } = makeStore()
    const upsert = vi.fn(async () => ({}))
    const form = cardForm(jpeg(1080, 1440))
    form.set('photo', new File([jpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }))
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1', upsert }))(
      makeRequest(form),
      ctx,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).photoUrl).toBe('/api/share/photo/u1/101%3Astation')
    expect(objects.has('checkin/u1/101:station.jpg')).toBe(true)
    expect(upsert).toHaveBeenCalledWith('u1', '101:station', 'checked_in', {
      photoUrl: '/api/share/photo/u1/101%3Astation',
      checkedInAt: NOW,
    })
  })

  it('photo 只收 JPEG', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const { store } = makeStore()
    const form = cardForm(jpeg(1080, 1440))
    form.set('photo', new File([jpeg(800, 600)], 'p.webp', { type: 'image/webp' }))
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(form),
      ctx,
    )
    expect(res.status).toBe(415)
  })

  it('每用户每日 30 次上限', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    vi.spyOn(repo, 'countUploadsByUserSince').mockResolvedValue(USER_DAILY_UPLOAD_LIMIT)
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(429)
  })

  it('拿不到 R2 绑定 503', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo)
    const res = await createPostShareUploadHandler(makeDeps({ repo, store: null, userId: 'u1' }))(
      makeRequest(cardForm(jpeg(1080, 1440))),
      ctx,
    )
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/upload.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/handlers/upload"`。

- [ ] **Step 3a: 实现 `lib/share/handlers/upload.ts`**

```ts
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
```

- [ ] **Step 3b: 实现 `app/api/share/links/[code]/upload/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getShareApiDeps } from '@/lib/share/api'
import { createPostShareUploadHandler } from '@/lib/share/handlers/upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const deps = await getShareApiDeps()
    return await createPostShareUploadHandler(deps)(req, ctx)
  } catch (err) {
    console.error('[api/share/links/upload] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/upload.test.ts
```

预期：`Tests  9 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/handlers/upload.ts "app/api/share/links/[code]/upload/route.ts" tests/share/upload.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 登录后上传卡片与实拍，校验类型/大小/像素尺寸并回写打卡

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A11: 公开读图 `GET /api/share/img/[code]` 与 `GET /api/share/photo/[userId]/[pointId]`

**Files:**
- Create: `lib/share/handlers/media.ts`
- Create: `app/api/share/img/[code]/route.ts`
- Create: `app/api/share/photo/[userId]/[pointId]/route.ts`
- Test: `tests/share/media.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/media.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { createGetCheckinPhotoHandler, createGetShareImageHandler } from '@/lib/share/handlers/media'
import type { ShareStore } from '@/lib/share/store'

function makeStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(found.bytes)
            c.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
  }
  return { store, objects }
}

const req = new Request('https://seichigo.com/api/share/img/AbC12xYz')

describe('GET /api/share/img/[code]', () => {
  it('命中时带一年不可变缓存', async () => {
    const repo = new MemoryShareLinkRepo()
    await repo.create({
      code: 'AbC12xYz',
      pointId: '101:station',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
      userId: 'u1',
      ipHash: null,
    })
    await repo.markUploaded('AbC12xYz', { imageKey: 'share/AbC12xYz.jpg', userId: 'u1' })
    const { store, objects } = makeStore()
    objects.set('share/AbC12xYz.jpg', { bytes: Uint8Array.from([1, 2]), contentType: 'image/jpeg' })

    const res = await createGetShareImageHandler({ repo, getStore: () => store })(req, {
      params: Promise.resolve({ code: 'AbC12xYz' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('短码非法、记录缺失、imageKey 为空、对象缺失都 404', async () => {
    const repo = new MemoryShareLinkRepo()
    const { store } = makeStore()
    const handler = createGetShareImageHandler({ repo, getStore: () => store })
    expect((await handler(req, { params: Promise.resolve({ code: 'bad' }) })).status).toBe(404)
    expect((await handler(req, { params: Promise.resolve({ code: 'ZZZZZZZZ' }) })).status).toBe(404)
    await repo.create({
      code: 'AbC12xYz',
      pointId: 'p',
      bangumiId: 1,
      locale: 'zh',
      layout: 'portrait',
      userId: null,
      ipHash: null,
    })
    expect((await handler(req, { params: Promise.resolve({ code: 'AbC12xYz' }) })).status).toBe(404)
  })
})

describe('GET /api/share/photo/[userId]/[pointId]', () => {
  it('按 checkin key 读回', async () => {
    const { store, objects } = makeStore()
    objects.set('checkin/u1/101:station.jpg', {
      bytes: Uint8Array.from([9]),
      contentType: 'image/jpeg',
    })
    const res = await createGetCheckinPhotoHandler({ getStore: () => store })(req, {
      params: Promise.resolve({ userId: 'u1', pointId: '101:station' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('路径穿越被挡下', async () => {
    const { store } = makeStore()
    const res = await createGetCheckinPhotoHandler({ getStore: () => store })(req, {
      params: Promise.resolve({ userId: '../u1', pointId: 'p' }),
    })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/media.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/handlers/media"`。

- [ ] **Step 3a: 实现 `lib/share/handlers/media.ts`**

```ts
import type { ShareLinkRepo } from '@/lib/share/repo'
import { checkinPhotoKey, type ShareStore } from '@/lib/share/store'
import { isShareCode } from '@/lib/share/shortCode'

const IMMUTABLE = 'public, max-age=31536000, immutable'

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function imageHeaders(contentType: string): Headers {
  const headers = new Headers()
  headers.set('content-type', contentType || 'image/jpeg')
  headers.set('cache-control', IMMUTABLE)
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

/** ASSET_STORE 没有公共域，卡片一律走这条路由（与 /assets/<id> 同一套路） */
export function createGetShareImageHandler(deps: {
  repo: ShareLinkRepo
  getStore: () => ShareStore | null
}) {
  return async function getShareImage(
    _req: Request,
    ctx: { params: Promise<{ code: string }> },
  ): Promise<Response> {
    const { code } = await ctx.params
    if (!isShareCode(code)) return notFound()
    const link = await deps.repo.findByCode(code)
    if (!link?.imageKey) return notFound()
    const store = deps.getStore()
    if (!store) return notFound()
    const object = await store.get(link.imageKey).catch(() => null)
    if (!object) return notFound()
    return new Response(object.body, { status: 200, headers: imageHeaders(object.contentType) })
  }
}

/** UserPointState.photoUrl 指过来的公开读取地址 */
export function createGetCheckinPhotoHandler(deps: { getStore: () => ShareStore | null }) {
  return async function getCheckinPhoto(
    _req: Request,
    ctx: { params: Promise<{ userId: string; pointId: string }> },
  ): Promise<Response> {
    const { userId, pointId } = await ctx.params
    if (!userId || !pointId) return notFound()
    // Next 会把 %2F 解码回 /，显式挡掉路径穿越
    if (userId.includes('/') || pointId.includes('/')) return notFound()
    if (userId.includes('..') || pointId.includes('..')) return notFound()
    const store = deps.getStore()
    if (!store) return notFound()
    const object = await store.get(checkinPhotoKey(userId, pointId)).catch(() => null)
    if (!object) return notFound()
    return new Response(object.body, { status: 200, headers: imageHeaders(object.contentType) })
  }
}
```

- [ ] **Step 3b: 实现两个路由壳**

`app/api/share/img/[code]/route.ts`：

```ts
import { getShareApiDeps } from '@/lib/share/api'
import { createGetShareImageHandler } from '@/lib/share/handlers/media'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const deps = await getShareApiDeps()
    return await createGetShareImageHandler({ repo: deps.repo, getStore: deps.getStore })(req, ctx)
  } catch (err) {
    console.error('[api/share/img] GET failed', err)
    return new Response('Not found', { status: 404 })
  }
}
```

`app/api/share/photo/[userId]/[pointId]/route.ts`：

```ts
import { getShareApiDeps } from '@/lib/share/api'
import { createGetCheckinPhotoHandler } from '@/lib/share/handlers/media'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ userId: string; pointId: string }> }) {
  try {
    const deps = await getShareApiDeps()
    return await createGetCheckinPhotoHandler({ getStore: deps.getStore })(req, ctx)
  } catch (err) {
    console.error('[api/share/photo] GET failed', err)
    return new Response('Not found', { status: 404 })
  }
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/media.test.ts
```

预期：`Tests  4 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/handlers/media.ts "app/api/share/img/[code]/route.ts" "app/api/share/photo/[userId]/[pointId]/route.ts" tests/share/media.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 卡片与实拍的公开读取路由，一年不可变缓存

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A12: `/s/[code]` 的三语文案与跳转目标 `lib/share/view.ts`

**Files:**
- Create: `lib/share/view.ts`
- Test: `tests/share/view.test.ts`

- [ ] **Step 1: 写失败测试 `tests/share/view.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { buildShareDescription, buildShareRedirectTarget, buildShareTitle } from '@/lib/share/view'

describe('buildShareTitle', () => {
  it('三语标题', () => {
    expect(buildShareTitle({ locale: 'zh', pointName: '须贺神社', bangumiTitle: '你的名字。' }))
      .toBe('须贺神社｜《你的名字。》圣地巡礼 | SeichiGo')
    expect(buildShareTitle({ locale: 'ja', pointName: '須賀神社', bangumiTitle: '君の名は。' }))
      .toBe('須賀神社｜『君の名は。』聖地巡礼 | SeichiGo')
    expect(buildShareTitle({ locale: 'en', pointName: 'Suga Shrine', bangumiTitle: 'Your Name' }))
      .toBe('Suga Shrine | Your Name anime pilgrimage | SeichiGo')
  })

  it('地名缺失时退回作品名', () => {
    expect(buildShareTitle({ locale: 'zh', pointName: '', bangumiTitle: '你的名字。' }))
      .toBe('《你的名字。》圣地巡礼 | SeichiGo')
  })
})

describe('buildShareDescription', () => {
  it('城市与集数都有时都写进去', () => {
    expect(buildShareDescription({ locale: 'zh', bangumiTitle: '你的名字。', city: '东京', ep: '1' }))
      .toBe('《你的名字。》在东京的取景地（第 1 集）。打开 SeichiGo 地图查看点位、周边点与路线。')
    expect(buildShareDescription({ locale: 'ja', bangumiTitle: '君の名は。', city: '東京', ep: '1' }))
      .toBe('『君の名は。』東京のロケ地（第1話）。SeichiGo のマップでスポットと周辺ルートを確認できます。')
    expect(buildShareDescription({ locale: 'en', bangumiTitle: 'Your Name', city: 'Tokyo', ep: '1' }))
      .toBe('A Your Name filming location in Tokyo (episode 1). Open the SeichiGo map for this spot and nearby routes.')
  })

  it('城市与集数缺失时不留空括号', () => {
    expect(buildShareDescription({ locale: 'zh', bangumiTitle: '你的名字。', city: null, ep: null }))
      .toBe('《你的名字。》的取景地。打开 SeichiGo 地图查看点位、周边点与路线。')
  })
})

describe('buildShareRedirectTarget', () => {
  it('zh 无前缀，参数顺序固定', () => {
    expect(
      buildShareRedirectTarget({ locale: 'zh', bangumiId: 101, pointId: '101:station', channel: 'x' }),
    ).toBe('/map?b=101&p=101%3Astation&utm_source=share&utm_medium=twitter&utm_campaign=point_card')
  })

  it('ja/en 带语言前缀', () => {
    expect(
      buildShareRedirectTarget({ locale: 'ja', bangumiId: 101, pointId: 'p1', channel: 'ln' }),
    ).toBe('/ja/map?b=101&p=p1&utm_source=share&utm_medium=line&utm_campaign=point_card')
    expect(
      buildShareRedirectTarget({ locale: 'en', bangumiId: 101, pointId: 'p1', channel: 'rd' }),
    ).toBe('/en/map?b=101&p=p1&utm_source=share&utm_medium=reddit&utm_campaign=point_card')
  })

  it('渠道缺失或非法时 utm_medium 记 unknown', () => {
    expect(
      buildShareRedirectTarget({ locale: 'zh', bangumiId: 101, pointId: 'p1', channel: null }),
    ).toBe('/map?b=101&p=p1&utm_source=share&utm_medium=unknown&utm_campaign=point_card')
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/share/view.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/lib/share/view"`。

- [ ] **Step 3: 实现 `lib/share/view.ts`**

```ts
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CHANNEL_UTM_MEDIUM, isShareChannel } from '@/lib/share/types'

export function buildShareTitle(input: {
  locale: SupportedLocale
  pointName: string
  bangumiTitle: string
}): string {
  const point = String(input.pointName || '').trim()
  const anime = String(input.bangumiTitle || '').trim()
  if (input.locale === 'en') {
    const tail = `${anime} anime pilgrimage | SeichiGo`
    return point ? `${point} | ${tail}` : tail
  }
  if (input.locale === 'ja') {
    const tail = `『${anime}』聖地巡礼 | SeichiGo`
    return point ? `${point}｜${tail}` : tail
  }
  const tail = `《${anime}》圣地巡礼 | SeichiGo`
  return point ? `${point}｜${tail}` : tail
}

export function buildShareDescription(input: {
  locale: SupportedLocale
  bangumiTitle: string
  city: string | null
  ep: string | null
}): string {
  const anime = String(input.bangumiTitle || '').trim()
  const city = String(input.city || '').trim()
  const ep = String(input.ep || '').trim()

  if (input.locale === 'en') {
    const where = city ? ` in ${city}` : ''
    const episode = ep ? ` (episode ${ep})` : ''
    return `A ${anime} filming location${where}${episode}. Open the SeichiGo map for this spot and nearby routes.`
  }
  if (input.locale === 'ja') {
    const where = city ? `${city}の` : ''
    const episode = ep ? `（第${ep}話）` : ''
    return `『${anime}』${where}ロケ地${episode}。SeichiGo のマップでスポットと周辺ルートを確認できます。`
  }
  const where = city ? `在${city}的` : '的'
  const episode = ep ? `（第 ${ep} 集）` : ''
  return `《${anime}》${where}取景地${episode}。打开 SeichiGo 地图查看点位、周边点与路线。`
}

/**
 * 短链跳转目标：地图深链 + utm 三件套。`c` 的映射见 lib/share/types.ts 的
 * SHARE_CHANNEL_UTM_MEDIUM；参数顺序靠 URLSearchParams 的插入序保证。
 */
export function buildShareRedirectTarget(input: {
  locale: SupportedLocale
  bangumiId: number
  pointId: string
  channel: string | null
}): string {
  const prefix = input.locale === 'zh' ? '' : `/${input.locale}`
  const params = new URLSearchParams()
  params.set('b', String(input.bangumiId))
  params.set('p', input.pointId)
  params.set('utm_source', 'share')
  params.set('utm_medium', isShareChannel(input.channel) ? SHARE_CHANNEL_UTM_MEDIUM[input.channel] : 'unknown')
  params.set('utm_campaign', 'point_card')
  return `${prefix}/map?${params.toString()}`
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/share/view.test.ts
```

预期：`Tests  6 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/share/view.ts tests/share/view.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 短链页的三语标题描述与带 utm 的跳转目标构造

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A13: 短链页 `app/s/[code]/page.tsx`

**Files:**
- Create: `app/s/[code]/page.tsx`
- Test: `tests/seo/share-link-metadata.test.ts`

页面挂在 `app/` 根下，只被 `app/layout.tsx`（第 60-88 行）包裹，不进 `(site)` 的站点框架。**不能用 `next/navigation` 的 `redirect`**：爬虫要先读到 OG 才跳。

- [ ] **Step 1: 写失败测试 `tests/seo/share-link-metadata.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'

const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))

vi.mock('@/lib/share/api', () => ({
  getShareApiDeps: async () => ({
    repo,
    pointStateRepo: {},
    getStore: () => null,
    getSession: async () => null,
    now: () => new Date('2026-09-08T12:00:00Z'),
    origin: 'https://seichigo.com',
  }),
}))

const resolveMapShareSnapshotMock = vi.fn()
vi.mock('@/lib/anitabi/share', () => ({
  resolveMapShareSnapshot: (...args: any[]) => resolveMapShareSnapshotMock(...args),
}))

const resolveMirrorPublicUrlMock = vi.fn()
vi.mock('@/lib/anitabi/imageProxy', () => ({
  resolveMirrorPublicUrl: (...args: any[]) => resolveMirrorPublicUrlMock(...args),
}))

const SNAPSHOT = {
  bangumiId: 101,
  bangumiTitle: '你的名字。',
  bangumiCity: '东京',
  bangumiColor: null,
  bangumiCover: 'https://lain.bgm.tv/pic/cover/l/cover.jpg',
  pointsLength: 30,
  pointId: '101:suga',
  pointName: '须贺神社',
  pointEp: '1',
  pointScene: null,
  pointGeo: null,
  pointImage: 'https://image.anitabi.cn/points/101/suga.jpg',
}

async function seed(code: string, imageKey: string | null) {
  await repo.create({
    code,
    pointId: '101:suga',
    bangumiId: 101,
    locale: 'zh',
    layout: 'portrait',
    userId: null,
    ipHash: 'h',
  })
  if (imageKey) await repo.markUploaded(code, { imageKey, userId: 'u1' })
}

describe('/s/[code] generateMetadata', () => {
  beforeEach(() => {
    resolveMapShareSnapshotMock.mockReset()
    resolveMirrorPublicUrlMock.mockReset()
    resolveMapShareSnapshotMock.mockResolvedValue(SNAPSHOT)
  })

  it('有 imageKey 时 OG 图是 /api/share/img/<code> 的绝对地址', async () => {
    await seed('AAAAAAAA', 'share/AAAAAAAA.jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'AAAAAAAA' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual(['https://seichigo.com/api/share/img/AAAAAAAA'])
    expect(meta.twitter?.images).toEqual(['https://seichigo.com/api/share/img/AAAAAAAA'])
    expect(meta.title).toBe('须贺神社｜《你的名字。》圣地巡礼 | SeichiGo')
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(resolveMirrorPublicUrlMock).not.toHaveBeenCalled()
  })

  it('没有 imageKey 时退回点位动画截图的 R2 公共域 URL', async () => {
    await seed('BBBBBBBB', null)
    resolveMirrorPublicUrlMock.mockResolvedValue('https://img.seichigo.com/mirror/v1/x/y/jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'BBBBBBBB' }),
      searchParams: Promise.resolve({}),
    })
    expect(resolveMirrorPublicUrlMock).toHaveBeenCalledWith(SNAPSHOT.pointImage, { kind: 'point' })
    expect(meta.openGraph?.images).toEqual(['https://img.seichigo.com/mirror/v1/x/y/jpg'])
  })

  it('R2 也算不出时退回站点默认 OG', async () => {
    await seed('CCCCCCCC', null)
    resolveMirrorPublicUrlMock.mockResolvedValue(null)
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'CCCCCCCC' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual(['https://seichigo.com/opengraph-image'])
  })

  it('短码不存在时只给 noindex 标题', async () => {
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'ZZZZZZZZ' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.robots).toEqual({ index: false, follow: false })
    expect(meta.openGraph).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/seo/share-link-metadata.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/app/s/[code]/page"`。

- [ ] **Step 3: 实现 `app/s/[code]/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveMapShareSnapshot } from '@/lib/anitabi/share'
import { resolveMirrorPublicUrl } from '@/lib/anitabi/imageProxy'
import { runShareBackground } from '@/lib/share/background'
import { getShareApiDeps } from '@/lib/share/api'
import { isShareCode } from '@/lib/share/shortCode'
import { buildShareDescription, buildShareRedirectTarget, buildShareTitle } from '@/lib/share/view'
import type { ShareLinkRecord } from '@/lib/share/repo'

// 短链每次都要读库拿 imageKey 与 clicks，不能被静态化
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PageParams = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

async function loadLink(code: string): Promise<ShareLinkRecord | null> {
  if (!isShareCode(code)) return null
  try {
    const deps = await getShareApiDeps()
    return await deps.repo.findByCode(code)
  } catch (error) {
    console.error('[share.link.load_failed]', { code, error })
    return null
  }
}

function readChannel(searchParams: Record<string, string | string[] | undefined>): string | null {
  const raw = searchParams.c
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}

export async function generateMetadata({ params, searchParams }: PageParams): Promise<Metadata> {
  await searchParams
  const { code } = await params
  const link = await loadLink(code)
  if (!link) {
    return { title: '链接不存在 | SeichiGo', robots: { index: false, follow: false } }
  }

  const { origin } = await getShareApiDeps()
  const snapshot = await resolveMapShareSnapshot(link.locale, {
    b: link.bangumiId,
    p: link.pointId,
  })

  const image = link.imageKey
    ? `${origin}/api/share/img/${link.code}`
    : (snapshot?.pointImage
        ? await resolveMirrorPublicUrl(snapshot.pointImage, { kind: 'point' })
        : null) || `${origin}/opengraph-image`

  const title = buildShareTitle({
    locale: link.locale,
    pointName: snapshot?.pointName || '',
    bangumiTitle: snapshot?.bangumiTitle || 'SeichiGo',
  })
  const description = buildShareDescription({
    locale: link.locale,
    bangumiTitle: snapshot?.bangumiTitle || 'SeichiGo',
    city: snapshot?.bangumiCity ?? null,
    ep: snapshot?.pointEp ?? null,
  })

  return {
    title,
    description,
    // 短链只是分享入口，索引价值全在 /map 与作品页上
    robots: { index: false, follow: true },
    openGraph: { type: 'website', title, description, url: `${origin}/s/${link.code}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

export default async function ShareRedirectPage({ params, searchParams }: PageParams) {
  const { code } = await params
  const resolvedSearchParams = await searchParams
  const link = await loadLink(code)
  if (!link) notFound()

  const deps = await getShareApiDeps()
  // 点击计数不阻塞响应；waitUntil 必须以 ctx 为 this 调用（见 lib/share/background.ts）
  runShareBackground(deps.repo.incrementClicks(link.code))

  const target = buildShareRedirectTarget({
    locale: link.locale,
    bangumiId: link.bangumiId,
    pointId: link.pointId,
    channel: readChannel(resolvedSearchParams),
  })
  const absolute = `${deps.origin}${target}`

  return (
    <>
      {/* 爬虫读完 OG 再跳；不能用 next/navigation 的 redirect */}
      <meta httpEquiv="refresh" content={`0;url=${absolute}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace(${JSON.stringify(absolute)});`,
        }}
      />
      <main style={{ padding: '48px 24px', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <p style={{ color: '#4b5563', fontSize: 14 }}>正在跳转到 SeichiGo 地图…</p>
        <a href={absolute} style={{ color: '#db2777', fontSize: 14 }}>
          {absolute}
        </a>
      </main>
    </>
  )
}
```

> `snapshot.pointImage` 由 Task A14 加到 `MapShareSnapshot` 上。**A14 必须与 A13 同一批落地**，或者先做 A14 再做 A13；本计划按 A13 → A14 顺序写测试但实现上 A14 的类型改动先合并也可以。执行者若先做 A13，`npx tsc` 会在 `snapshot.pointImage` 上报错，这是预期的，做完 A14 即消失。

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/seo/share-link-metadata.test.ts
```

预期：`Tests  4 passed`。

- [ ] **Step 5: commit**

```bash
git add "app/s/[code]/page.tsx" tests/seo/share-link-metadata.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 短链页 /s/[code]，先出 OG 再用 refresh + script 跳地图

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A14: 地图页 OG 改走 R2 公共域，删除紧急降级路由

**Files:**
- Modify: `lib/anitabi/share.ts`（第 14-25 行的 `MapShareSnapshot`、第 91-97 行的 `buildMapShareImageUrl`、第 111-123 行的 snapshot 组装）
- Modify: `app/(site)/map/page.tsx` 第 17 行
- Modify: `app/ja/map/page.tsx` 第 17 行
- Modify: `app/en/map/page.tsx` 第 17 行
- Delete: `app/api/anitabi/share-image/route.tsx`
- Modify: `package.json`（移除 `@vercel/og`）
- Test: `tests/anitabi/share.test.ts`（改第 29-32 行那条用例）

- [ ] **Step 1: 改 `tests/anitabi/share.test.ts` 第 29-32 行为失败的新用例**

把整个 `it('builds map share image url', ...)` 块替换成下面这段，并在文件顶部（第 2 行之后）加两个 mock：

```ts
const getBangumiDetailMock = vi.fn()
vi.mock('@/lib/anitabi/read', () => ({
  getBangumiDetail: (...args: any[]) => getBangumiDetailMock(...args),
}))
vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: async () => ({ prisma: {} }),
}))
const resolveMirrorPublicUrlMock = vi.fn()
vi.mock('@/lib/anitabi/imageProxy', () => ({
  resolveMirrorPublicUrl: (...args: any[]) => resolveMirrorPublicUrlMock(...args),
}))
```

第 1 行的 import 改成 `import { describe, expect, it, vi, beforeEach } from 'vitest'`，并新增：

```ts
function detail(pointImage: string | null, cover: string | null) {
  return {
    card: { id: 101, title: '你的名字。', city: '东京', color: null, cover },
    points: [
      {
        id: '101:suga',
        bangumiId: 101,
        name: '须贺神社',
        nameZh: '须贺神社',
        note: null,
        geo: [35.6, 139.7] as [number, number],
        ep: '1',
        s: null,
        image: pointImage,
        origin: null,
        originUrl: null,
        originLink: null,
        density: null,
        mark: null,
      },
    ],
  }
}

describe('buildMapShareImageUrl 三级回退', () => {
  beforeEach(() => {
    getBangumiDetailMock.mockReset()
    resolveMirrorPublicUrlMock.mockReset()
  })

  it('有点位截图时返回点位图的 R2 公共域 URL', async () => {
    getBangumiDetailMock.mockResolvedValue(detail('https://image.anitabi.cn/points/101/suga.jpg', 'https://lain.bgm.tv/c.jpg'))
    resolveMirrorPublicUrlMock.mockResolvedValue('https://img.seichigo.com/mirror/v1/a/b/jpg')
    await expect(buildMapShareImageUrl('zh', { b: 101, p: '101:suga' })).resolves.toBe(
      'https://img.seichigo.com/mirror/v1/a/b/jpg',
    )
    expect(resolveMirrorPublicUrlMock).toHaveBeenCalledWith(
      'https://image.anitabi.cn/points/101/suga.jpg',
      { kind: 'point' },
    )
  })

  it('p 缺失时退回作品封面的 R2 公共域 URL', async () => {
    getBangumiDetailMock.mockResolvedValue(detail('https://image.anitabi.cn/points/101/suga.jpg', 'https://lain.bgm.tv/c.jpg'))
    resolveMirrorPublicUrlMock.mockResolvedValue('https://img.seichigo.com/mirror/v1/c/d/jpg')
    await expect(buildMapShareImageUrl('zh', { b: 101, p: null })).resolves.toBe(
      'https://img.seichigo.com/mirror/v1/c/d/jpg',
    )
    expect(resolveMirrorPublicUrlMock).toHaveBeenCalledWith('https://lain.bgm.tv/c.jpg', { kind: 'cover' })
  })

  it('都算不出时退回站点默认 OG', async () => {
    getBangumiDetailMock.mockResolvedValue(detail(null, null))
    await expect(buildMapShareImageUrl('en', { b: 101, p: null })).resolves.toMatch(/\/opengraph-image$/)
  })

  it('没有 b 参数时不查库，直接站点默认 OG', async () => {
    await expect(buildMapShareImageUrl('en', { b: null, p: null })).resolves.toMatch(/\/opengraph-image$/)
    expect(getBangumiDetailMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/anitabi/share.test.ts
```

预期输出包含：`TypeError: buildMapShareImageUrl(...).resolves is not a function` 或 `AssertionError: expected '/api/anitabi/share-image?locale=zh&b=101&p=101%3Asuga' to be ...`，`Test Files  1 failed`。

- [ ] **Step 3a: 改 `lib/anitabi/share.ts`**

第 1-5 行的 import 段补两行：

```ts
import { getSiteOrigin } from '@/lib/seo/site'
import { resolveMirrorPublicUrl } from '@/lib/anitabi/imageProxy'
```

第 14-25 行的 `MapShareSnapshot` 加两个字段：

```ts
export type MapShareSnapshot = {
  bangumiId: number
  bangumiTitle: string
  bangumiCity: string | null
  bangumiColor: string | null
  /** 作品封面原始 URL（未归一），给 OG 回退用 */
  bangumiCover: string | null
  pointsLength: number
  pointId: string | null
  pointName: string | null
  pointEp: string | null
  pointScene: string | null
  pointGeo: [number, number] | null
  /** 点位动画截图原始 URL（未归一），给 OG 首选用 */
  pointImage: string | null
}
```

第 91-97 行的 `buildMapShareImageUrl` 整段替换：

```ts
/**
 * 地图页 / 短链页的 OG 图：点位动画截图 → 作品封面 → 站点默认 OG。
 * 前两级都走 R2 公共域直出（resolveMirrorPublicUrl，key 与镜像入库零漂移）；
 * 开关未配（NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE 为空）时它返回 null，自然落到默认 OG。
 */
export async function buildMapShareImageUrl(
  locale: SupportedLocale,
  query: MapShareQuery,
): Promise<string> {
  const fallback = `${getSiteOrigin()}/opengraph-image`
  if (query.b == null) return fallback

  const snapshot = await resolveMapShareSnapshot(locale, query)
  if (!snapshot) return fallback

  if (snapshot.pointImage) {
    const url = await resolveMirrorPublicUrl(snapshot.pointImage, { kind: 'point' })
    if (url) return url
  }
  if (snapshot.bangumiCover) {
    const url = await resolveMirrorPublicUrl(snapshot.bangumiCover, { kind: 'cover' })
    if (url) return url
  }
  return fallback
}
```

第 112-123 行的 snapshot 组装补两行（`bangumiCover` 与 `pointImage`）：

```ts
    const point = pickPoint(detail.points, query.p)
    return {
      bangumiId: detail.card.id,
      bangumiTitle: detail.card.title,
      bangumiCity: detail.card.city || null,
      bangumiColor: detail.card.color || null,
      bangumiCover: detail.card.cover || null,
      pointsLength: detail.points.length,
      pointId: point?.id || null,
      pointName: point?.name || null,
      pointEp: point?.ep || null,
      pointScene: point?.s || null,
      pointGeo: toPointGeo(point),
      pointImage: point?.image || null,
    }
```

- [ ] **Step 3b: 三个 map page 加 `await`**

`app/(site)/map/page.tsx` 第 17 行、`app/ja/map/page.tsx` 第 17 行、`app/en/map/page.tsx` 第 17 行，把

```ts
  const shareImage = buildMapShareImageUrl('zh', shareQuery)
```

分别改成（locale 各自对应 `'zh'` / `'ja'` / `'en'`）：

```ts
  const shareImage = await buildMapShareImageUrl('zh', shareQuery)
```

三个 `generateMetadata` 本来就是 `async`，无需其他改动。

- [ ] **Step 3c: 删除紧急降级路由与依赖**

```bash
git rm app/api/anitabi/share-image/route.tsx
npm uninstall @vercel/og
```

`npm uninstall` 会同时改 `package.json`（删掉第 61 行的 `"@vercel/og": "^0.6.2",`）与 `package-lock.json`。

确认全仓已无引用：

```bash
grep -rn "@vercel/og\|anitabi/share-image" app lib components features tests scripts package.json
```

预期：无输出。

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/anitabi/share.test.ts && npx tsc -p tsconfig.app.json --noEmit && npm test
```

预期：`tests/anitabi/share.test.ts` 里 `Tests  8 passed`；`tsc` 无输出；`npm test` 全绿。

- [ ] **Step 5: commit**

```bash
git add lib/anitabi/share.ts "app/(site)/map/page.tsx" app/ja/map/page.tsx app/en/map/page.tsx tests/anitabi/share.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
fix(map): OG 图改走点位截图/封面的 R2 公共域，删掉 share-image 降级路由与 @vercel/og

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task A15: ja/en 六个页面补 `openGraph.images` / `twitter.images`

**Files:**
- Modify: `app/ja/posts/[slug]/page.tsx`（`generateMetadata` 的 return，第 137-145 行）
- Modify: `app/en/posts/[slug]/page.tsx`（第 134-144 行）
- Modify: `app/ja/anime/[id]/page.tsx`（第 103-113 行）
- Modify: `app/en/anime/[id]/page.tsx`（第 90-102 行）
- Modify: `app/ja/city/[id]/page.tsx`（第 93-105 行）
- Modify: `app/en/city/[id]/page.tsx`（第 96-108 行）
- Test: `tests/seo/localized-og-images.test.ts`

zh 侧真实存在的 OG 路由只有四条（`find app -name "opengraph-image*" -o -name "twitter-image*"` 的结果）：
`app/(site)/posts/[slug]/opengraph-image.tsx`、`app/(site)/posts/[slug]/twitter-image.tsx`、`app/(site)/anime/[id]/opengraph-image.tsx`、`app/(site)/city/[id]/opengraph-image.tsx`，加上全站兜底 `app/opengraph-image.tsx` / `app/twitter-image.tsx`。所以映射按目录逐个对应，不能一律写 `/opengraph-image`。

- [ ] **Step 1: 写失败测试 `tests/seo/localized-og-images.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: async () => ({
    source: 'mdx',
    isFallback: false,
    post: {
      frontmatter: {
        title: '标题',
        seoTitle: 'SEO 标题',
        description: '摘要',
        slug: 'btr-shimo',
        animeId: 'btr',
        city: '东京',
      },
      content: 'hi',
    },
  }),
}))
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: async () => null,
}))
vi.mock('@/lib/publicOverride/service', () => ({
  resolvePublicOverrideForPost: async () => null,
}))

describe('ja/en 文章页 OG 图指向 zh 的专属路由', () => {
  it('ja', async () => {
    const { generateMetadata } = await import('@/app/ja/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })
    expect(meta.openGraph?.images).toEqual(['/posts/btr-shimo/opengraph-image'])
    expect(meta.twitter?.images).toEqual(['/posts/btr-shimo/twitter-image'])
  })

  it('en', async () => {
    const { generateMetadata } = await import('@/app/en/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })
    expect(meta.openGraph?.images).toEqual(['/posts/btr-shimo/opengraph-image'])
    expect(meta.twitter?.images).toEqual(['/posts/btr-shimo/twitter-image'])
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/seo/localized-og-images.test.ts
```

预期输出包含：`AssertionError: expected undefined to deeply equal [ '/posts/btr-shimo/opengraph-image' ]`。

- [ ] **Step 3a: 文章页（ja / en 各一处）**

`app/ja/posts/[slug]/page.tsx` 的 `openGraph` / `twitter` 块补 images（`encodeSlugForPath` 已在同文件第 60-62 行定义）：

```tsx
    openGraph: {
      type: 'article',
      title: seoTitle.absolute,
      description,
      url: `/ja/posts/${encodeSlugForPath(frontmatter.slug)}`,
      images: [`/posts/${encodeSlugForPath(frontmatter.slug)}/opengraph-image`],
    },
    twitter: {
      card: 'summary_large_image',
      title: seoTitle.absolute,
      description,
      images: [`/posts/${encodeSlugForPath(frontmatter.slug)}/twitter-image`],
    },
```

`app/en/posts/[slug]/page.tsx` 同样两块，只把 `url` 里的 `/ja/` 保持为原文的 `/en/`。

- [ ] **Step 3b: 作品页**

`app/ja/anime/[id]/page.tsx` 第 103-113 行（`path` 已在同函数内算好，形如 `/anime/<id>`）：

```tsx
    openGraph: {
      type: 'website',
      title: seoTitle.absolute,
      description,
      url: `/ja${path}`,
      images: [`${path}/opengraph-image`],
    },
    twitter: {
      card: 'summary_large_image',
      title: seoTitle.absolute,
      description,
      images: [`${path}/opengraph-image`],
    },
```

`app/en/anime/[id]/page.tsx` 第 90-102 行：把 `images: ['/opengraph-image']` 换成 `images: [`${path}/opengraph-image`]`，把 `images: ['/twitter-image']` 换成 `images: [`${path}/opengraph-image`]`（anime 目录下没有 twitter-image 路由，统一用 opengraph-image）。

- [ ] **Step 3c: 城市页**

`app/ja/city/[id]/page.tsx` 第 93-105 行与 `app/en/city/[id]/page.tsx` 第 96-108 行，两处 `images` 都换成：

```tsx
      images: [`/city/${encodeURIComponent(city.slug)}/opengraph-image`],
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/seo/localized-og-images.test.ts && npx tsc -p tsconfig.app.json --noEmit && npm test
```

预期：`Tests  2 passed`；`tsc` 无输出；`npm test` 全绿。

- [ ] **Step 5: commit**

```bash
git add "app/ja/posts/[slug]/page.tsx" "app/en/posts/[slug]/page.tsx" "app/ja/anime/[id]/page.tsx" "app/en/anime/[id]/page.tsx" "app/ja/city/[id]/page.tsx" "app/en/city/[id]/page.tsx" tests/seo/localized-og-images.test.ts
git commit -m "$(cat <<'EOF'
fix(seo): ja/en 的文章/作品/城市页补上对应 zh 目录的 OG 图路由

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

# Track B — 前端

> 开工前提：Task A1 的 `lib/share/types.ts` 已在当前分支上（`git merge main` 后 `ls lib/share/types.ts` 有输出）。Track B 只 import 它，不改它。

## Task B1: 新增 `share.*` i18n 命名空间（三语）

**Files:**
- Modify: `lib/i18n/locales/zh.json`（顶层新增 `share`，放在 `billing` 之后）
- Modify: `lib/i18n/locales/en.json`（同位置）
- Modify: `lib/i18n/locales/ja.json`（同位置）
- Test: `tests/i18n/shareKeys.test.ts`

- [ ] **Step 1: 写失败测试 `tests/i18n/shareKeys.test.ts`**（照 `tests/i18n/billingKeys.test.ts:1-46` 的写法，复用 `homeKeys.test` 导出的 `flatten`）

```ts
import { describe, expect, it } from 'vitest'
import en from '@/lib/i18n/locales/en.json'
import ja from '@/lib/i18n/locales/ja.json'
import zh from '@/lib/i18n/locales/zh.json'
import { flatten } from './homeKeys.test'

type Dict = Record<string, unknown>

function at(dict: Dict, prefix: string): unknown {
  let current: unknown = dict
  for (const key of prefix.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Dict)[key]
  }
  return current
}

const LOCALES = [
  ['zh', zh as Dict],
  ['en', en as Dict],
  ['ja', ja as Dict],
] as const

/**
 * 点位分享面板文案：`share.*`。t() 缺 key 会把 key 名原样渲染到按钮上，
 * 所以三语必须逐叶子对齐。
 */
describe('share i18n keys', () => {
  const keysOf = (dict: Dict) => Object.keys(flatten(at(dict, 'share'))).sort()
  const zhKeys = keysOf(zh as Dict)

  it('中文里确实有这一段', () => {
    expect(zhKeys.length).toBeGreaterThan(15)
  })

  it.each(LOCALES)('%s 的键集合与 zh 一致', (_locale, dict) => {
    expect(keysOf(dict)).toEqual(zhKeys)
  })

  it.each(LOCALES)('%s 没有空值', (_locale, dict) => {
    for (const [key, value] of Object.entries(flatten(at(dict, 'share')))) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it.each(LOCALES)('%s 的文案模板四个占位符齐全', (_locale, dict) => {
    const template = at(dict, 'share.captionTemplate') as string
    for (const token of ['{anime}', '{point}', '{city}', '{url}']) {
      expect(template.includes(token), `${token} in ${template}`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/i18n/shareKeys.test.ts
```

预期输出包含：`AssertionError: expected 0 to be greater than 15`。

- [ ] **Step 3a: `lib/i18n/locales/zh.json` 顶层新增**

```json
  "share": {
    "panelTitle": "分享这个点位",
    "close": "关闭",
    "generating": "正在生成卡片…",
    "generateFailed": "卡片生成失败，请重试",
    "layoutLabel": "版式",
    "layoutPortrait": "竖版",
    "layoutLandscape": "横版",
    "addPhoto": "添加实拍",
    "removePhoto": "移除实拍",
    "photoHint": "加上你自己拍的照片，卡片会变成左右对比",
    "captionLabel": "分享文案",
    "captionTemplate": "《{anime}》圣地巡礼｜{point}（{city}）{url} #圣地巡礼 #{anime}",
    "systemShare": "系统分享",
    "copyImage": "复制图片",
    "copyText": "复制文案",
    "saveImage": "保存图片",
    "platformX": "X",
    "platformReddit": "Reddit",
    "platformLine": "LINE",
    "platformXiaohongshu": "小红书",
    "platformWechat": "微信",
    "toastCopied": "文案已复制",
    "toastImageCopied": "图片已复制",
    "toastSaved": "图片已保存",
    "toastPasteInApp": "图片和文案已就绪，打开 App 粘贴即可",
    "toastShareFilesUnsupported": "当前浏览器不能直接分享图片，请先保存图片再手动发布",
    "toastFailed": "操作失败，请重试"
  }
```

- [ ] **Step 3b: `lib/i18n/locales/en.json` 顶层新增**

```json
  "share": {
    "panelTitle": "Share this spot",
    "close": "Close",
    "generating": "Rendering your card…",
    "generateFailed": "Could not render the card. Please try again.",
    "layoutLabel": "Format",
    "layoutPortrait": "Portrait",
    "layoutLandscape": "Landscape",
    "addPhoto": "Add your photo",
    "removePhoto": "Remove photo",
    "photoHint": "Add your own shot and the card becomes a side-by-side comparison",
    "captionLabel": "Caption",
    "captionTemplate": "{anime} anime pilgrimage: {point}, {city} {url} #animepilgrimage #{anime}",
    "systemShare": "Share",
    "copyImage": "Copy image",
    "copyText": "Copy caption",
    "saveImage": "Save image",
    "platformX": "X",
    "platformReddit": "Reddit",
    "platformLine": "LINE",
    "platformXiaohongshu": "RED",
    "platformWechat": "WeChat",
    "toastCopied": "Caption copied",
    "toastImageCopied": "Image copied",
    "toastSaved": "Image saved",
    "toastPasteInApp": "Image and caption are ready — open the app and paste",
    "toastShareFilesUnsupported": "This browser cannot share images directly. Save the image first, then post it manually.",
    "toastFailed": "Something went wrong. Please try again."
  }
```

- [ ] **Step 3c: `lib/i18n/locales/ja.json` 顶层新增**

```json
  "share": {
    "panelTitle": "このスポットを共有",
    "close": "閉じる",
    "generating": "カードを生成中…",
    "generateFailed": "カードの生成に失敗しました。もう一度お試しください。",
    "layoutLabel": "レイアウト",
    "layoutPortrait": "縦",
    "layoutLandscape": "横",
    "addPhoto": "実写を追加",
    "removePhoto": "実写を削除",
    "photoHint": "自分で撮った写真を足すと、左右の比較カードになります",
    "captionLabel": "共有テキスト",
    "captionTemplate": "『{anime}』聖地巡礼｜{point}（{city}）{url} #聖地巡礼 #{anime}",
    "systemShare": "共有",
    "copyImage": "画像をコピー",
    "copyText": "テキストをコピー",
    "saveImage": "画像を保存",
    "platformX": "X",
    "platformReddit": "Reddit",
    "platformLine": "LINE",
    "platformXiaohongshu": "RED",
    "platformWechat": "WeChat",
    "toastCopied": "テキストをコピーしました",
    "toastImageCopied": "画像をコピーしました",
    "toastSaved": "画像を保存しました",
    "toastPasteInApp": "画像とテキストの準備ができました。アプリを開いて貼り付けてください",
    "toastShareFilesUnsupported": "このブラウザーでは画像を直接共有できません。先に画像を保存してから投稿してください。",
    "toastFailed": "操作に失敗しました。もう一度お試しください。"
  }
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/i18n/shareKeys.test.ts
```

预期：`Tests  10 passed`。

- [ ] **Step 5: commit**

```bash
git add lib/i18n/locales/zh.json lib/i18n/locales/en.json lib/i18n/locales/ja.json tests/i18n/shareKeys.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 新增三语 share.* 文案命名空间

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B2: 文案模板与平台 URL `components/share/shareText.ts`

**Files:**
- Create: `components/share/shareText.ts`
- Test: `tests/components/shareText.test.ts`

- [ ] **Step 1: 写失败测试 `tests/components/shareText.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  withShareChannel,
} from '@/components/share/shareText'

describe('buildShareCaption', () => {
  it('填充四个占位符', () => {
    expect(
      buildShareCaption('《{anime}》圣地巡礼｜{point}（{city}）{url} #圣地巡礼 #{anime}', {
        anime: '你的名字。',
        point: '须贺神社',
        city: '东京',
        url: 'https://seichigo.com/s/AbC12xYz?c=xhs',
      }),
    ).toBe('《你的名字。》圣地巡礼｜须贺神社（东京）https://seichigo.com/s/AbC12xYz?c=xhs #圣地巡礼 #你的名字。')
  })

  it('城市缺失时不留空括号/空逗号', () => {
    expect(
      buildShareCaption('《{anime}》圣地巡礼｜{point}（{city}）{url}', {
        anime: 'A',
        point: 'B',
        city: '',
        url: 'U',
      }),
    ).toBe('《A》圣地巡礼｜B U')
    expect(
      buildShareCaption('{anime} anime pilgrimage: {point}, {city} {url}', {
        anime: 'A',
        point: 'B',
        city: '',
        url: 'U',
      }),
    ).toBe('A anime pilgrimage: B U')
  })
})

describe('withShareChannel', () => {
  it('在没有 query 的短链上追加 ?c=', () => {
    expect(withShareChannel('https://seichigo.com/s/AbC12xYz', 'x')).toBe(
      'https://seichigo.com/s/AbC12xYz?c=x',
    )
  })

  it('已有 c 参数时覆盖而不是追加第二个', () => {
    expect(withShareChannel('https://seichigo.com/s/AbC12xYz?c=save', 'wx')).toBe(
      'https://seichigo.com/s/AbC12xYz?c=wx',
    )
  })
})

describe('平台 URL', () => {
  const text = '《你的名字。》圣地巡礼 https://seichigo.com/s/AbC12xYz?c=x'
  const url = 'https://seichigo.com/s/AbC12xYz?c=rd'

  it('X', () => {
    expect(buildXIntentUrl(text)).toBe(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    )
  })

  it('Reddit', () => {
    expect(buildRedditSubmitUrl(url, '须贺神社｜《你的名字。》')).toBe(
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent('须贺神社｜《你的名字。》')}`,
    )
  })

  it('LINE', () => {
    expect(buildLineShareUrl(url, text)).toBe(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    )
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/components/shareText.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/components/share/shareText"`。

- [ ] **Step 3: 实现 `components/share/shareText.ts`**

```ts
import type { ShareChannel } from '@/lib/share/types'

export type ShareCaptionVars = {
  anime: string
  point: string
  city: string
  url: string
}

/**
 * 填模板。城市为空时，把包住 {city} 的中/英标点（全角括号、逗号+空格）一并吃掉，
 * 免得出现「须贺神社（）」或「Suga Shrine,  https://…」。
 */
export function buildShareCaption(template: string, vars: ShareCaptionVars): string {
  const city = String(vars.city || '').trim()
  let out = String(template || '')
  out = city
    ? out.replace(/\{city\}/g, city)
    : out.replace(/（\{city\}）/g, '').replace(/,\s*\{city\}/g, '').replace(/\{city\}/g, '')
  out = out
    .replace(/\{anime\}/g, String(vars.anime || '').trim())
    .replace(/\{point\}/g, String(vars.point || '').trim())
    .replace(/\{url\}/g, String(vars.url || '').trim())
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/** 给短链挂上渠道参数；已有 c 就覆盖 */
export function withShareChannel(shareUrl: string, channel: ShareChannel): string {
  try {
    const url = new URL(shareUrl)
    url.searchParams.set('c', channel)
    return url.toString()
  } catch {
    return shareUrl
  }
}

export function buildXIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
}

export function buildRedditSubmitUrl(url: string, title: string): string {
  return `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`
}

export function buildLineShareUrl(url: string, text: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/components/shareText.test.ts
```

预期：`Tests  7 passed`。

- [ ] **Step 5: commit**

```bash
git add components/share/shareText.ts tests/components/shareText.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 分享文案模板填充与 X/Reddit/LINE 的 URL 构造

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B3: 卡片版面纯函数 `components/share/pointShareCardDraw.ts`

**Files:**
- Create: `components/share/pointShareCardDraw.ts`
- Test: `tests/components/pointShareCardDraw.test.ts`

- [ ] **Step 1: 写失败测试 `tests/components/pointShareCardDraw.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildCardLayout,
  computeCoverRect,
  resolveCardVariant,
  wrapLines,
} from '@/components/share/pointShareCardDraw'

describe('computeCoverRect', () => {
  it('图更宽时左右裁切', () => {
    expect(computeCoverRect(2000, 1000, 1000, 1000)).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000 })
  })

  it('图更高时上下裁切', () => {
    expect(computeCoverRect(1000, 2000, 1000, 1000)).toEqual({ sx: 0, sy: 500, sw: 1000, sh: 1000 })
  })

  it('比例一致时不裁', () => {
    expect(computeCoverRect(800, 600, 400, 300)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600 })
  })
})

describe('wrapLines', () => {
  // 每个字符宽 10 的假测量器
  const measure = (text: string) => text.length * 10

  it('按宽度断行', () => {
    expect(wrapLines(measure, '一二三四五六', 30, 5)).toEqual(['一二三', '四五六'])
  })

  it('超出行数时最后一行加省略号', () => {
    expect(wrapLines(measure, '一二三四五六七八九', 30, 2)).toEqual(['一二三', '四五…'])
  })

  it('空串返回空数组', () => {
    expect(wrapLines(measure, '   ', 100, 2)).toEqual([])
  })
})

describe('resolveCardVariant', () => {
  it('有实拍才是 compare', () => {
    expect(resolveCardVariant(true)).toBe('compare')
    expect(resolveCardVariant(false)).toBe('default')
  })
})

describe('buildCardLayout', () => {
  it('竖版 default：主视觉占上半，文字块在下', () => {
    const layout = buildCardLayout('portrait', 'default')
    expect(layout.canvas).toEqual({ width: 1080, height: 1440 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 1000 })
    expect(layout.photo).toBeNull()
    expect(layout.textTop).toBe(1060)
    expect(layout.qr).toEqual({ x: 840, y: 1140, size: 180 })
  })

  it('竖版 compare：上下两张图各占一半', () => {
    const layout = buildCardLayout('portrait', 'compare')
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 500 })
    expect(layout.photo).toEqual({ x: 0, y: 500, width: 1080, height: 500 })
  })

  it('横版 compare：左右两张图各占一半', () => {
    const layout = buildCardLayout('landscape', 'compare')
    expect(layout.canvas).toEqual({ width: 1200, height: 630 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 600, height: 430 })
    expect(layout.photo).toEqual({ x: 600, y: 0, width: 600, height: 430 })
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project node tests/components/pointShareCardDraw.test.ts
```

预期输出包含：`Error: Failed to resolve import "@/components/share/pointShareCardDraw"`。

- [ ] **Step 3: 实现 `components/share/pointShareCardDraw.ts`**

```ts
import { SHARE_CARD_SIZES, type ShareCardLayout, type ShareCardVariant } from '@/lib/share/types'

export type Rect = { x: number; y: number; width: number; height: number }
export type CoverRect = { sx: number; sy: number; sw: number; sh: number }

export type CardLayout = {
  canvas: { width: number; height: number }
  /** 动画截图槽位 */
  main: Rect
  /** 实拍槽位；default 布局下为 null */
  photo: Rect | null
  /** 文字块起始 y */
  textTop: number
  /** 左右安全边距 */
  padding: number
  /** 文字可用宽度（已扣掉二维码与边距） */
  textWidth: number
  qr: { x: number; y: number; size: number }
  /** 页脚基线 y（鸟居图标 + seichigo.com） */
  footerY: number
}

/** object-fit: cover 的源矩形，与 CheckInCard.tsx:71-87 的 drawImageCover 同算法 */
export function computeCoverRect(
  imgWidth: number,
  imgHeight: number,
  boxWidth: number,
  boxHeight: number,
): CoverRect {
  const imgRatio = imgWidth / imgHeight
  const targetRatio = boxWidth / boxHeight
  if (imgRatio > targetRatio) {
    const sw = imgHeight * targetRatio
    return { sx: (imgWidth - sw) / 2, sy: 0, sw, sh: imgHeight }
  }
  const sh = imgWidth / targetRatio
  return { sx: 0, sy: (imgHeight - sh) / 2, sw: imgWidth, sh }
}

/**
 * 逐字断行（CJK 没有空格，不能按词切）。超出 maxLines 时最后一行以 … 收尾。
 * measure 由调用方传 ctx.measureText(...).width，方便在 node 里测。
 */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const source = String(text || '').trim()
  if (!source) return []

  const lines: string[] = []
  let current = ''
  for (const char of source) {
    const next = current + char
    if (current && measure(next) > maxWidth) {
      lines.push(current)
      current = char
      if (lines.length === maxLines) break
    } else {
      current = next
    }
  }
  if (lines.length < maxLines && current) lines.push(current)

  if (lines.length === maxLines) {
    const consumed = lines.join('').length
    if (consumed < source.length) {
      let last = lines[maxLines - 1]!
      while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1)
      lines[maxLines - 1] = `${last}…`
    }
  }
  return lines
}

export function resolveCardVariant(hasPhoto: boolean): ShareCardVariant {
  return hasPhoto ? 'compare' : 'default'
}

export function buildCardLayout(layout: ShareCardLayout, variant: ShareCardVariant): CardLayout {
  const canvas = SHARE_CARD_SIZES[layout]

  if (layout === 'portrait') {
    const padding = 64
    const visualHeight = 1000
    const qrSize = 180
    return {
      canvas,
      main:
        variant === 'compare'
          ? { x: 0, y: 0, width: canvas.width, height: visualHeight / 2 }
          : { x: 0, y: 0, width: canvas.width, height: visualHeight },
      photo:
        variant === 'compare'
          ? { x: 0, y: visualHeight / 2, width: canvas.width, height: visualHeight / 2 }
          : null,
      textTop: visualHeight + padding - 4,
      padding,
      textWidth: canvas.width - padding * 2 - qrSize - 32,
      qr: { x: canvas.width - padding - qrSize + 4, y: canvas.height - padding - qrSize - 56, size: qrSize },
      footerY: canvas.height - padding,
    }
  }

  const padding = 48
  const visualHeight = 430
  const qrSize = 120
  return {
    canvas,
    main:
      variant === 'compare'
        ? { x: 0, y: 0, width: canvas.width / 2, height: visualHeight }
        : { x: 0, y: 0, width: canvas.width, height: visualHeight },
    photo:
      variant === 'compare'
        ? { x: canvas.width / 2, y: 0, width: canvas.width / 2, height: visualHeight }
        : null,
    textTop: visualHeight + padding - 12,
    padding,
    textWidth: canvas.width - padding * 2 - qrSize - 32,
    qr: { x: canvas.width - padding - qrSize, y: visualHeight + 26, size: qrSize },
    footerY: canvas.height - padding + 12,
  }
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project node tests/components/pointShareCardDraw.test.ts
```

预期：`Tests  10 passed`。

- [ ] **Step 5: commit**

```bash
git add components/share/pointShareCardDraw.ts tests/components/pointShareCardDraw.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 分享卡片版面纯函数（cover 裁剪、逐字断行、两版式两布局槽位）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B4: canvas 渲染器 `components/share/PointShareCard.tsx`

**Files:**
- Create: `components/share/PointShareCard.tsx`
- Test: `tests/components/pointShareCard.test.tsx`

图片一律经 `toCanvasSafeImageUrl`（`lib/anitabi/imageProxy.ts:157`）取，避免 canvas 污染；加载图与 logo 的写法沿用 `components/share/CheckInCard.tsx:51-63`；二维码用 `QRCode.toDataURL`，与 `components/share/RouteBookCard.tsx:79-83` 同参数。

- [ ] **Step 1: 写失败测试 `tests/components/pointShareCard.test.tsx`**

jsdom 没有 canvas 2D 上下文，测试里桩掉 `HTMLCanvasElement.prototype.getContext` 与 `toBlob`，只验证「拿到了正确尺寸、调用了 onRendered、超 1.5 MB 会降质重试一次」。

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import PointShareCard from '@/components/share/PointShareCard'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,qr') },
}))

vi.mock('@/lib/anitabi/imageProxy', () => ({
  toCanvasSafeImageUrl: (src: string) => src,
}))

const blobSizes: number[] = []

function stubCanvas() {
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 10 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop as string]
        return () => undefined
      },
      set() {
        return true
      },
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    _type?: string,
    quality?: number,
  ) {
    const size = blobSizes.shift() ?? 100
    const blob = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    Object.defineProperty(blob, 'size', { value: size })
    Object.defineProperty(blob, 'quality', { value: quality })
    callback(blob)
  })
}

beforeEach(() => {
  blobSizes.length = 0
  stubCanvas()
  // 让 new Image() 的 onload 立刻触发
  Object.defineProperty(globalThis.Image.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement) {
      Object.defineProperty(this, 'width', { value: 1600, configurable: true })
      Object.defineProperty(this, 'height', { value: 900, configurable: true })
      setTimeout(() => this.onload?.(new Event('load')), 0)
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const INPUT = {
  layout: 'portrait' as const,
  locale: 'zh' as const,
  pointName: '须贺神社',
  animeTitle: '你的名字。',
  cityName: '东京',
  episode: '1',
  scene: null,
  animeImage: 'https://image.anitabi.cn/points/101/suga.jpg',
  photoObjectUrl: null,
  shareUrl: 'https://seichigo.com/s/AbC12xYz',
}

describe('PointShareCard', () => {
  it('按版式设置画布尺寸并回调 Blob', async () => {
    const onRendered = vi.fn()
    const { container } = render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBe(1440)
  })

  it('横版走 1200x630', async () => {
    const onRendered = vi.fn()
    const { container } = render(
      <PointShareCard input={{ ...INPUT, layout: 'landscape' }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(630)
  })

  it('首次超过 1.5 MB 时降质量重试一次', async () => {
    blobSizes.push(2_000_000, 900_000)
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2)
    expect(onRendered.mock.calls[0]![0].size).toBe(900_000)
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project jsdom tests/components/pointShareCard.test.tsx
```

预期输出包含：`Error: Failed to resolve import "@/components/share/PointShareCard"`。

- [ ] **Step 3: 实现 `components/share/PointShareCard.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CARD_MAX_BYTES, type ShareCardLayout } from '@/lib/share/types'
import {
  buildCardLayout,
  computeCoverRect,
  resolveCardVariant,
  wrapLines,
} from '@/components/share/pointShareCardDraw'

export type PointShareCardInput = {
  layout: ShareCardLayout
  locale: SupportedLocale
  pointName: string
  animeTitle: string
  cityName: string
  episode: string | null
  scene: string | null
  /** 点位动画截图原始 URL */
  animeImage: string
  /** 用户实拍的 object URL；有值就切 compare 布局 */
  photoObjectUrl: string | null
  /** 短链绝对地址，画进二维码 */
  shareUrl: string
}

const QUALITY_FIRST = 0.9
const QUALITY_RETRY = 0.72

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality))
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
) {
  const rect = computeCoverRect(img.width, img.height, box.width, box.height)
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, box.x, box.y, box.width, box.height)
}

function metaLine(input: PointShareCardInput): string {
  const parts: string[] = []
  if (input.cityName) parts.push(input.cityName)
  if (input.episode) {
    parts.push(input.locale === 'en' ? `EP ${input.episode}` : `第 ${input.episode} 集`)
  }
  if (input.scene) parts.push(input.scene)
  return parts.join(' · ')
}

function animeLine(input: PointShareCardInput): string {
  if (input.locale === 'en') return input.animeTitle
  if (input.locale === 'ja') return `『${input.animeTitle}』`
  return `《${input.animeTitle}》`
}

export default function PointShareCard({
  input,
  onRendered,
  onError,
}: {
  input: PointShareCardInput
  onRendered: (blob: Blob) => void
  onError: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const render = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const variant = resolveCardVariant(Boolean(input.photoObjectUrl))
      const layout = buildCardLayout(input.layout, variant)
      canvas.width = layout.canvas.width
      canvas.height = layout.canvas.height

      const safeAnimeUrl = input.animeImage
        ? toCanvasSafeImageUrl(input.animeImage, `${input.pointName}-share-card`)
        : ''
      const qrDataUrl = await QRCode.toDataURL(input.shareUrl, {
        margin: 1,
        width: layout.qr.size,
        color: { dark: '#111827', light: '#ffffff' },
      })

      const [animeImg, photoImg, qrImg, logoImg] = await Promise.all([
        safeAnimeUrl ? loadImage(safeAnimeUrl, 'anonymous').catch(() => null) : Promise.resolve(null),
        input.photoObjectUrl ? loadImage(input.photoObjectUrl).catch(() => null) : Promise.resolve(null),
        loadImage(qrDataUrl).catch(() => null),
        loadImage('/brand/web-logo.png').catch(() => null),
      ])

      // 底色
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, layout.canvas.width, layout.canvas.height)

      // 主视觉
      if (animeImg) {
        drawCover(ctx, animeImg, layout.main)
      } else {
        const gradient = ctx.createLinearGradient(0, 0, layout.main.width, layout.main.height)
        gradient.addColorStop(0, '#fce7f3')
        gradient.addColorStop(1, '#fdf2f8')
        ctx.fillStyle = gradient
        ctx.fillRect(layout.main.x, layout.main.y, layout.main.width, layout.main.height)
      }
      if (layout.photo && photoImg) drawCover(ctx, photoImg, layout.photo)

      // 文字块
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      const titleSize = input.layout === 'portrait' ? 60 : 40
      const bodySize = input.layout === 'portrait' ? 34 : 24

      ctx.fillStyle = '#111827'
      ctx.font = `bold ${titleSize}px system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif`
      const nameLines = wrapLines(
        (text) => ctx.measureText(text).width,
        input.pointName,
        layout.textWidth,
        2,
      )
      let cursorY = layout.textTop
      for (const line of nameLines) {
        ctx.fillText(line, layout.padding, cursorY)
        cursorY += titleSize + 12
      }

      ctx.fillStyle = '#be185d'
      ctx.font = `600 ${bodySize + 4}px system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif`
      const animeLines = wrapLines(
        (text) => ctx.measureText(text).width,
        animeLine(input),
        layout.textWidth,
        1,
      )
      for (const line of animeLines) {
        ctx.fillText(line, layout.padding, cursorY)
        cursorY += bodySize + 18
      }

      ctx.fillStyle = '#6b7280'
      ctx.font = `400 ${bodySize}px system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif`
      const meta = metaLine(input)
      if (meta) ctx.fillText(meta, layout.padding, cursorY)

      // 二维码
      if (qrImg) {
        ctx.drawImage(qrImg, layout.qr.x, layout.qr.y, layout.qr.size, layout.qr.size)
      }

      // 页脚：鸟居图标 + 站点名
      ctx.textBaseline = 'alphabetic'
      const footerSize = input.layout === 'portrait' ? 30 : 22
      ctx.fillStyle = '#9ca3af'
      ctx.font = `500 ${footerSize}px system-ui, -apple-system, sans-serif`
      ctx.fillText('⛩ seichigo.com', layout.padding, layout.footerY)
      if (logoImg) {
        const logoHeight = footerSize + 8
        const logoWidth = logoHeight * (logoImg.width / logoImg.height || 1)
        ctx.drawImage(
          logoImg,
          layout.canvas.width - layout.padding - logoWidth,
          layout.footerY - logoHeight + 6,
          logoWidth,
          logoHeight,
        )
      }

      let blob = await toBlob(canvas, QUALITY_FIRST)
      if (blob && blob.size > SHARE_CARD_MAX_BYTES) {
        // 体积超标只降一次质量：再降画质就不能看了，宁可让上传报 413
        blob = (await toBlob(canvas, QUALITY_RETRY)) ?? blob
      }
      if (!blob) {
        onError()
        return
      }
      onRendered(blob)
    } catch (error) {
      console.error('[share.card.render_failed]', error)
      onError()
    }
  }, [input, onRendered, onError])

  useEffect(() => {
    void render()
  }, [render])

  return <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project jsdom tests/components/pointShareCard.test.tsx
```

预期：`Tests  3 passed`。

- [ ] **Step 5: commit**

```bash
git add components/share/PointShareCard.tsx tests/components/pointShareCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(share): 点位分享卡片的 canvas 渲染器，超 1.5MB 降质重试一次

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B5: 浏览器侧动作 `components/share/shareClient.ts`

**Files:**
- Create: `components/share/shareClient.ts`
- Test: `tests/components/shareClient.test.ts`

- [ ] **Step 1: 写失败测试 `tests/components/shareClient.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAYOUT_STORAGE_KEY,
  createShareLink,
  readPreferredLayout,
  uploadShareAssets,
  writePreferredLayout,
} from '@/components/share/shareClient'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  globalThis.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createShareLink', () => {
  it('POST /api/share/links 并返回 code/url', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await createShareLink({
      pointId: '101:suga',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
    })
    expect(result).toEqual({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/share/links')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      pointId: '101:suga',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
    })
  })

  it('非 2xx 返回 null 而不是抛', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 429 }))
    await expect(
      createShareLink({ pointId: 'p', bangumiId: 1, locale: 'zh', layout: 'portrait' }),
    ).resolves.toBeNull()
  })
})

describe('uploadShareAssets', () => {
  it('把 card/photo 塞进 FormData', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, imageUrl: '/api/share/img/AbC12xYz', photoUrl: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const card = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    const photo = new File([new Uint8Array(1)], 'p.jpg', { type: 'image/jpeg' })
    const result = await uploadShareAssets('AbC12xYz', card, photo)
    expect(result?.imageUrl).toBe('/api/share/img/AbC12xYz')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/share/links/AbC12xYz/upload')
    const form = init.body as FormData
    expect(form.get('card')).toBeInstanceOf(File)
    expect(form.get('photo')).toBeInstanceOf(File)
  })

  it('401 时返回 null（匿名分享照常，只是不上传）', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: '请先登录' }), { status: 401 }))
    const card = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    await expect(uploadShareAssets('AbC12xYz', card, null)).resolves.toBeNull()
  })
})

describe('版式记忆', () => {
  it('没存过时返回 portrait', () => {
    expect(readPreferredLayout()).toBe('portrait')
  })

  it('存过就读回来，非法值忽略', () => {
    writePreferredLayout('landscape')
    expect(globalThis.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe('landscape')
    expect(readPreferredLayout()).toBe('landscape')
    globalThis.localStorage.setItem(LAYOUT_STORAGE_KEY, 'square')
    expect(readPreferredLayout()).toBe('portrait')
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project jsdom tests/components/shareClient.test.ts
```

> 注意：`.test.ts` 会被 node project 收走。本文件依赖 `localStorage` 与 `FormData/File`，请把它命名为 `tests/components/shareClient.test.ts` 并在文件顶部加 `// @vitest-environment jsdom`，或直接改名为 `.test.tsx`。**本计划采用后者：文件名用 `tests/components/shareClient.test.tsx`**，命令相应为：

```bash
npx vitest run --project jsdom tests/components/shareClient.test.tsx
```

预期输出包含：`Error: Failed to resolve import "@/components/share/shareClient"`。

- [ ] **Step 3: 实现 `components/share/shareClient.ts`**

```ts
import type {
  CreateShareLinkRequest,
  CreateShareLinkResponse,
  ShareCardLayout,
  ShareUploadResponse,
} from '@/lib/share/types'
import { isShareCardLayout } from '@/lib/share/types'

export const LAYOUT_STORAGE_KEY = 'seichigo.share.layout'

export async function createShareLink(
  input: CreateShareLinkRequest,
): Promise<CreateShareLinkResponse | null> {
  try {
    const res = await fetch('/api/share/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) return null
    return (await res.json()) as CreateShareLinkResponse
  } catch {
    return null
  }
}

/** 上传失败（未登录 401、限流 429、无绑定 503）都只返回 null：匿名分享照常走 */
export async function uploadShareAssets(
  code: string,
  card: Blob,
  photo: File | null,
): Promise<ShareUploadResponse | null> {
  try {
    const form = new FormData()
    form.set('card', new File([card], `${code}.jpg`, { type: card.type || 'image/jpeg' }))
    if (photo) form.set('photo', photo)
    const res = await fetch(`/api/share/links/${code}/upload`, { method: 'POST', body: form })
    if (!res.ok) return null
    return (await res.json()) as ShareUploadResponse
  } catch {
    return null
  }
}

export function readPreferredLayout(): ShareCardLayout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_STORAGE_KEY)
    return isShareCardLayout(raw) ? raw : 'portrait'
  } catch {
    return 'portrait'
  }
}

export function writePreferredLayout(layout: ShareCardLayout): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_STORAGE_KEY, layout)
  } catch {
    // 隐私模式下写不进去，忽略
  }
}

export function canShareFiles(files: File[]): boolean {
  const nav = globalThis.navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav?.share !== 'function') return false
  if (typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files })
  } catch {
    return false
  }
}

export async function shareViaSystem(input: {
  files: File[]
  text: string
  url: string
}): Promise<'files' | 'text' | 'failed'> {
  const nav = globalThis.navigator
  if (typeof nav?.share !== 'function') return 'failed'
  try {
    if (canShareFiles(input.files)) {
      await nav.share({ files: input.files, text: input.text, url: input.url })
      return 'files'
    }
    await nav.share({ text: input.text, url: input.url })
    return 'text'
  } catch {
    return 'failed'
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** ClipboardItem 只接受 image/png，所以先把 JPEG 过一遍 canvas 转 PNG */
export async function copyImage(blob: Blob): Promise<boolean> {
  const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (!ClipboardItemCtor || typeof globalThis.navigator?.clipboard?.write !== 'function') return false
  try {
    const png = blob.type === 'image/png' ? blob : await toPngBlob(blob)
    if (!png) return false
    await globalThis.navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}

async function toPngBlob(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // 立刻 revoke 会让部分浏览器下载空文件，延后一拍
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project jsdom tests/components/shareClient.test.tsx
```

预期：`Tests  6 passed`。

- [ ] **Step 5: commit**

```bash
git add components/share/shareClient.ts tests/components/shareClient.test.tsx
git commit -m "$(cat <<'EOF'
feat(share): 浏览器侧建短链/上传/系统分享/复制/下载与版式记忆

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B6: 分享面板 `components/share/PointSharePanel.tsx`

**Files:**
- Create: `components/share/PointSharePanel.tsx`
- Test: `tests/components/pointSharePanel.test.tsx`

- [ ] **Step 1: 写失败测试 `tests/components/pointSharePanel.test.tsx`**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

// 卡片渲染器在 jsdom 里没有 canvas，直接桩成「立刻回调一个 Blob」
vi.mock('@/components/share/PointShareCard', () => ({
  default: ({ onRendered }: { onRendered: (blob: Blob) => void }) => {
    const blob = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    setTimeout(() => onRendered(blob), 0)
    return <canvas data-testid="stub-card" />
  },
}))

const createShareLinkMock = vi.fn()
const uploadShareAssetsMock = vi.fn()
vi.mock('@/components/share/shareClient', async () => {
  const actual = await vi.importActual<typeof import('@/components/share/shareClient')>(
    '@/components/share/shareClient',
  )
  return {
    ...actual,
    createShareLink: (...args: any[]) => createShareLinkMock(...args),
    uploadShareAssets: (...args: any[]) => uploadShareAssetsMock(...args),
  }
})

const PROPS = {
  pointId: '101:suga',
  bangumiId: 101,
  pointName: '须贺神社',
  animeTitle: '你的名字。',
  cityName: '东京',
  episode: '1',
  scene: null,
  animeImage: 'https://image.anitabi.cn/points/101/suga.jpg',
  locale: 'zh' as const,
  onClose: vi.fn(),
}

beforeEach(() => {
  createShareLinkMock.mockReset()
  uploadShareAssetsMock.mockReset()
  createShareLinkMock.mockResolvedValue({
    code: 'AbC12xYz',
    url: 'https://seichigo.com/s/AbC12xYz',
  })
  uploadShareAssetsMock.mockResolvedValue(null)
  globalThis.localStorage.clear()
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('PointSharePanel 三语渲染', () => {
  it.each(['zh', 'en', 'ja'] as const)('%s 用对应语言的按钮文案', async (locale) => {
    render(<PointSharePanel {...PROPS} locale={locale} />)
    expect(screen.getByText(t('share.panelTitle', locale))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.saveImage', locale) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.layoutPortrait', locale) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.layoutLandscape', locale) })).toBeInTheDocument()
  })
})

describe('PointSharePanel 短链与平台按钮', () => {
  it('打开时就建短链', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(1))
    expect(createShareLinkMock).toHaveBeenCalledWith({
      pointId: '101:suga',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
    })
  })

  it('平台按钮 href 带正确的渠道参数与编码', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'X' })).toBeInTheDocument())

    const x = screen.getByRole('link', { name: 'X' }) as HTMLAnchorElement
    expect(x.href).toContain('https://twitter.com/intent/tweet?text=')
    expect(decodeURIComponent(x.href)).toContain('https://seichigo.com/s/AbC12xYz?c=x')

    const reddit = screen.getByRole('link', { name: 'Reddit' }) as HTMLAnchorElement
    expect(reddit.href).toContain(encodeURIComponent('https://seichigo.com/s/AbC12xYz?c=rd'))

    const line = screen.getByRole('link', { name: 'LINE' }) as HTMLAnchorElement
    expect(line.href).toContain('https://social-plugins.line.me/lineit/share?url=')
    expect(line.href).toContain(encodeURIComponent('https://seichigo.com/s/AbC12xYz?c=ln'))
  })

  it('切到横版会用新版式再建一条短链，并记住选择', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    expect(createShareLinkMock.mock.calls[1]![0].layout).toBe('landscape')
    expect(globalThis.localStorage.getItem('seichigo.share.layout')).toBe('landscape')
  })

  it('文案预填含作品、地名、城市与短链', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByLabelText(t('share.captionLabel', 'zh'))).toHaveValue(
      '《你的名字。》圣地巡礼｜须贺神社（东京）https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
    ))
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project jsdom tests/components/pointSharePanel.test.tsx
```

预期输出包含：`Error: Failed to resolve import "@/components/share/PointSharePanel"`。

- [ ] **Step 3: 实现 `components/share/PointSharePanel.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Copy, Download, Loader2, Share2, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { ShareCardLayout, ShareChannel } from '@/lib/share/types'
import PointShareCard, { type PointShareCardInput } from '@/components/share/PointShareCard'
import {
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  withShareChannel,
} from '@/components/share/shareText'
import {
  blobToFile,
  copyImage,
  copyText,
  createShareLink,
  downloadBlob,
  readPreferredLayout,
  shareViaSystem,
  uploadShareAssets,
  writePreferredLayout,
} from '@/components/share/shareClient'

export type PointSharePanelProps = {
  pointId: string
  bangumiId: number
  pointName: string
  animeTitle: string
  cityName: string
  episode: string | null
  scene: string | null
  animeImage: string
  locale?: SupportedLocale
  onClose?: () => void
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export default function PointSharePanel({
  pointId,
  bangumiId,
  pointName,
  animeTitle,
  cityName,
  episode,
  scene,
  animeImage,
  locale = 'zh',
  onClose,
}: PointSharePanelProps) {
  const [layout, setLayout] = useState<ShareCardLayout>(() => readPreferredLayout())
  const [shareUrl, setShareUrl] = useState<string>('')
  const [code, setCode] = useState<string>('')
  const [cardBlob, setCardBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const uploadedRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 版式变了就换一条短链：短链上记录了 layout，OG 图尺寸要对得上
  useEffect(() => {
    let cancelled = false
    setShareUrl('')
    setCode('')
    uploadedRef.current = false
    createShareLink({ pointId, bangumiId, locale, layout }).then((result) => {
      if (cancelled || !result) return
      setShareUrl(result.url)
      setCode(result.code)
    })
    return () => {
      cancelled = true
    }
  }, [pointId, bangumiId, locale, layout])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl)
    }
  }, [previewUrl, photoObjectUrl])

  const cardInput: PointShareCardInput | null = useMemo(() => {
    if (!shareUrl) return null
    return {
      layout,
      locale,
      pointName,
      animeTitle,
      cityName,
      episode,
      scene,
      animeImage,
      photoObjectUrl,
      shareUrl,
    }
  }, [shareUrl, layout, locale, pointName, animeTitle, cityName, episode, scene, animeImage, photoObjectUrl])

  const handleRendered = useCallback(
    (blob: Blob) => {
      setFailed(false)
      setCardBlob(blob)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      // 登录用户静默上传一次：401/429/503 都返回 null，匿名分享照常
      if (code && !uploadedRef.current) {
        uploadedRef.current = true
        void uploadShareAssets(code, blob, photo)
      }
    },
    [code, photo],
  )

  const handleRenderError = useCallback(() => setFailed(true), [])

  const showToast = useCallback((key: string) => {
    setToast(t(key, locale))
    setTimeout(() => setToast(null), 2200)
  }, [locale])

  const captionFor = useCallback(
    (channel: ShareChannel) =>
      buildShareCaption(t('share.captionTemplate', locale), {
        anime: animeTitle,
        point: pointName,
        city: cityName,
        url: shareUrl ? withShareChannel(shareUrl, channel) : '',
      }),
    [locale, animeTitle, pointName, cityName, shareUrl],
  )

  const copyCaption = captionFor('copy')

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPhoto(file)
    setPhotoObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    uploadedRef.current = false
  }

  const removePhoto = () => {
    setPhoto(null)
    setPhotoObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (fileRef.current) fileRef.current.value = ''
    uploadedRef.current = false
  }

  const handleSystemShare = async () => {
    if (!cardBlob) return
    const file = blobToFile(cardBlob, `seichigo-${pointName}.jpg`)
    const result = await shareViaSystem({
      files: [file],
      text: captionFor('sys'),
      url: withShareChannel(shareUrl, 'sys'),
    })
    if (result === 'text') showToast('share.toastShareFilesUnsupported')
    if (result === 'failed') showToast('share.toastFailed')
  }

  const handleCopyImage = async () => {
    if (!cardBlob) return
    showToast((await copyImage(cardBlob)) ? 'share.toastImageCopied' : 'share.toastFailed')
  }

  const handleCopyText = async () => {
    showToast((await copyText(copyCaption)) ? 'share.toastCopied' : 'share.toastFailed')
  }

  const handleSave = (channel: ShareChannel = 'save') => {
    if (!cardBlob) return
    downloadBlob(cardBlob, `seichigo-${pointName}-${Date.now()}.jpg`)
    if (channel === 'save') showToast('share.toastSaved')
  }

  const handleAppFlow = async (channel: 'xhs' | 'wx') => {
    handleSave(channel)
    await copyText(captionFor(channel))
    showToast('share.toastPasteInApp')
  }

  const ready = Boolean(cardBlob && shareUrl)

  return (
    <div className="flex max-h-[88vh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <button type="button" onClick={onClose} aria-label={t('share.close', locale)} className="-ml-2 rounded-full p-2 hover:bg-gray-100">
          <X className="h-5 w-5 text-gray-400" />
        </button>
        <h3 className="text-base font-bold text-gray-900">{t('share.panelTitle', locale)}</h3>
        <div className="w-9" />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div
          className={`relative overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 ${
            layout === 'portrait' ? 'aspect-[1080/1440]' : 'aspect-[1200/630]'
          }`}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={t('share.panelTitle', locale)} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
              {failed ? (
                <p className="text-sm">{t('share.generateFailed', locale)}</p>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-brand" />
                  <p className="text-sm">{t('share.generating', locale)}</p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t('share.layoutLabel', locale)}</span>
          {(['portrait', 'landscape'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setLayout(value)
                writePreferredLayout(value)
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                layout === value ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {t(value === 'portrait' ? 'share.layoutPortrait' : 'share.layoutLandscape', locale)}
            </button>
          ))}
          <div className="ml-auto">
            {photo ? (
              <button type="button" onClick={removePhoto} className="text-xs font-medium text-gray-500 underline">
                {t('share.removePhoto', locale)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand"
              >
                <Camera className="h-4 w-4" />
                {t('share.addPhoto', locale)}
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoChange}
        />

        <label className="block space-y-1">
          <span className="text-xs text-gray-500">{t('share.captionLabel', locale)}</span>
          <textarea
            readOnly
            rows={3}
            value={copyCaption}
            aria-label={t('share.captionLabel', locale)}
            className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={!ready} onClick={handleSystemShare} className={`${BUTTON_BASE} bg-gray-900 text-white sm:hidden`}>
            <Share2 className="h-4 w-4" />
            {t('share.systemShare', locale)}
          </button>
          <button type="button" disabled={!ready} onClick={handleCopyImage} className={`${BUTTON_BASE} hidden bg-gray-900 text-white sm:inline-flex`}>
            <Copy className="h-4 w-4" />
            {t('share.copyImage', locale)}
          </button>
          <button type="button" disabled={!shareUrl} onClick={handleCopyText} className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}>
            {t('share.copyText', locale)}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <a
            href={shareUrl ? buildXIntentUrl(captionFor('x')) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`${BUTTON_BASE} bg-gray-100 text-gray-800 no-underline`}
          >
            {t('share.platformX', locale)}
          </a>
          <a
            href={shareUrl ? buildRedditSubmitUrl(withShareChannel(shareUrl, 'rd'), `${pointName}｜${animeTitle}`) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`${BUTTON_BASE} bg-gray-100 text-gray-800 no-underline`}
          >
            {t('share.platformReddit', locale)}
          </a>
          <a
            href={shareUrl ? buildLineShareUrl(withShareChannel(shareUrl, 'ln'), captionFor('ln')) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`${BUTTON_BASE} bg-gray-100 text-gray-800 no-underline`}
          >
            {t('share.platformLine', locale)}
          </a>
          <button type="button" disabled={!ready} onClick={() => handleAppFlow('xhs')} className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}>
            {t('share.platformXiaohongshu', locale)}
          </button>
          <button type="button" disabled={!ready} onClick={() => handleAppFlow('wx')} className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}>
            {t('share.platformWechat', locale)}
          </button>
          <button type="button" disabled={!ready} onClick={() => handleSave()} className={`${BUTTON_BASE} bg-brand text-white`}>
            <Download className="h-4 w-4" />
            {t('share.saveImage', locale)}
          </button>
        </div>

        {toast ? (
          <div role="status" className="rounded-xl bg-gray-900/90 px-3 py-2 text-center text-xs text-white">
            {toast}
          </div>
        ) : null}
      </div>

      {cardInput ? (
        <PointShareCard input={cardInput} onRendered={handleRendered} onError={handleRenderError} />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project jsdom tests/components/pointSharePanel.test.tsx
```

预期：`Tests  7 passed`。

- [ ] **Step 5: commit**

```bash
git add components/share/PointSharePanel.tsx tests/components/pointSharePanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(share): 点位分享面板，含版式切换、实拍对比与五个平台入口

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B7: `DetailPanel` 常驻分享按钮，删除「打卡卡片」

**Files:**
- Modify: `features/map/anitabi/DetailPanel.tsx`（第 31、42、66、77、181-190 行）
- Test: `tests/components/detailPanelShare.test.tsx`

- [ ] **Step 1: 写失败测试 `tests/components/detailPanelShare.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DetailPanel from '@/features/map/anitabi/DetailPanel'
import { L } from '@/features/map/anitabi/shared'

function makeProps(overrides: Record<string, unknown> = {}) {
  const point = {
    id: '101:suga',
    bangumiId: 101,
    name: '须贺神社',
    nameZh: '须贺神社',
    note: null,
    geo: [35.6, 139.7] as [number, number],
    ep: '1',
    s: null,
    image: null,
    origin: null,
    originUrl: null,
    originLink: null,
    density: null,
    mark: null,
  }
  return {
    label: L.zh,
    attributionLabel: 'via Anitabi',
    detail: { card: { id: 101, title: '你的名字。', city: '东京', cover: null }, points: [point] } as any,
    detailCardMode: 'point' as const,
    selectedPoint: point,
    selectedPointState: 'none',
    selectedPointDistanceMeters: null,
    selectedPointPanoramaAvailable: false,
    detailLoading: false,
    workDetailExpanded: false,
    quickPilgrimageProgress: { checked: 0, total: 1 },
    viewFilter: 'all' as const,
    stateFilter: [] as string[],
    detailPoints: [{ point, distanceMeters: null }],
    selectedPointImage: null,
    showWantToGoAction: false,
    formatDistance: (m: number) => `${m}m`,
    geoHref: null,
    onCloseWorkDetail: vi.fn(),
    onSwitchToBangumiDetail: vi.fn(),
    onToggleWorkDetailExpanded: vi.fn(),
    onShowQuickPilgrimage: vi.fn(),
    onChangeViewFilter: vi.fn(),
    onToggleStateFilter: vi.fn(),
    onSelectPoint: vi.fn(),
    onAddSelectedPointToPool: vi.fn(),
    onShowSharePanel: vi.fn(),
    onEnterPanorama: vi.fn(),
    onAddPointToPool: vi.fn(),
    getPointState: () => 'none',
    ...overrides,
  }
}

describe('DetailPanel 分享按钮', () => {
  it('未打卡也常驻显示，点击触发 onShowSharePanel', () => {
    const onShowSharePanel = vi.fn()
    render(<DetailPanel {...(makeProps({ onShowSharePanel }) as any)} />)
    const button = screen.getByRole('button', { name: L.zh.share })
    fireEvent.click(button)
    expect(onShowSharePanel).toHaveBeenCalledTimes(1)
  })

  it('不再有硬编码的「打卡卡片」按钮', () => {
    render(<DetailPanel {...(makeProps() as any)} />)
    expect(screen.queryByText('打卡卡片')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project jsdom tests/components/detailPanelShare.test.tsx
```

预期输出包含：`TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "分享"`。

- [ ] **Step 3: 改 `features/map/anitabi/DetailPanel.tsx`**

3a. 删掉第 31 行的 `checkedInSelectedPoint: boolean`。

3b. 第 42 行 `onShowCheckInCard: () => void` 改成：

```ts
  onShowSharePanel: () => void
```

3c. 删掉第 66 行解构里的 `checkedInSelectedPoint,`。

3d. 第 77 行 `onShowCheckInCard,` 改成 `onShowSharePanel,`。

3e. 第 181-190 行整块（`{checkedInSelectedPoint ? ( ... ) : null}`）替换成常驻按钮：

```tsx
            <button
              type="button"
              className="inline-flex min-w-[92px] items-center justify-center rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
              onClick={onShowSharePanel}
            >
              {label.share}
            </button>
```

`label.share` 已存在于 `features/map/anitabi/shared.ts` 的三语表（第 459、569、679 行），本 Task 不改 `shared.ts`。

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project jsdom tests/components/detailPanelShare.test.tsx
```

预期：`Tests  2 passed`。（此刻 `npx tsc` 仍会在 `AnitabiMapLayout.tsx` 报 `checkedInSelectedPoint` / `onShowCheckInCard` 不匹配，Task B8 修掉。）

- [ ] **Step 5: commit**

```bash
git add features/map/anitabi/DetailPanel.tsx tests/components/detailPanelShare.test.tsx
git commit -m "$(cat <<'EOF'
feat(map): 点位详情面板常驻分享按钮，移除仅打卡后可见的打卡卡片入口

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B8: 装配分享面板，删除 `CheckInCard`

**Files:**
- Modify: `features/map/anitabi/MapDialogs.tsx`（第 7、66-67、111-112、309-322 行）
- Modify: `features/map/anitabi/AnitabiMapLayout.tsx`（第 111、121、189-191、220、512-513、528-533 行）
- Modify: `features/map/anitabi/useAnitabiMapController.ts`（第 186、856、865 行，**等行数重命名**）
- Delete: `components/share/CheckInCard.tsx`
- Test: `tests/map/mapDialogs.test.tsx`（第 55-56 行）

- [ ] **Step 1: 改 `tests/map/mapDialogs.test.tsx` 让它先红**

第 55-56 行

```ts
    showCheckInCard: false,
    setShowCheckInCard: vi.fn(),
```

改成

```ts
    showSharePanel: false,
    setShowSharePanel: vi.fn(),
```

并在文件末尾追加一条新用例：

```tsx
describe('MapDialogs 分享面板', () => {
  it('showSharePanel 打开时渲染分享面板标题', () => {
    render(
      <MapDialogs
        {...(createProps() as any)}
        showSharePanel
        detail={{ card: { id: 101, title: '君の名は。', city: '東京', cover: null }, points: [] } as any}
        selectedPoint={
          {
            id: '101:suga',
            bangumiId: 101,
            name: '須賀神社',
            nameZh: '须贺神社',
            note: null,
            geo: [35.6, 139.7],
            ep: '1',
            s: null,
            image: null,
            origin: null,
            originUrl: null,
            originLink: null,
            density: null,
            mark: null,
          } as any
        }
      />,
    )
    expect(screen.getByText('このスポットを共有')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试看它失败**

```bash
npx vitest run --project jsdom tests/map/mapDialogs.test.tsx
```

预期输出包含：`TestingLibraryElementError: Unable to find an element with the text: このスポットを共有`。

- [ ] **Step 3a: 改 `features/map/anitabi/MapDialogs.tsx`**

第 7 行的 import 换掉：

```tsx
import PointSharePanel from '@/components/share/PointSharePanel'
```

第 66-67 行的 props 改名：

```ts
  showSharePanel: boolean
  setShowSharePanel: Dispatch<SetStateAction<boolean>>
```

第 111-112 行的解构同步改名：

```ts
    showSharePanel,
    setShowSharePanel,
```

第 309-322 行整段 `<Dialog.Root open={showCheckInCard} …>` 替换成（移动端底部抽屉、桌面居中弹窗，与既有 `showComparisonGenerator` 那段第 347-350 行的定位类名同一套）：

```tsx
      <Dialog.Root open={showSharePanel} onOpenChange={setShowSharePanel}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed bottom-0 left-1/2 z-[131] w-full max-w-md -translate-x-1/2 p-3 focus:outline-none sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:p-4">
            {selectedPoint ? (
              <PointSharePanel
                pointId={selectedPoint.id}
                bangumiId={detail?.card.id ?? selectedPoint.bangumiId}
                pointName={selectedPoint.name}
                animeTitle={detail?.card.title || ''}
                cityName={detail?.card.city || ''}
                episode={selectedPoint.ep}
                scene={selectedPoint.s}
                animeImage={selectedPointImagePreviewUrl || selectedPoint.image || ''}
                locale={locale}
                onClose={() => setShowSharePanel(false)}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
```

- [ ] **Step 3b: 改 `features/map/anitabi/AnitabiMapLayout.tsx`**

- 第 111 行 `showCheckInCard,` → `showSharePanel,`
- 第 121 行 `setShowCheckInCard,` → `setShowSharePanel,`
- 删掉第 189-191 行整块：

```tsx
      checkedInSelectedPoint={Boolean(
        meState?.pointStates.find((ps: any) => ps.pointId === selectedPoint?.id && ps.state === 'checked_in')
      )}
```

- 第 220 行 `onShowCheckInCard={() => setShowCheckInCard(true)}` → `onShowSharePanel={() => setShowSharePanel(true)}`
- 第 512-513 行

```tsx
        showCheckInCard={showCheckInCard}
        setShowCheckInCard={setShowCheckInCard}
```

改成

```tsx
        showSharePanel={showSharePanel}
        setShowSharePanel={setShowSharePanel}
```

- 第 528-533 行的 `onComparisonSuccess` 里 `setShowCheckInCard(true)` → `setShowSharePanel(true)`

- [ ] **Step 3c: 改 `features/map/anitabi/useAnitabiMapController.ts`（只改名，不增删行）**

- 第 186 行：`const [showCheckInCard, setShowCheckInCard] = useState(false)` → `const [showSharePanel, setShowSharePanel] = useState(false)`
- 第 856 行：`setShowCheckInCard,` → `setShowSharePanel,`
- 第 865 行：`showCheckInCard,` → `showSharePanel,`

返回对象里的键是按字母序排的，`setShowSharePanel` / `showSharePanel` 的位置与原来的 `setShowCheckInCard` / `showCheckInCard` 相邻，排序不会因此变化；确认文件行数仍是 883：

```bash
wc -l features/map/anitabi/useAnitabiMapController.ts
```

预期输出：`     883 features/map/anitabi/useAnitabiMapController.ts`（多一行就会被 `line-budget.allowlist.json:11` 卡住）。

- [ ] **Step 3d: 删除旧组件并确认无残留引用**

```bash
git rm components/share/CheckInCard.tsx
grep -rn "CheckInCard\|showCheckInCard\|onShowCheckInCard\|checkedInSelectedPoint" app components features lib tests
```

预期：`grep` 无输出。

- [ ] **Step 4: 跑通过**

```bash
npx vitest run --project jsdom tests/map/mapDialogs.test.tsx && npx tsc -p tsconfig.app.json --noEmit
```

预期：`Tests  3 passed`（原有 2 条 + 新增 1 条）；`tsc` 无输出。

- [ ] **Step 5: commit**

```bash
git add features/map/anitabi/MapDialogs.tsx features/map/anitabi/AnitabiMapLayout.tsx features/map/anitabi/useAnitabiMapController.ts tests/map/mapDialogs.test.tsx
git commit -m "$(cat <<'EOF'
feat(map): 分享面板接入地图弹窗层，删除 CheckInCard 及其状态

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task B9: 全量验证与浏览器冒烟

**Files:**
- 无新增文件；只跑验证。

- [ ] **Step 1: 全量测试 + 类型检查**

```bash
npm test && npm run typecheck
```

预期：`check-line-budget` 无超标输出；`node`、`jsdom`、`workers` 三个 project 全绿；`typecheck:app` 与 `typecheck:tests` 均无输出。

- [ ] **Step 2: 本地构建**

```bash
npm run build
```

预期：`✓ Compiled successfully`，路由清单里出现 `/s/[code]`、`/api/share/links`、`/api/share/links/[code]/upload`、`/api/share/img/[code]`、`/api/share/photo/[userId]/[pointId]`，且不再有 `/api/anitabi/share-image`。

- [ ] **Step 3: 起本地 server 做浏览器冒烟**

端口用 3457（3001 被 claudecodeui 占着），dev 与 build 不要在同一 worktree 同时跑：

```bash
npx next start -p 3457
```

另开一个终端，用 Playwright 走一遍：打开 `http://localhost:3457/map?b=<任一 bangumiId>&p=<该作品的 pointId>` → 点位卡出现 → 点「分享」→ 面板出现 → 切「横版」→ 预览比例从 3:4 变 1.91:1 → 点「保存图片」→ 下载到的 JPEG 是 1080×1440（竖版）/ 1200×630（横版）。无头模式跑地图要加 swiftshader 参数。

- [ ] **Step 4: 记录结论**

把冒烟结果（截图尺寸、下载文件尺寸）贴进 PR 描述。若发现问题，回到对应 Task 修，不要在这里直接改。

- [ ] **Step 5: commit（仅当 Step 3 暴露出需要修的小问题时）**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(share): 浏览器冒烟发现的问题修正

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

# 部署与迁移

1. 两条 Track 都 merge 回 `main`（`--no-ff`），先在 `main` 上跑一次 `npm test && npm run typecheck && npm run build`。
2. 迁移在部署前对生产库执行，`DATABASE_URL` 与 `DATABASE_URL_UNPOOLED` 必须同时注入（`.env.local` 里的 Neon 串）：

```bash
DATABASE_URL="$PROD_POOLED" DATABASE_URL_UNPOOLED="$PROD_DIRECT" npx prisma migrate deploy
```

预期输出包含：`Applying migration `20260908010000_share_link``、`1 migration found`。

3. 先出预览验一遍，用户明确说可以后再 `npm run cf:deploy`。部署成功后按 `seichigo-deploy-ledger` 打 `deploy/<ISO>` 标签。

---

# Self-Review — 逐条对照 spec

## §一 分享入口

| spec 条目 | 覆盖 Task |
| --- | --- |
| `DetailPanel.tsx` 点位模式常驻「分享」按钮，桌面与移动端都有 | **B7** Step 3e（按钮画在点位模式的动作行里，桌面/移动端共用同一段 JSX） |
| 不再以 `checkedInSelectedPoint` 为条件 | **B7** Step 3a/3c（prop 与解构一并删除）+ **B8** Step 3b（`AnitabiMapLayout.tsx:189-191` 的传参删除） |
| 原「打卡卡片」按钮删除，能力并入分享面板 | **B7** Step 3e + **B8** Step 3d（`git rm components/share/CheckInCard.tsx`） |
| 移动端底部抽屉、桌面居中弹窗，装配在 `MapDialogs.tsx` | **B8** Step 3a（`Dialog.Content` 的 `bottom-0 … sm:top-1/2` 类名） |

## §二 分享面板

| spec 条目 | 覆盖 Task |
| --- | --- |
| `components/share/PointShareCard.tsx` 纯客户端 canvas 渲染，输入点位 DTO + 作品卡信息 + locale + 版式 + 实拍 + 短链 | **B4**（`PointShareCardInput`） |
| `portrait` 1080×1440 / `landscape` 1200×630 | **A1**（`SHARE_CARD_SIZES`）+ **B3**（`buildCardLayout`）+ **B4**（`canvas.width/height`） |
| `default` 布局：动画截图主视觉 + 地名/作品名/集数与时间戳/城市/二维码/鸟居 + seichigo.com | **B3**（槽位）+ **B4**（`metaLine` 里的 `ep`/`s`/`city`、二维码、页脚） |
| `compare` 布局：仅当有实拍时左右（横版）/上下（竖版）并排 | **B3**（`resolveCardVariant` + `buildCardLayout` 的 `photo` 槽位）+ **B4** |
| 地名取当前语言，回退 `nameZh`/`name` | **B8** Step 3a：`selectedPoint.name` 已由 `getBangumiDetail`（`lib/anitabi/readDetail.ts:98-103`）按 locale 取 `AnitabiPointI18n.name` 并回退，面板直接用 |
| 图片一律经 `toCanvasSafeImageUrl` | **B4**（`safeAnimeUrl`） |
| 输出 JPEG 0.9，控制在 1.5 MB 内，超出降质重试一次 | **B4**（`QUALITY_FIRST`/`QUALITY_RETRY` + `SHARE_CARD_MAX_BYTES`） |
| 面板顶部卡片实时预览 | **B6**（`previewUrl` 的 `<img>`） |
| 版式切换，localStorage 记忆，首次默认竖版 | **B5**（`readPreferredLayout`/`writePreferredLayout`）+ **B6** |
| 「添加实拍」`<input type="file" accept="image/*" capture="environment">`，选中切 `compare`，可移除 | **B6**（`fileRef` + `handlePhotoChange` + `removePhoto`） |
| 三语文案预填（模板写在 i18n） | **B1**（`share.captionTemplate`）+ **B2**（`buildShareCaption`）+ **B6** |
| 移动端「系统分享」`navigator.share({files,text,url})`，不支持 files 时退化并提示 | **B5**（`shareViaSystem` 返回 `'text'`）+ **B6**（`share.toastShareFilesUnsupported`） |
| 桌面「复制图片」`ClipboardItem` + 「复制文案」 | **B5**（`copyImage` 先转 PNG、`copyText`）+ **B6** |
| X / Reddit / LINE 的 intent URL | **B2**（三个 builder）+ **B6**（三个 `<a>`） |
| 小红书 / 微信：保存图片 + 复制文案 + toast「打开 App 粘贴」 | **B6**（`handleAppFlow`） |
| 「保存图片」下载 JPEG | **B5**（`downloadBlob`）+ **B6** |
| 每个动作前先确保短链已创建，附 `?c=` | **B6**（面板打开即 `createShareLink`；所有动作 `disabled` 到 `shareUrl` 就绪）+ **B2**（`withShareChannel`） |
| 新增 `share.*` 到三语 locale 文件 | **B1** |
| 删除 `CheckInCard.tsx`、`DetailPanel.tsx:192`、`MapDialogs.tsx` 里的硬编码中文；`shared.ts` 现有 `share*` 四条保留 | **B7**（DetailPanel 那处）+ **B8**（CheckInCard 与 MapDialogs 装配）；`shared.ts` 全程不改 |

## §三 短链与预览图

| spec 条目 | 覆盖 Task |
| --- | --- |
| `ShareLink` model（含 `@@unique`/三个 `@@index`）与 `2026MMDD000000_` 迁移目录 | **A5** |
| `POST /api/share/links`，匿名可调，返回 `{code,url}` | **A9** |
| 24 小时内同 `pointId+locale+layout+userId` 复用旧记录 | **A9**（`findRecentDuplicate`）+ **A6**（repo 语义与测试） |
| 匿名按 `ipHash` ≤ 100/24h，登录用户按 `userId` ≤ 30 次上传/24h，计数直接数 `ShareLink` 表 | **A4**（`hashIp`）+ **A9**（`ANON_DAILY_LINK_LIMIT`）+ **A10**（`USER_DAILY_UPLOAD_LIMIT`） |
| 短码 8 位 base62、`crypto.getRandomValues`、冲突重试 3 次 | **A2** |
| `POST /api/share/links/[code]/upload` 须登录，且 `userId` 为空或等于当前用户 | **A10**（401 / 403 两条分支） |
| `card` 校验：JPEG/WebP、≤1.5 MB、像素必须 1080×1440 或 1200×630，读文件头 | **A3**（`parseJpegSize`/`parseWebpSize`/`isAllowedShareCardSize`）+ **A10** |
| 卡片写 `ASSET_STORE` 的 `share/<code>.<jpg\|webp>`，更新 `imageKey` 与 `userId` | **A7**（`shareCardKey`）+ **A10** |
| `photo` ≤5 MB，写 `checkin/<userId>/<pointId>.jpg`，回写 `photoUrl` 与 `state='checked_in'` | **A7**（`checkinPhotoKey`）+ **A10**（`pointStateRepo.upsert`） |
| `GET /api/share/img/[code]` 从 `ASSET_STORE` 读，一年不可变缓存，不存在 404 | **A11** |
| `app/s/[code]/page.tsx` 的 `generateMetadata`：三语标题、描述、OG/twitter images、`noindex,follow` | **A12**（文案纯函数）+ **A13**（metadata 组装与四条测试） |
| `imageKey` 存在用 `/api/share/img/<code>` 绝对 URL，否则点位截图的 R2 公共域 URL | **A13**（两条测试分别覆盖） |
| 页面体 `<meta http-equiv="refresh">` + JS 跳转，目标带 locale 前缀与三个 utm 参数 | **A12**（`buildShareRedirectTarget`）+ **A13**（页面体） |
| `c → utm_medium` 八项映射 | **A1**（`SHARE_CHANNEL_UTM_MEDIUM`）+ **A12** |
| 每次访问 `clicks + 1`，fire-and-forget 走 `ctx.waitUntil` | **A8**（`runShareBackground`）+ **A13** |

## §四 顺手修掉的旧问题

| spec 条目 | 覆盖 Task |
| --- | --- |
| `buildMapShareImageUrl` 改为返回点位截图的 R2 公共域 URL | **A14** |
| `p` 缺失时返回作品封面 R2 URL；都缺时返回 `/opengraph-image` | **A14**（三条回退测试） |
| 删除 `app/api/anitabi/share-image/route.tsx`，`@vercel/og` 移出依赖 | **A14** Step 3c |
| ja/en 的 posts / anime / city 六个页面补 `openGraph.images` 与 `twitter.images` | **A15** |

## §五 验收

| spec 条目 | 覆盖 Task |
| --- | --- |
| 单测：短码生成与冲突重试 | **A2** |
| 单测：上传校验（类型、大小、尺寸） | **A3** + **A10** |
| 单测：`/s/[code]` 的 `generateMetadata` 有无 `imageKey` 两种 image URL | **A13** |
| 单测：`buildMapShareImageUrl` 三种回退 | **A14** |
| 组件测试：`PointSharePanel` 三语文案渲染 | **B6**（`it.each(['zh','en','ja'])`） |
| 组件测试：平台按钮 URL 编码正确 | **B2**（builder 层）+ **B6**（面板层 href 断言） |
| 浏览器冒烟：`/map?b=&p=` → 分享 → 切版式 → 保存得到 1080×1440 JPEG | **B9** Step 3 |
| 手工：X Card Validator 与 LINE 预览 | 部署后手工，见「部署与迁移」第 3 条 |
| 部署后 GA 看 `utm_source=share` 分渠道 | 由 `buildShareRedirectTarget`（**A12**）保证参数写对；观察本身是运营动作 |
