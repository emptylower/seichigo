# 分享卡片服务端渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把分享卡片从浏览器 canvas 绘制改成服务端 HTML → Cloudflare Browser Run 截图 → R2 缓存，让匿名分享的链接预览也有完整卡片，并把面板预览换成同一张图。

**Architecture:** 新增一条 `GET /api/share/card/[pointId]` 路由：读点位上下文（复用 pointContext 的内部函数，不走 HTTP）、把动画截图与实拍内联成 base64、用纯函数 `buildCardHtml` 生成一份 1200×630 / 1080×1440 的 HTML，POST 给 Cloudflare Browser Run 的 `screenshot` 接口拿回 WebP，落 R2 `og-cards/` 前缀长期缓存。短链页的 `og:image` 在没有用户上传卡片时指向这条路由；分享面板不再画 canvas，改成 `<img src="/api/share/card/...">` 并从同一个 URL 取 blob 做保存/复制/系统分享。二维码目标从短链改成稳定的点位深链，使卡片成为 `(pointId, locale, layout, photo?)` 的纯函数从而可长期缓存。

**Tech Stack:** Next.js 15 App Router（`runtime = 'nodejs'`、`dynamic = 'force-dynamic'`）、Prisma + Neon、Cloudflare Workers via opennextjs-cloudflare、R2 绑定 `ASSET_STORE`（桶 `seichigo-assets`）、Cloudflare Browser Run REST `screenshot`、`qrcode@1.5.4`（只深引 `lib/core/qrcode.js` 与 `lib/renderer/svg-tag.js` 两个纯模块）、vitest（`node` + `jsdom` 双 project）。

---

## File Structure

两条 Track 的文件集合严格不相交。共享契约只有一个：`lib/share/types.ts` 里的 `buildCardImagePath(pointId, locale, layout, photoKey?)`，由 Track A 在 Task A1 先建，Track B 只 import、不改该文件。

### Track A（后端）

| 动作 | 文件 | 职责 |
|---|---|---|
| Modify | `lib/share/types.ts` | 新增 `buildCardImagePath`（共享契约）；`ShareUploadResponse` 的 `imageUrl` 改可空并新增 `photoKey` |
| Create | `lib/share/japanPath.ts` | 日本轮廓的等距圆柱投影（从 `components/share/japanLocator.ts` 搬到服务端纯函数）+ SVG `path` 的 `d` 串生成 |
| Create | `types/qrcode-internals.d.ts` | `qrcode/lib/core/qrcode.js` 与 `qrcode/lib/renderer/svg-tag.js` 两个深引模块的环境声明 |
| Create | `lib/share/qrSvg.ts` | 服务端二维码 SVG 生成（不经 `qrcode` 的 server 入口，避免把 `pngjs`/`fs` 拖进 Worker 包） |
| Create | `lib/share/cardHtml.ts` | 唯一渲染源：`formatSceneTime` + `buildCardHtml`，输出完整 HTML 文档 |
| Create | `lib/share/browserRun.ts` | Browser Run `screenshot` 接口封装：读密钥、POST、20 秒超时、失败返回 null |
| Create | `lib/share/cardBudget.ts` | 匿名日限流（isolate 内计数）+ 全局每日渲染预算（R2 日计数对象） |
| Modify | `lib/share/pointContextRepo.ts` | `PointContextRow` 增 `bangumiId` / `ep` / `scene` / `image` 四个字段 |
| Modify | `lib/share/pointContextRepoPrisma.ts` | `findPoint` 的 `select` 与返回体补齐这四个字段 |
| Modify | `lib/share/handlers/pointContext.ts` | 抽出内部纯逻辑 `loadPointContext(deps, pointId, locale)`，HTTP handler 与卡片 handler 共用；对外行为不变 |
| Create | `lib/share/handlers/card.ts` | 卡片路由 handler + `renderAndStoreCard`（预热复用同一函数） |
| Create | `lib/share/cardApi.ts` | 卡片 handler 的生产依赖装配（Prisma repo、R2 store、Browser Run、镜像公共域） |
| Create | `app/api/share/card/[pointId]/route.ts` | `GET /api/share/card/[pointId]` 路由壳 |
| Modify | `lib/share/view.ts` | 新增 `buildCardQrTarget`（二维码目标深链）与 `buildShareOgImageUrl`（短链页 OG 选路） |
| Modify | `lib/share/api.ts` | `ShareApiDeps` 增可选 `prewarmCard`，生产装配里懒引 `cardApi` |
| Modify | `lib/share/handlers/links.ts` | 建链成功后 `runShareBackground` 预热两种版式 |
| Modify | `lib/share/handlers/upload.ts` | `card` 字段改可选；photo-only 上传也计配额；响应带 `photoKey` |
| Modify | `lib/share/repo.ts` | `markUploaded` 的 `imageKey` 改 `string \| null`（photo-only 只自增 `uploadCount`） |
| Modify | `lib/share/repoMemory.ts` | 同上 |
| Modify | `lib/share/repoPrisma.ts` | 同上 |
| Modify | `app/s/[code]/page.tsx` | OG 图改调 `buildShareOgImageUrl`；不再为 OG 调 `resolveMirrorPublicUrl` |
| Create | `tests/share/japanPath.test.ts` | 投影与路径串单测 |
| Create | `tests/share/qrSvg.test.ts` | 二维码 SVG 单测 |
| Create | `tests/share/cardHtml.test.ts` | 三语 × 两版式 × 有无地址/说明/坐标/实拍的输出片段与占位符单测 |
| Create | `tests/share/browserRun.test.ts` | 请求形状、非 2xx、JSON 错误体、超时单测 |
| Create | `tests/share/cardBudget.test.ts` | 限流与日预算单测 |
| Create | `tests/share/card.test.ts` | 卡片 handler 的命中/未命中/兜底/限流/预算耗尽单测 |
| Modify | `tests/share/types.test.ts` | `buildCardImagePath` 单测 |
| Modify | `tests/share/view.test.ts` | `buildCardQrTarget` / `buildShareOgImageUrl` 单测 |
| Modify | `tests/share/pointContext.test.ts` | 夹具补四个新字段；`loadPointContext` 不改 HTTP 行为的回归 |
| Modify | `tests/share/pointContextRepoMemory.test.ts` | 夹具补四个新字段 |
| Modify | `tests/share/links.test.ts` | 建链成功触发预热的单测 |
| Modify | `tests/share/upload.test.ts` | `card` 可选后的用例调整 |

### Track B（前端）

| 动作 | 文件 | 职责 |
|---|---|---|
| Modify | `lib/i18n/locales/zh.json` | `share.addPhotoLoginRequired` |
| Modify | `lib/i18n/locales/en.json` | 同上 |
| Modify | `lib/i18n/locales/ja.json` | 同上 |
| Modify | `tests/i18n/shareKeys.test.ts` | 登记新键 |
| Modify | `components/share/shareClient.ts` | 新增 `fetchCardBlob` / `uploadSharePhoto`；`uploadShareAssets` 下线 |
| Modify | `components/share/shareText.ts` | `buildCardFilename` 加可选 contentType（服务端卡片是 WebP） |
| Modify | `components/share/PointSharePanel.tsx` | 预览改服务端图、版式切换重取图、实拍改登录门 |
| Modify | `tests/components/shareClient.test.tsx` | 新函数单测 |
| Modify | `tests/components/shareText.test.ts` | 文件名扩展名单测 |
| Modify | `tests/components/pointSharePanel.test.tsx` | 按新面板重写 |
| Modify | `tests/components/pointSharePanelCaption.test.tsx` | 去掉画布桩 |
| Delete | `components/share/PointShareCard.tsx` | canvas 渲染器，整体下线 |
| Delete | `components/share/pointShareCardDraw.ts` | canvas 几何计算，整体下线 |
| Delete | `components/share/japanLocator.ts` | canvas 轮廓绘制，整体下线（投影逻辑已由 Track A 搬进 `lib/share/japanPath.ts`） |
| Delete | `tests/components/pointShareCard.test.tsx` | 随实现下线 |
| Delete | `tests/components/pointShareCardDraw.test.ts` | 随实现下线 |
| Delete | `tests/components/japanLocator.test.ts` | 随实现下线 |

### 不动的文件（已核对）

- `line-budget.allowlist.json`：`features/map/anitabi/useAnitabiMapController.ts`（883）在册，本计划不改它；`features/map/anitabi/MapDialogs.tsx` 不在册（当前 418 行，预算 750），本计划也不改它——`PointSharePanel` 的 props 形状完全不变（`features/map/anitabi/MapDialogs.tsx:316-327`）。
- `lib/share/imageMeta.ts` 与 `tests/share/imageMeta.test.ts`：`card` 仍可选传，尺寸/类型校验保留。
- `lib/share/handlers/media.ts`、`app/api/share/img/[code]/route.ts`、`app/api/share/photo/...`：`imageKey` 语义不变。
- `wrangler.jsonc`：`r2_buckets` 已有 `ASSET_STORE`（`seichigo-assets`），`vars` 已有 `NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE`。`BROWSER_RUN_TOKEN` / `CF_ACCOUNT_ID` 是 secret，不进 `vars`，无需改动。

### 本地开发如何注入密钥

`opennextjs-cloudflare` 与 `next dev` 都从 `process.env` 读取，`lib/billing/creem/client.ts:45` 是同一套路（`readCreemConfig(env = process.env)`）。所以在仓库根的 `.env.local` 里加两行（值从 1Password / Cloudflare 控制台取，**不要写进本计划或任何提交的文件**）：

```
BROWSER_RUN_TOKEN=<作用域仅 Browser Run Write 的 API Token>
CF_ACCOUNT_ID=<Cloudflare 账号 id>
```

生产已经 `wrangler secret put` 过这两个名字，无需再动。两者任一缺失时 `readBrowserRunConfig()` 返回 null，卡片路由直接走第 5 条兜底（302 到动画截图 / `/opengraph-image`），本地不配也不会 500。

---

## Track A — Task A1：`buildCardImagePath` 共享契约

**Files:**
- Modify: `lib/share/types.ts:65`（`ShareUploadResponse` 之后插入新函数）
- Test: `tests/share/types.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/share/types.test.ts` 末尾追加：

```ts
describe('buildCardImagePath', () => {
  it('拼出带 locale/layout 的卡片路径', () => {
    expect(buildCardImagePath('101:suga', 'zh', 'landscape')).toBe(
      '/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    )
  })

  it('pointId 里的冒号进 URL 要编码', () => {
    expect(buildCardImagePath('101:suga', 'ja', 'portrait')).toContain('/101%3Asuga?')
  })

  it('带实拍 key 时追加 photo 参数', () => {
    expect(buildCardImagePath('101:suga', 'en', 'portrait', 'checkin/u1/101:suga.jpg')).toBe(
      '/api/share/card/101%3Asuga?locale=en&layout=portrait&photo=checkin%2Fu1%2F101%3Asuga.jpg',
    )
  })

  it('photo 传空串或 null 时不出现 photo 参数', () => {
    expect(buildCardImagePath('p1', 'zh', 'landscape', '')).not.toContain('photo')
    expect(buildCardImagePath('p1', 'zh', 'landscape', null)).not.toContain('photo')
  })
})
```

并把 `buildCardImagePath` 加进该文件顶部从 `@/lib/share/types` 的 import 列表。

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/types.test.ts
```

预期：`SyntaxError` / `does not provide an export named 'buildCardImagePath'`——函数还不存在。

- [ ] **Step 3: 最小实现**

在 `lib/share/types.ts` 的 `ShareErrorResponse`（第 67 行）之前插入：

```ts
/**
 * 服务端卡片图的相对路径（Track A 与 Track B 的唯一共享契约）。
 * pointId 可能含冒号（`101:station`），进 URL 必须编码；photo 传的是
 * `checkin/<userId>/<pointId>.jpg` 形状的 R2 key，空值时整个参数不出现。
 */
export function buildCardImagePath(
  pointId: string,
  locale: SupportedLocale,
  layout: ShareCardLayout,
  photoKey?: string | null,
): string {
  const params = new URLSearchParams()
  params.set('locale', locale)
  params.set('layout', layout)
  const photo = String(photoKey || '').trim()
  if (photo) params.set('photo', photo)
  return `/api/share/card/${encodeURIComponent(pointId)}?${params.toString()}`
}
```

`SupportedLocale` 已在该文件第 2 行 import。

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/types.test.ts
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/types.ts tests/share/types.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 新增 buildCardImagePath 卡片图路径契约

服务端卡片路由的 URL 形状收口到 lib/share/types.ts，Track B 只 import。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A2：`lib/share/japanPath.ts` 服务端投影

**Files:**
- Create: `lib/share/japanPath.ts`
- Test: `tests/share/japanPath.test.ts`

投影算法照搬 `components/share/japanLocator.ts:35-56` 的 `buildProjection` / `project`（等距圆柱 + `cos(平均纬度)` 横向修正，等比缩放取两轴较小者、另一轴居中）。数据源 `lib/share/data/japan-outline.json`，形状 `{ bbox: [minLon, minLat, maxLon, maxLat], rings: [[lon, lat][]] }`（见 `lib/share/types.ts:99-104`）。

- [ ] **Step 1: 写失败测试**

新建 `tests/share/japanPath.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  buildJapanOutlinePath,
  buildJapanProjection,
  projectJapanLatLng,
} from '@/lib/share/japanPath'
import { JAPAN_BBOX } from '@/lib/share/types'

const BOX = { width: 180, height: 180 }

describe('buildJapanProjection / projectJapanLatLng', () => {
  it('bbox 四角都落在框内', () => {
    const [minLon, minLat, maxLon, maxLat] = JAPAN_BBOX
    for (const [lat, lng] of [
      [minLat, minLon],
      [minLat, maxLon],
      [maxLat, minLon],
      [maxLat, maxLon],
    ] as const) {
      const point = projectJapanLatLng(BOX, lat, lng)
      expect(point.x).toBeGreaterThanOrEqual(-0.001)
      expect(point.x).toBeLessThanOrEqual(BOX.width + 0.001)
      expect(point.y).toBeGreaterThanOrEqual(-0.001)
      expect(point.y).toBeLessThanOrEqual(BOX.height + 0.001)
    }
  })

  it('等比缩放：短边贴满，长边居中留白', () => {
    const [minLon, minLat, maxLon, maxLat] = JAPAN_BBOX
    const topLeft = projectJapanLatLng(BOX, maxLat, minLon)
    const bottomRight = projectJapanLatLng(BOX, minLat, maxLon)
    const usedWidth = bottomRight.x - topLeft.x
    const usedHeight = bottomRight.y - topLeft.y
    // 至少一个方向铺满整框（浮点容差 0.001）
    expect(
      Math.abs(usedWidth - BOX.width) < 0.001 || Math.abs(usedHeight - BOX.height) < 0.001,
    ).toBe(true)
    // 留白两侧对称
    expect(topLeft.x).toBeCloseTo(BOX.width - bottomRight.x, 6)
    expect(topLeft.y).toBeCloseTo(BOX.height - bottomRight.y, 6)
  })

  it('东京 / 京都 / 札幌的相对位置正确（东京在京都之东、札幌之南）', () => {
    const tokyo = projectJapanLatLng(BOX, 35.6895, 139.6917)
    const kyoto = projectJapanLatLng(BOX, 35.0116, 135.7681)
    const sapporo = projectJapanLatLng(BOX, 43.0618, 141.3545)
    expect(tokyo.x).toBeGreaterThan(kyoto.x)
    expect(tokyo.y).toBeGreaterThan(sapporo.y)
    for (const point of [tokyo, kyoto, sapporo]) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it('投影只依赖框尺寸，重复调用结果稳定', () => {
    const a = buildJapanProjection(BOX)
    const b = buildJapanProjection(BOX)
    expect(a).toEqual(b)
  })
})

describe('buildJapanOutlinePath', () => {
  const d = buildJapanOutlinePath(BOX)

  it('以 M 开头、以 Z 结尾，且没有 NaN', () => {
    expect(d.startsWith('M')).toBe(true)
    expect(d.trimEnd().endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })

  it('环数与数据一致（34 个子路径）', () => {
    expect(d.split('Z').filter((part) => part.trim()).length).toBe(34)
  })

  it('坐标保留两位小数，串长可控', () => {
    expect(d).not.toMatch(/\d\.\d{3,}/)
    expect(d.length).toBeGreaterThan(1000)
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/japanPath.test.ts
```

预期：`Failed to resolve import "@/lib/share/japanPath"`——文件还不存在。

- [ ] **Step 3: 最小实现**

新建 `lib/share/japanPath.ts`：

```ts
import japanOutlineJson from '@/lib/share/data/japan-outline.json'

/** 只要宽高：SVG 有自己的坐标系，原点固定在 (0,0) */
export type JapanBox = { width: number; height: number }

type JapanOutline = {
  bbox: readonly [number, number, number, number]
  rings: readonly (readonly (readonly [number, number])[])[]
}

const OUTLINE = japanOutlineJson as unknown as JapanOutline

export type JapanProjection = {
  originX: number
  originY: number
  scale: number
  lonScale: number
  minLon: number
  maxLat: number
}

/**
 * 等距圆柱投影 + cos(平均纬度) 横向修正，与下线前的
 * components/share/japanLocator.ts:35-48 逐行等价。
 * 这个尺度（一张 100-180px 的定位小图）用不着墨卡托：等距圆柱在单一 bbox 内
 * 的形变只体现在横向被拉宽，乘一个 cos(平均纬度) 就够了。
 * 等比缩放取两轴较小者，剩下的方向居中留白，保证四角都落在框内。
 */
export function buildJapanProjection(box: JapanBox): JapanProjection {
  const [minLon, minLat, maxLon, maxLat] = OUTLINE.bbox
  const lonScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanLon = Math.max(1e-9, (maxLon - minLon) * lonScale)
  const spanLat = Math.max(1e-9, maxLat - minLat)
  const scale = Math.min(box.width / spanLon, box.height / spanLat)
  return {
    originX: (box.width - spanLon * scale) / 2,
    originY: (box.height - spanLat * scale) / 2,
    scale,
    lonScale,
    minLon,
    maxLat,
  }
}

export function projectJapanPoint(
  projection: JapanProjection,
  lon: number,
  lat: number,
): { x: number; y: number } {
  return {
    x: projection.originX + (lon - projection.minLon) * projection.lonScale * projection.scale,
    y: projection.originY + (projection.maxLat - lat) * projection.scale,
  }
}

export function projectJapanLatLng(box: JapanBox, lat: number, lng: number): { x: number; y: number } {
  return projectJapanPoint(buildJapanProjection(box), lng, lat)
}

/**
 * 全部 34 个环拼成一条 SVG path 的 `d`：每个环 `M x y L … Z`。
 * 坐标保留 2 位小数——这个尺寸下肉眼看不出差别，串长能省一半多。
 */
export function buildJapanOutlinePath(box: JapanBox, precision = 2): string {
  const projection = buildJapanProjection(box)
  const round = (value: number) => Number(value.toFixed(precision))
  let d = ''
  for (const ring of OUTLINE.rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue
    let segment = ''
    for (let index = 0; index < ring.length; index++) {
      const pair = ring[index]!
      const point = projectJapanPoint(projection, pair[0]!, pair[1]!)
      segment += `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`
    }
    d += `${segment}Z`
  }
  return d
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/japanPath.test.ts
```

预期：全绿。若「环数 34」不符，按 `OUTLINE.rings.length` 的实际值修正断言（`lib/share/types.ts:96-97` 的注释记为 34 环 1097 点）。

- [ ] **Step 5: commit**

```
git add lib/share/japanPath.ts tests/share/japanPath.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 日本轮廓投影搬到服务端纯函数 japanPath

等距圆柱 + cos(平均纬度) 修正与 japanLocator 逐行等价，输出 SVG path 的 d 串。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A3：`lib/share/qrSvg.ts` 服务端二维码

**Files:**
- Create: `types/qrcode-internals.d.ts`
- Create: `lib/share/qrSvg.ts`
- Test: `tests/share/qrSvg.test.ts`

`qrcode@1.5.4` 的 node 入口 `lib/index.js` → `lib/server.js` 会连带引入 `renderer/png.js`（`pngjs` + `zlib` + `stream`）与 `renderer/svg.js` 里的 `require('fs')`。卡片只要 SVG，所以直接深引两个纯模块：`lib/core/qrcode.js` 的 `create` 与 `lib/renderer/svg-tag.js` 的 `render`（已核对：`svg-tag.js` 只 `require('./utils')`，`render` 同步返回字符串）。`node_modules/qrcode/package.json` 没有 `exports` 字段，深引合法。

- [ ] **Step 1: 写失败测试**

新建 `tests/share/qrSvg.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildQrSvg } from '@/lib/share/qrSvg'

const URL = 'https://seichigo.com/map?b=101&p=101%3Asuga&utm_source=share'

describe('buildQrSvg', () => {
  const svg = buildQrSvg(URL)

  it('输出一个自带 viewBox 的 svg 元素', () => {
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox="0 0')
    expect(svg).toContain('</svg>')
  })

  it('margin 为 0：viewBox 边长等于模块数', () => {
    const match = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(match![2])
    // 版本 1 是 21，URL 这个长度至少要到版本 3（29）以上
    expect(Number(match![1])).toBeGreaterThanOrEqual(29)
  })

  it('没有固定 width/height，交给 CSS 撑满容器', () => {
    expect(svg).not.toContain('width="')
    expect(svg).not.toContain('height="')
  })

  it('用深色前景与白色背景', () => {
    expect(svg).toContain('#111827')
    expect(svg).toContain('#ffffff')
  })

  it('同一内容两次生成完全一致', () => {
    expect(buildQrSvg(URL)).toBe(svg)
  })

  it('空串返回空串，不抛', () => {
    expect(buildQrSvg('')).toBe('')
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/qrSvg.test.ts
```

预期：`Failed to resolve import "@/lib/share/qrSvg"`。

- [ ] **Step 3: 最小实现**

新建 `types/qrcode-internals.d.ts`（`tsconfig.app.json` 的 `include` 已含 `types/**/*.d.ts`）：

```ts
declare module 'qrcode/lib/core/qrcode.js' {
  export type QrData = {
    modules: { size: number; data: Uint8Array | number[] }
  }
  export function create(
    data: string,
    options?: { errorCorrectionLevel?: string; version?: number; maskPattern?: number },
  ): QrData
}

declare module 'qrcode/lib/renderer/svg-tag.js' {
  import type { QrData } from 'qrcode/lib/core/qrcode.js'
  export function render(
    qrData: QrData,
    options?: {
      margin?: number
      width?: number
      scale?: number
      color?: { dark?: string; light?: string }
    },
  ): string
}
```

新建 `lib/share/qrSvg.ts`：

```ts
import { create as createQrData } from 'qrcode/lib/core/qrcode.js'
import { render as renderQrSvgTag } from 'qrcode/lib/renderer/svg-tag.js'

/** 二维码前景/背景：与下线前 canvas 版一致 */
const QR_DARK = '#111827'
const QR_LIGHT = '#ffffff'

/**
 * 服务端二维码 SVG。刻意不走 `qrcode` 的 node 入口：那条路会连带引入
 * renderer/png.js（pngjs + zlib + stream）与 renderer/svg.js 里的 require('fs')，
 * 白白把包体积和 Node 兼容面拖进 Worker。这两个深引模块都是纯计算。
 * margin 为 0：白边由外层二维码白卡的 padding 提供。
 */
export function buildQrSvg(text: string): string {
  const value = String(text || '').trim()
  if (!value) return ''
  const data = createQrData(value, { errorCorrectionLevel: 'M' })
  return renderQrSvgTag(data, {
    margin: 0,
    color: { dark: QR_DARK, light: QR_LIGHT },
  }).trim()
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/qrSvg.test.ts && npx tsc -p tsconfig.app.json --noEmit
```

预期：单测全绿，`tsc` 无 `Cannot find module 'qrcode/lib/...'`。

- [ ] **Step 5: commit**

```
git add types/qrcode-internals.d.ts lib/share/qrSvg.ts tests/share/qrSvg.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 服务端二维码 SVG，绕开 qrcode 的 png/fs 入口

只深引 core/qrcode.js 与 renderer/svg-tag.js 两个纯模块，附环境声明。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A4：卡片版面常量与文本助手

**Files:**
- Create: `lib/share/cardHtml.ts`（本 Task 只落常量与三个纯助手，`buildCardHtml` 在 A5）
- Test: `tests/share/cardHtml.test.ts`（本 Task 只落助手部分）

版面数值全部来自当前线上「导航胶囊版」的 canvas 常量，逐项对照：
`components/share/pointShareCardDraw.ts:143-193`（`CAPSULE_METRICS`）、`:202-224`（`CARD_ROW_METRICS`）、`:267-270`（`CARD_FOOTER_SIZES`）、`:272-276`（`CARD_FOOTER_TAGLINE_SIZES`）、`:275-380`（`buildCardLayout` 的 padding 64 / 主视觉 640 / 横版 columnX 672、rightMargin 36、footerY = 630-14 / 竖版底边距 36、页脚间距 24）。

- [ ] **Step 1: 写失败测试**

新建 `tests/share/cardHtml.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { CARD_METRICS, buildAnimeMetaLine, escapeHtml, formatSceneTime } from '@/lib/share/cardHtml'
import { SHARE_CARD_SIZES } from '@/lib/share/types'

describe('formatSceneTime', () => {
  it('纯数字秒数格式化成 mm:ss / h:mm:ss', () => {
    expect(formatSceneTime('1194')).toBe('19:54')
    expect(formatSceneTime('65')).toBe('1:05')
    expect(formatSceneTime('3725')).toBe('1:02:05')
  })

  it('非纯数字原样返回', () => {
    expect(formatSceneTime('第3話 冒頭')).toBe('第3話 冒頭')
  })
})

describe('escapeHtml', () => {
  it('转义会破坏结构的五个字符', () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;',
    )
  })

  it('null / undefined 转成空串', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('buildAnimeMetaLine', () => {
  it('zh 用书名号、en 裸标题、ja 用双重角括号', () => {
    const base = { animeTitle: '你的名字。', episode: '1', scene: '1194' } as const
    expect(buildAnimeMetaLine({ ...base, locale: 'zh' })).toBe('《你的名字。》 · 第 1 集 · 19:54')
    expect(buildAnimeMetaLine({ ...base, locale: 'en' })).toBe('你的名字。 · EP 1 · 19:54')
    expect(buildAnimeMetaLine({ ...base, locale: 'ja' })).toBe('『你的名字。』 · 第1話 · 19:54')
  })

  it('缺段就少段，全缺返回空串', () => {
    expect(buildAnimeMetaLine({ locale: 'zh', animeTitle: '孤独摇滚', episode: null, scene: null })).toBe(
      '《孤独摇滚》',
    )
    expect(buildAnimeMetaLine({ locale: 'zh', animeTitle: '', episode: null, scene: null })).toBe('')
  })
})

describe('CARD_METRICS', () => {
  it('画布尺寸与 SHARE_CARD_SIZES 一致', () => {
    expect(CARD_METRICS.portrait.width).toBe(SHARE_CARD_SIZES.portrait.width)
    expect(CARD_METRICS.portrait.height).toBe(SHARE_CARD_SIZES.portrait.height)
    expect(CARD_METRICS.landscape.width).toBe(SHARE_CARD_SIZES.landscape.width)
    expect(CARD_METRICS.landscape.height).toBe(SHARE_CARD_SIZES.landscape.height)
  })

  it('沿用线上导航胶囊版的关键数值', () => {
    expect(CARD_METRICS.landscape.visual).toBe(640)
    expect(CARD_METRICS.landscape.columnLeft).toBe(32)
    expect(CARD_METRICS.landscape.outlineSize).toBe(100)
    expect(CARD_METRICS.landscape.qrSize).toBe(100)
    expect(CARD_METRICS.portrait.visual).toBe(640)
    expect(CARD_METRICS.portrait.padding).toBe(64)
    expect(CARD_METRICS.portrait.outlineSize).toBe(180)
    expect(CARD_METRICS.portrait.nameSize).toBe(60)
    expect(CARD_METRICS.portrait.nameLines).toBe(2)
    expect(CARD_METRICS.landscape.nameLines).toBe(1)
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/cardHtml.test.ts
```

预期：`Failed to resolve import "@/lib/share/cardHtml"`。

- [ ] **Step 3: 最小实现**

新建 `lib/share/cardHtml.ts`：

```ts
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CARD_SIZES, type ShareCardLayout } from '@/lib/share/types'

/**
 * 版面常量：由下线前的 canvas 常量一比一转成 CSS 用的数值。
 * 对照来源见 components/share/pointShareCardDraw.ts 的 CAPSULE_METRICS /
 * CARD_ROW_METRICS / CARD_FOOTER_SIZES / buildCardLayout。
 * 断行与省略号一律交给浏览器（flex + -webkit-line-clamp），不再手算几何。
 */
export type CardMetrics = {
  width: number
  height: number
  /** 主视觉：横版是左列宽度，竖版是顶部高度 */
  visual: number
  /** 右列（横版）/ 文字区（竖版）的左内边距 */
  columnLeft: number
  /** 右内边距 */
  columnRight: number
  /** 文字区上内边距 */
  columnTop: number
  /** 页脚下内边距 */
  columnBottom: number
  /** 竖版画布安全边距（左右同值），横版为 0（用 columnLeft/Right） */
  padding: number
  nameSize: number
  nameLines: number
  nameGap: number
  animeSize: number
  animeGap: number
  addressSize: number
  addressGap: number
  noteSize: number
  noteLines: number
  capsuleRadius: number
  capsulePadV: number
  capsulePadH: number
  capsuleGap: number
  outlineSize: number
  qrSize: number
  qrPad: number
  qrRadius: number
  titleSize: number
  coordSize: number
  subSize: number
  titleGap: number
  subGap: number
  /** 文字区与胶囊之间的最小间距 */
  capsuleTopGap: number
  footerSize: number
  taglineSize: number
  footerGap: number
}

export const CARD_METRICS: Readonly<Record<ShareCardLayout, CardMetrics>> = {
  portrait: {
    width: SHARE_CARD_SIZES.portrait.width,
    height: SHARE_CARD_SIZES.portrait.height,
    visual: 640,
    columnLeft: 64,
    columnRight: 64,
    columnTop: 36,
    columnBottom: 36,
    padding: 64,
    nameSize: 60,
    nameLines: 2,
    nameGap: 10,
    animeSize: 38,
    animeGap: 14,
    addressSize: 34,
    addressGap: 12,
    noteSize: 32,
    noteLines: 2,
    capsuleRadius: 24,
    capsulePadV: 24,
    capsulePadH: 28,
    capsuleGap: 24,
    outlineSize: 180,
    qrSize: 180,
    qrPad: 6,
    qrRadius: 12,
    titleSize: 34,
    coordSize: 28,
    subSize: 22,
    titleGap: 12,
    subGap: 10,
    capsuleTopGap: 24,
    footerSize: 30,
    taglineSize: 24,
    footerGap: 24,
  },
  landscape: {
    width: SHARE_CARD_SIZES.landscape.width,
    height: SHARE_CARD_SIZES.landscape.height,
    visual: 640,
    // 线上横版右列起点 x=672，主视觉宽 640 → 左内边距 32；右边距 36
    columnLeft: 32,
    columnRight: 36,
    columnTop: 34,
    columnBottom: 14,
    padding: 36,
    nameSize: 40,
    nameLines: 1,
    nameGap: 12,
    animeSize: 26,
    animeGap: 12,
    addressSize: 24,
    addressGap: 10,
    noteSize: 22,
    noteLines: 2,
    capsuleRadius: 16,
    capsulePadV: 14,
    capsulePadH: 16,
    capsuleGap: 14,
    outlineSize: 100,
    qrSize: 100,
    qrPad: 4,
    qrRadius: 8,
    titleSize: 22,
    coordSize: 19,
    subSize: 15,
    titleGap: 8,
    subGap: 6,
    capsuleTopGap: 16,
    footerSize: 20,
    taglineSize: 16,
    footerGap: 16,
  },
}

/** 会破坏 HTML 结构的五个字符；卡片文本全部来自数据库与用户上传，一律过这道 */
export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * anitabi 的 `s` 是场景出现的秒数；纯数字时格式化为 mm:ss（超过一小时为
 * h:mm:ss），否则原样返回。行为与下线前的
 * components/share/PointShareCard.tsx:209-218 完全一致。
 */
export function formatSceneTime(scene: string): string {
  const raw = String(scene).trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const total = Math.floor(Number(raw))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 作品行：《作品名》 · 第 N 集 · mm:ss，缺哪段就少哪段（同 PointShareCard.tsx:188-205） */
export function buildAnimeMetaLine(input: {
  locale: SupportedLocale
  animeTitle: string
  episode: string | null
  /** 已格式化好的场景时间；传原始秒数请先过 formatSceneTime */
  scene: string | null
}): string {
  const parts: string[] = []
  const title = String(input.animeTitle || '').trim()
  if (title) {
    parts.push(input.locale === 'en' ? title : input.locale === 'ja' ? `『${title}』` : `《${title}》`)
  }
  if (input.episode) {
    parts.push(
      input.locale === 'en'
        ? `EP ${input.episode}`
        : input.locale === 'ja'
          ? `第${input.episode}話`
          : `第 ${input.episode} 集`,
    )
  }
  if (input.scene) parts.push(input.scene)
  return parts.join(' · ')
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/cardHtml.test.ts
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/cardHtml.ts tests/share/cardHtml.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 卡片版面常量与文本助手（cardHtml 第一半）

canvas 几何常量一比一转成 CSS 数值，formatSceneTime / buildAnimeMetaLine 搬到服务端。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A5：`buildCardHtml` 唯一渲染源

**Files:**
- Modify: `lib/share/cardHtml.ts`（在 A4 的常量与助手之后追加类型与 `buildCardHtml`）
- Test: `tests/share/cardHtml.test.ts`（追加 `buildCardHtml` 的用例）

- [ ] **Step 1: 写失败测试**

在 `tests/share/cardHtml.test.ts` 顶部 import 追加 `buildCardHtml` 与 `type CardHtmlInput`，并在文件末尾追加：

```ts
const BASE: CardHtmlInput = {
  layout: 'landscape',
  locale: 'zh',
  displayName: '须贺神社',
  animeTitle: '你的名字。',
  episode: '1',
  scene: '19:54',
  address: '東京都 新宿区 须贺町',
  note: '男女主角重逢的阶梯',
  geo: [35.6895, 139.7],
  inJapan: true,
  animeImageDataUri: 'data:image/webp;base64,QUJD',
  photoDataUri: null,
  qrTargetUrl: 'https://seichigo.com/map?b=101&p=101%3Asuga',
  text: { qrTitle: '扫码获取点位导航', qrSub: '地图 · 交通 · 周边点位', tagline: '5 万+ 动画取景地' },
}

describe('buildCardHtml', () => {
  it('输出完整 HTML 文档，body 固定为该版式尺寸', () => {
    const html = buildCardHtml(BASE)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).toContain('width:1200px')
    expect(html).toContain('height:630px')
    expect(html).toContain('margin:0')
    expect(html).toContain('overflow:hidden')
  })

  it('竖版换成 1080×1440', () => {
    const html = buildCardHtml({ ...BASE, layout: 'portrait' })
    expect(html).toContain('width:1080px')
    expect(html).toContain('height:1440px')
  })

  it('用 Browser Run 自带的 CJK 字体栈', () => {
    expect(buildCardHtml(BASE)).toContain(
      '"Noto Sans CJK SC","Noto Sans CJK JP",system-ui,sans-serif',
    )
  })

  it('断行交给浏览器：点位名与说明用 -webkit-line-clamp', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('-webkit-line-clamp:1')
    expect(html).toContain('-webkit-line-clamp:2')
    const portrait = buildCardHtml({ ...BASE, layout: 'portrait' })
    expect(portrait).toContain('-webkit-line-clamp:2')
  })

  it('文字全部转义，不留未替换占位符', () => {
    const html = buildCardHtml({ ...BASE, displayName: '<script>x</script>' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x</script>')
    expect(html).not.toMatch(/\{\{|\}\}|__[A-Z_]+__/)
  })

  it('有动画截图时内联 base64，没有时用粉色渐变兜底', () => {
    expect(buildCardHtml(BASE)).toContain('src="data:image/webp;base64,QUJD"')
    const noImage = buildCardHtml({ ...BASE, animeImageDataUri: null })
    expect(noImage).not.toContain('data:image')
    expect(noImage).toContain('linear-gradient(135deg,#fce7f3,#fdf2f8)')
  })

  it('有实拍时切对比布局（两张图都出现）', () => {
    const html = buildCardHtml({ ...BASE, photoDataUri: 'data:image/jpeg;base64,WFla' })
    expect(html).toContain('data:image/webp;base64,QUJD')
    expect(html).toContain('data:image/jpeg;base64,WFla')
    expect(html).toContain('class="visual compare"')
  })

  it('无地址 / 无说明时对应的行整体不渲染', () => {
    const html = buildCardHtml({ ...BASE, address: null, note: null })
    expect(html).not.toContain('class="row address"')
    expect(html).not.toContain('class="row note"')
    expect(html).toContain('class="row name"')
  })

  it('inJapan 为 false 时不渲染轮廓', () => {
    const html = buildCardHtml({ ...BASE, inJapan: false, geo: [1.35, 103.8] })
    expect(html).not.toContain('class="locator"')
  })

  it('无坐标时不渲染坐标行，胶囊只剩两行', () => {
    const html = buildCardHtml({ ...BASE, geo: null, inJapan: false })
    expect(html).not.toContain('class="cap-coord"')
    expect(html).toContain('class="cap-title')
    expect(html).toContain('class="cap-sub')
  })

  it('有坐标时坐标行保留 4 位小数并用等宽字体', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('35.6895, 139.7000')
    expect(html).toContain('ui-monospace')
  })

  it('二维码内联成 SVG，且编码的是稳定深链而不是短链', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(html).not.toContain('/s/')
  })

  it('三语 × 两版式都能出图且都带页脚站点名', () => {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      for (const layout of ['portrait', 'landscape'] as const) {
        const html = buildCardHtml({ ...BASE, locale, layout })
        expect(html, `${locale}/${layout}`).toContain('seichigo.com')
        expect(html, `${locale}/${layout}`).toContain('5 万+ 动画取景地')
      }
    }
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/cardHtml.test.ts
```

预期：`does not provide an export named 'buildCardHtml'`（A4 的用例仍绿）。

- [ ] **Step 3: 最小实现**

在 `lib/share/cardHtml.ts` 顶部补两个 import：

```ts
import { buildJapanOutlinePath, projectJapanLatLng } from '@/lib/share/japanPath'
import { buildQrSvg } from '@/lib/share/qrSvg'
```

并在文件末尾追加：

```ts
export type CardHtmlInput = {
  layout: ShareCardLayout
  locale: SupportedLocale
  /** 已由 point-context 去掉作品名前缀的点位名 */
  displayName: string
  animeTitle: string
  episode: string | null
  /** 已格式化的 mm:ss */
  scene: string | null
  address: string | null
  note: string | null
  geo: [number, number] | null
  inJapan: boolean
  /** data:image/...;base64,... —— 渲染时不发外部请求，保证截图确定性 */
  animeImageDataUri: string | null
  /** 有值时切对比布局（横版左右、竖版上下） */
  photoDataUri: string | null
  qrTargetUrl: string
  text: { qrTitle: string; qrSub: string; tagline: string }
}

/** Browser Run 环境自带中日文字体，直接点名即可 */
const FONT_STACK = '"Noto Sans CJK SC","Noto Sans CJK JP",system-ui,sans-serif'
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const COLORS = {
  name: '#0f172a',
  anime: '#db2777',
  address: '#334155',
  note: '#64748b',
  capsuleBg: '#fdf2f8',
  capsuleBorder: '#fbcfe8',
  capsuleTitle: '#be185d',
  capsuleCoord: '#334155',
  capsuleSub: '#64748b',
  pin: '#ec4899',
  locatorFill: '#fbcfe8',
  locatorStroke: '#ec4899',
  locatorMarker: '#db2777',
  footer: '#64748b',
  tagline: '#94a3b8',
} as const

/** 坐标行：`纬度, 经度`，各保留 4 位小数（约 11m 精度） */
function formatGeoLine(geo: readonly [number, number]): string {
  return `${geo[0].toFixed(4)}, ${geo[1].toFixed(4)}`
}

/** 地址行前缀的矢量小图钉：圆头 + 下方三角 + 白色内点。不用 emoji，缺字体会掉豆腐块 */
function addressPinSvg(size: number): string {
  const w = size * 0.62
  return [
    `<svg class="pin" width="${w.toFixed(2)}" height="${size}" viewBox="0 0 20 32" aria-hidden="true">`,
    `<path d="M10 0C4.48 0 0 4.48 0 10c0 7.5 10 22 10 22s10-14.5 10-22C20 4.48 15.52 0 10 0z" fill="${COLORS.pin}"/>`,
    `<circle cx="10" cy="10" r="4" fill="#ffffff"/>`,
    '</svg>',
  ].join('')
}

/** 坐标行左侧 GPS 十字圆标：圆环 + 四向短线 */
function gpsIconSvg(size: number): string {
  return [
    `<svg class="gps" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`,
    `<g fill="none" stroke="${COLORS.pin}" stroke-width="2" stroke-linecap="round">`,
    '<circle cx="12" cy="12" r="7"/>',
    '<path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    '</g></svg>',
  ].join('')
}

function locatorSvg(metrics: CardMetrics, geo: readonly [number, number] | null): string {
  const size = metrics.outlineSize
  const box = { width: size, height: size }
  const d = buildJapanOutlinePath(box)
  const strokeWidth = Math.max(1, size / 160)
  let marker = ''
  if (geo) {
    const point = projectJapanLatLng(box, geo[0], geo[1])
    const r = Math.max(3, size * 0.035)
    marker = `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${COLORS.locatorMarker}"/>`
  }
  return [
    `<svg class="locator" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`,
    `<path d="${d}" fill="${COLORS.locatorFill}" stroke="${COLORS.locatorStroke}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linejoin="round"/>`,
    marker,
    '</svg>',
  ].join('')
}

function visualSection(input: CardHtmlInput, metrics: CardMetrics): string {
  const shot = (uri: string) => `<img class="shot" src="${uri}" alt="">`
  if (input.photoDataUri && input.animeImageDataUri) {
    return `<div class="visual compare">${shot(input.animeImageDataUri)}${shot(input.photoDataUri)}</div>`
  }
  if (input.animeImageDataUri) return `<div class="visual">${shot(input.animeImageDataUri)}</div>`
  if (input.photoDataUri) return `<div class="visual">${shot(input.photoDataUri)}</div>`
  void metrics
  return '<div class="visual empty"></div>'
}

function textRows(input: CardHtmlInput, metrics: CardMetrics): string {
  const rows: string[] = []
  const name = String(input.displayName || '').trim()
  if (name) {
    rows.push(`<div class="row name clamp-name">${escapeHtml(name)}</div>`)
  }
  const anime = buildAnimeMetaLine({
    locale: input.locale,
    animeTitle: input.animeTitle,
    episode: input.episode,
    scene: input.scene,
  })
  if (anime) rows.push(`<div class="row anime clamp1">${escapeHtml(anime)}</div>`)
  const address = String(input.address || '').trim()
  if (address) {
    rows.push(
      `<div class="row address">${addressPinSvg(metrics.addressSize)}<span class="clamp1">${escapeHtml(address)}</span></div>`,
    )
  }
  const note = String(input.note || '').trim()
  if (note) rows.push(`<div class="row note clamp2">${escapeHtml(note)}</div>`)
  return rows.join('')
}

function capsuleSection(input: CardHtmlInput, metrics: CardMetrics): string {
  const locator = input.inJapan ? locatorSvg(metrics, input.geo) : ''
  const coord = input.geo
    ? `<div class="cap-coord">${gpsIconSvg(metrics.coordSize)}<span>${escapeHtml(formatGeoLine(input.geo))}</span></div>`
    : ''
  const qr = buildQrSvg(input.qrTargetUrl)
  return [
    '<div class="capsule">',
    locator,
    '<div class="middle">',
    `<div class="cap-title clamp1">${escapeHtml(input.text.qrTitle)}</div>`,
    coord,
    `<div class="cap-sub clamp1">${escapeHtml(input.text.qrSub)}</div>`,
    '</div>',
    `<div class="qr">${qr}</div>`,
    '</div>',
  ].join('')
}

function styles(input: CardHtmlInput, metrics: CardMetrics): string {
  const isPortrait = input.layout === 'portrait'
  // 无坐标行时副标题接在标题后面，用标题后的间距
  const subGap = input.geo ? metrics.subGap : metrics.titleGap
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0;overflow:hidden}
body{width:${metrics.width}px;height:${metrics.height}px;background:#ffffff;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased}
.card{width:${metrics.width}px;height:${metrics.height}px;display:flex;flex-direction:${isPortrait ? 'column' : 'row'};background:#ffffff}
.visual{flex:none;${isPortrait ? `width:${metrics.width}px;height:${metrics.visual}px` : `width:${metrics.visual}px;height:${metrics.height}px`};display:flex;flex-direction:${isPortrait ? 'column' : 'row'};overflow:hidden}
.visual.empty{background:linear-gradient(135deg,#fce7f3,#fdf2f8)}
.visual .shot{width:100%;height:100%;object-fit:cover;display:block}
.visual.compare .shot{${isPortrait ? 'height:50%' : 'width:50%'}}
.column{flex:1;min-width:0;display:flex;flex-direction:column;padding:${metrics.columnTop}px ${metrics.columnRight}px ${metrics.columnBottom}px ${metrics.columnLeft}px}
.spacer{flex:1;min-height:${metrics.capsuleTopGap}px}
.clamp1,.clamp2,.clamp-name{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.clamp1{-webkit-line-clamp:1}
.clamp2{-webkit-line-clamp:2}
.clamp-name{-webkit-line-clamp:${metrics.nameLines}}
.row{word-break:break-word}
.row.name{font-size:${metrics.nameSize}px;line-height:1.25;font-weight:700;color:${COLORS.name};margin-bottom:${metrics.nameGap}px}
.row.anime{font-size:${metrics.animeSize}px;line-height:1.3;font-weight:600;color:${COLORS.anime};margin-bottom:${metrics.animeGap}px}
.row.address{display:flex;align-items:center;gap:${(metrics.addressSize * 0.28).toFixed(2)}px;font-size:${metrics.addressSize}px;line-height:1.3;font-weight:400;color:${COLORS.address};margin-bottom:${metrics.addressGap}px}
.row.address .pin{flex:none}
.row.address span{min-width:0}
.row.note{font-size:${metrics.noteSize}px;line-height:1.35;font-weight:400;color:${COLORS.note}}
.capsule{flex:none;display:flex;align-items:center;gap:${metrics.capsuleGap}px;background:${COLORS.capsuleBg};border:1px solid ${COLORS.capsuleBorder};border-radius:${metrics.capsuleRadius}px;padding:${metrics.capsulePadV}px ${metrics.capsulePadH}px}
.capsule .locator{flex:none;width:${metrics.outlineSize}px;height:${metrics.outlineSize}px}
.middle{flex:1;min-width:0}
.cap-title{font-size:${metrics.titleSize}px;line-height:1.2;font-weight:700;color:${COLORS.capsuleTitle}}
.cap-coord{display:flex;align-items:center;gap:${(metrics.coordSize * 0.3).toFixed(2)}px;font-size:${metrics.coordSize}px;line-height:1.2;color:${COLORS.capsuleCoord};font-family:${MONO_STACK};margin-top:${metrics.titleGap}px}
.cap-coord .gps{flex:none}
.cap-sub{font-size:${metrics.subSize}px;line-height:1.2;font-weight:400;color:${COLORS.capsuleSub};margin-top:${subGap}px}
.qr{flex:none;width:${metrics.qrSize}px;height:${metrics.qrSize}px;background:#ffffff;border:1px solid ${COLORS.capsuleBorder};border-radius:${metrics.qrRadius}px;padding:${metrics.qrPad}px}
.qr svg{width:100%;height:100%;display:block}
.footer{flex:none;display:flex;align-items:baseline;justify-content:space-between;margin-top:${metrics.footerGap}px;font-size:${metrics.footerSize}px;font-weight:500;color:${COLORS.footer}}
.tagline{font-size:${metrics.taglineSize}px;font-weight:400;color:${COLORS.tagline};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:16px}
`.trim()
}

/**
 * 卡片的唯一渲染源：输出一份自包含的 HTML 文档，交给 Browser Run 截图。
 * 图片一律内联 base64，渲染时不发任何外部请求，保证截图确定性。
 */
export function buildCardHtml(input: CardHtmlInput): string {
  const metrics = CARD_METRICS[input.layout]
  return [
    '<!DOCTYPE html>',
    '<html lang="' + escapeHtml(input.locale) + '"><head><meta charset="utf-8">',
    `<style>${styles(input, metrics)}</style>`,
    '</head><body><div class="card">',
    visualSection(input, metrics),
    '<div class="column">',
    `<div class="text">${textRows(input, metrics)}</div>`,
    '<div class="spacer"></div>',
    capsuleSection(input, metrics),
    `<div class="footer"><span>⛩ seichigo.com</span><span class="tagline">${escapeHtml(input.text.tagline)}</span></div>`,
    '</div></div></body></html>',
  ].join('')
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/cardHtml.test.ts
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/cardHtml.ts tests/share/cardHtml.test.ts
git commit -m "$(cat <<'EOF'
feat(share): buildCardHtml 服务端卡片渲染源

flex + -webkit-line-clamp 交给浏览器断行，图片内联 base64，轮廓与二维码内联 SVG。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A6：`lib/share/browserRun.ts` 截图接口封装

**Files:**
- Create: `lib/share/browserRun.ts`
- Test: `tests/share/browserRun.test.ts`

接口形状为 2026-09-08 实测确认：`POST https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-run/screenshot`，头 `Authorization: Bearer ${BROWSER_RUN_TOKEN}` 与 `Content-Type: application/json`，体 `{"html":"...","screenshotOptions":{"type":"webp","quality":85},"viewport":{"width":1200,"height":630}}`，成功返回图片二进制、失败返回 JSON `{"success":false,"errors":[...]}`。超时写法沿用 `lib/share/geocode.ts:94` 的 `AbortSignal.timeout`。

- [ ] **Step 1: 写失败测试**

新建 `tests/share/browserRun.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_RUN_TIMEOUT_MS,
  readBrowserRunConfig,
  renderHtmlToWebp,
} from '@/lib/share/browserRun'

const CONFIG = { accountId: 'acct123', token: 'tok456' }

function imageResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/webp' } })
}

describe('readBrowserRunConfig', () => {
  it('两个变量都在时返回配置', () => {
    expect(readBrowserRunConfig({ BROWSER_RUN_TOKEN: ' t ', CF_ACCOUNT_ID: ' a ' })).toEqual({
      token: 't',
      accountId: 'a',
    })
  })

  it('任一缺失返回 null', () => {
    expect(readBrowserRunConfig({ BROWSER_RUN_TOKEN: 't' })).toBeNull()
    expect(readBrowserRunConfig({ CF_ACCOUNT_ID: 'a' })).toBeNull()
    expect(readBrowserRunConfig({ BROWSER_RUN_TOKEN: '  ', CF_ACCOUNT_ID: 'a' })).toBeNull()
  })
})

describe('renderHtmlToWebp', () => {
  it('按实测形状发请求并返回字节', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchImpl = vi.fn(async () => imageResponse(bytes))
    const out = await renderHtmlToWebp({
      html: '<html></html>',
      width: 1200,
      height: 630,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out).toEqual(bytes)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/browser-run/screenshot')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok456')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      html: '<html></html>',
      screenshotOptions: { type: 'webp', quality: 85 },
      viewport: { width: 1200, height: 630 },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('非 2xx 返回 null', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }))
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('200 但返回 JSON 错误体也算失败', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, errors: [{ message: 'boom' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('空响应体算失败', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(new Uint8Array()))
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('抛错（超时/网络）返回 null 不外泄异常', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError')
    })
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('超时设成 20 秒', () => {
    expect(BROWSER_RUN_TIMEOUT_MS).toBe(20_000)
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/browserRun.test.ts
```

预期：`Failed to resolve import "@/lib/share/browserRun"`。

- [ ] **Step 3: 最小实现**

新建 `lib/share/browserRun.ts`：

```ts
export type BrowserRunConfig = { accountId: string; token: string }

/** 实测端到端 1.17-1.84 秒；20 秒是硬上限，超了直接走兜底 */
export const BROWSER_RUN_TIMEOUT_MS = 20_000

/**
 * 密钥读法与 lib/billing/creem/client.ts:45 一致：生产由 `wrangler secret put`
 * 注入（BROWSER_RUN_TOKEN / CF_ACCOUNT_ID），本地写 .env.local。
 * 任一缺失返回 null，调用方按「渲染不可用」走兜底，不报 500。
 */
export function readBrowserRunConfig(
  env: Record<string, string | undefined> = process.env,
): BrowserRunConfig | null {
  const token = String(env.BROWSER_RUN_TOKEN || '').trim()
  const accountId = String(env.CF_ACCOUNT_ID || '').trim()
  if (!token || !accountId) return null
  return { accountId, token }
}

/**
 * Cloudflare Browser Run 的 REST 截图接口：直接吃一段 HTML，返回图片二进制。
 * 失败时上游会以 200 + JSON `{success:false,errors:[...]}` 回应，所以只认
 * 非 JSON 的响应体；任何失败都返回 null，由调用方决定兜底。
 */
export async function renderHtmlToWebp(input: {
  html: string
  width: number
  height: number
  config: BrowserRunConfig
  fetchImpl?: typeof fetch
}): Promise<Uint8Array | null> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${input.config.accountId}/browser-run/screenshot`
  try {
    const doFetch = input.fetchImpl ?? fetch
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: input.html,
        screenshotOptions: { type: 'webp', quality: 85 },
        viewport: { width: input.width, height: input.height },
      }),
      signal: AbortSignal.timeout(BROWSER_RUN_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[share.browser_run.failed]', {
        event: 'share_browser_run_failed',
        status: res.status,
      })
      return null
    }
    if (String(res.headers.get('content-type') || '').includes('application/json')) {
      const text = await res.text()
      console.error('[share.browser_run.error_body]', {
        event: 'share_browser_run_error_body',
        body: text.slice(0, 200),
      })
      return null
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.byteLength > 0 ? bytes : null
  } catch (error) {
    console.error('[share.browser_run.threw]', {
      event: 'share_browser_run_threw',
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
    })
    return null
  }
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/browserRun.test.ts
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/browserRun.ts tests/share/browserRun.test.ts
git commit -m "$(cat <<'EOF'
feat(share): Browser Run 截图接口封装

20 秒超时、非 2xx 与 JSON 错误体都当失败返回 null，交调用方兜底。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A7：`lib/share/cardBudget.ts` 限流与日预算

**Files:**
- Create: `lib/share/cardBudget.ts`
- Test: `tests/share/cardBudget.test.ts`

两层护栏：
1. **匿名日限流 300 次/IP**：沿用 `lib/share/handlers/pointContext.ts:34-51` 的 isolate 内计数（wrangler 没有 KV 绑定；跨 isolate 会放大上限，但缓存命中不计入，滥用面被 R2 缓存钉死）。
2. **全局每日渲染预算 3000 次**：spec §3.7 给了两个选项，**这里选 R2 日计数对象**——isolate 内计数在多 isolate 下完全失效，而这条预算的意义是「防跑量」，必须跨 isolate。键 `og-cards/_budget/<UTC 日期>.json`，读-改-写；并发下会少计（两个请求读到同一个值），作为跑飞护栏可接受，且天然跨日过期不用清理任务。

- [ ] **Step 1: 写失败测试**

新建 `tests/share/cardBudget.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ANON_DAILY_CARD_LIMIT,
  DAILY_RENDER_BUDGET,
  bumpRenderBudget,
  cardBudgetKey,
  checkCardRate,
  readRenderBudget,
  resetCardRate,
} from '@/lib/share/cardBudget'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

function makeStore(seed?: Record<string, string>) {
  const objects = new Map<string, string>(Object.entries(seed ?? {}))
  const store: ShareStore = {
    async put(key, bytes) {
      objects.set(key, new TextDecoder().decode(bytes))
    },
    async get(key) {
      const found = objects.get(key)
      if (found === undefined) return null
      const bytes = new TextEncoder().encode(found)
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
        contentType: 'application/json',
        size: bytes.byteLength,
      }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

beforeEach(() => resetCardRate())

describe('checkCardRate', () => {
  it('同一 IP 当日放行到上限，之后拒绝', () => {
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) {
      expect(checkCardRate('ip-a', NOW), `第 ${i + 1} 次`).toBe(true)
    }
    expect(checkCardRate('ip-a', NOW)).toBe(false)
  })

  it('不同 IP 各算各的', () => {
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) checkCardRate('ip-a', NOW)
    expect(checkCardRate('ip-b', NOW)).toBe(true)
  })

  it('跨日重置', () => {
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) checkCardRate('ip-a', NOW)
    expect(checkCardRate('ip-a', new Date('2026-09-09T00:01:00Z'))).toBe(true)
  })
})

describe('cardBudgetKey', () => {
  it('按 UTC 日期分对象', () => {
    expect(cardBudgetKey(NOW)).toBe('og-cards/_budget/2026-09-08.json')
    expect(cardBudgetKey(new Date('2026-09-08T23:59:59Z'))).toBe('og-cards/_budget/2026-09-08.json')
  })
})

describe('readRenderBudget / bumpRenderBudget', () => {
  it('没有对象时读到 0', async () => {
    const { store } = makeStore()
    expect(await readRenderBudget(store, NOW)).toBe(0)
  })

  it('读得回已有计数', async () => {
    const { store } = makeStore({ 'og-cards/_budget/2026-09-08.json': '{"count":42}' })
    expect(await readRenderBudget(store, NOW)).toBe(42)
  })

  it('坏 JSON 当 0，不抛', async () => {
    const { store } = makeStore({ 'og-cards/_budget/2026-09-08.json': 'not json' })
    expect(await readRenderBudget(store, NOW)).toBe(0)
  })

  it('bump 写回 +1', async () => {
    const { store, objects } = makeStore()
    await bumpRenderBudget(store, NOW)
    await bumpRenderBudget(store, NOW)
    expect(objects.get('og-cards/_budget/2026-09-08.json')).toBe('{"count":2}')
  })

  it('预算常量为 3000', () => {
    expect(DAILY_RENDER_BUDGET).toBe(3000)
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/cardBudget.test.ts
```

预期：`Failed to resolve import "@/lib/share/cardBudget"`。

- [ ] **Step 3: 最小实现**

新建 `lib/share/cardBudget.ts`：

```ts
import { utcDateStamp } from '@/lib/share/ipHash'
import type { ShareStore } from '@/lib/share/store'

/** 匿名每 IP 每日 300 次卡片渲染请求；缓存命中不计入 */
export const ANON_DAILY_CARD_LIMIT = 300

/** 全局每日 Browser Run 渲染上限；套餐额度约 2.4 万次/月，这条只是防跑飞 */
export const DAILY_RENDER_BUDGET = 3000

type RateEntry = { day: string; count: number }
const rateCounters = new Map<string, RateEntry>()

/**
 * 与 lib/share/handlers/pointContext.ts:34-51 同一套 isolate 内计数：
 * wrangler 里没有 KV 绑定，这条路由也不落请求行，只能这么数。
 * 多 isolate 下实际上限会被放大，但只有缓存未命中才走到这里，
 * 而未命中一次就会写 R2 缓存，滥用面被缓存钉死。
 */
export function checkCardRate(ipHash: string, now: Date): boolean {
  const day = utcDateStamp(now)
  const entry = rateCounters.get(ipHash)
  if (!entry || entry.day !== day) {
    // 跨日顺手清理，防止长尾 IP 把 Map 无限撑大（同 pointContext）
    if (rateCounters.size > 5000) {
      for (const [key, value] of rateCounters) {
        if (value.day !== day) rateCounters.delete(key)
      }
    }
    rateCounters.set(ipHash, { day, count: 1 })
    return true
  }
  if (entry.count >= ANON_DAILY_CARD_LIMIT) return false
  entry.count += 1
  return true
}

/** 单测隔离用 */
export function resetCardRate(): void {
  rateCounters.clear()
}

/** 日计数对象：跨日自然过期，不需要清理任务 */
export function cardBudgetKey(now: Date): string {
  return `og-cards/_budget/${utcDateStamp(now)}.json`
}

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/**
 * 当日已渲染次数。选 R2 而不是 isolate 内计数：isolate 内计数在多 isolate 下
 * 完全失效，而这条是全局预算。读-改-写在并发下会少计（两个请求读到同一个值），
 * 作为「防跑飞」护栏可以接受——真正的成本上限由 Workers Paid 的浏览器时长兜底。
 */
export async function readRenderBudget(store: ShareStore, now: Date): Promise<number> {
  try {
    const object = await store.get(cardBudgetKey(now))
    if (!object) return 0
    const parsed = JSON.parse(await readAllText(object.body)) as { count?: unknown }
    const count = Number(parsed?.count)
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  } catch {
    return 0
  }
}

export async function bumpRenderBudget(store: ShareStore, now: Date): Promise<void> {
  const next = (await readRenderBudget(store, now)) + 1
  const bytes = new TextEncoder().encode(JSON.stringify({ count: next }))
  await store.put(cardBudgetKey(now), bytes, 'application/json')
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/cardBudget.test.ts
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/cardBudget.ts tests/share/cardBudget.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 卡片渲染的匿名限流与全局日预算

限流沿用 pointContext 的 isolate 计数；日预算落 R2 日计数对象以跨 isolate 生效。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A8：`PointContextRow` 补齐卡片需要的四个字段

**Files:**
- Modify: `lib/share/pointContextRepo.ts:8-38`（`PointContextRow` 增字段）
- Modify: `lib/share/pointContextRepoPrisma.ts:17-43`（`select`）与 `:61-78`（返回体）
- Test: `tests/share/pointContext.test.ts:16-27`（`ROW` 夹具）、`tests/share/pointContextRepoMemory.test.ts`（夹具）

卡片 handler 需要但 `PointContextResponse` 没有的四项：`bangumiId`（二维码深链的 `b` 参数）、`ep` / `s`（作品行的集数与场景秒数）、`image`（动画截图原始 URL）。`AnitabiPoint` 模型已有这四列（`prisma/schema.prisma:717,722,723,724`）。`/api/share/point-context` 的响应体一个字段都不加——spec 的非目标写死了「不改点位上下文接口的行为」。

- [ ] **Step 1: 写失败测试**

在 `tests/share/pointContext.test.ts` 的 `ROW` 夹具里加四项（保持其他断言不变）：

```ts
const ROW: PointContextRow = {
  pointId: '101:budo',
  bangumiId: 101,
  ep: '3',
  scene: '1194',
  image: 'https://image.anitabi.cn/points/101/budo.jpg',
  // …原有字段保持不动…
}
```

并在该文件末尾追加一条守住非目标的回归：

```ts
describe('point-context 响应体不因卡片改造而变宽', () => {
  it('只返回既有的六个字段', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const handler = createGetPointContextHandler({
      repo,
      geocode: async () => null,
      now: () => NOW,
    })
    const res = await handler(new Request('https://x/api/share/point-context?pointId=101:budo'))
    expect(Object.keys(await res.json()).sort()).toEqual(
      ['address', 'animeTitle', 'displayName', 'geo', 'inJapan', 'note'].sort(),
    )
  })
})
```

`tests/share/pointContextRepoMemory.test.ts` 里的行夹具同样补上这四项。

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/pointContext.test.ts tests/share/pointContextRepoMemory.test.ts
```

预期：`tsc` 层不报（vitest 不做类型检查），但 `npx tsc -p tsconfig.tests.json --noEmit` 会报 `Object literal may only specify known properties, and 'bangumiId' does not exist in type 'PointContextRow'`——先跑这条看它失败。

- [ ] **Step 3: 最小实现**

`lib/share/pointContextRepo.ts` 的 `PointContextRow` 里，`pointId` 之后插入：

```ts
  /** AnitabiPoint.bangumiId：二维码深链的 `b` 参数 */
  bangumiId: number
  /** AnitabiPoint.ep：作品行的集数 */
  ep: string | null
  /** AnitabiPoint.s：场景出现的秒数（未格式化） */
  scene: string | null
  /** AnitabiPoint.image：动画截图原始 URL（未归一） */
  image: string | null
```

`lib/share/pointContextRepoPrisma.ts` 的 `select` 里加四列：

```ts
        id: true,
        bangumiId: true,
        name: true,
        mark: true,
        ep: true,
        s: true,
        image: true,
        geoLat: true,
        geoLng: true,
```

返回体里加四项：

```ts
    return {
      pointId: row.id,
      bangumiId: row.bangumiId,
      ep: normalize(row.ep),
      scene: normalize(row.s),
      image: normalize(row.image),
      name: row.name,
      // …其余保持不动…
    }
```

- [ ] **Step 4: 跑通过**

```
npx tsc -p tsconfig.tests.json --noEmit && npx tsc -p tsconfig.app.json --noEmit && npx vitest run tests/share/pointContext.test.ts tests/share/pointContextRepoMemory.test.ts
```

预期：类型检查干净，单测全绿（含新加的「响应体不变宽」回归）。

- [ ] **Step 5: commit**

```
git add lib/share/pointContextRepo.ts lib/share/pointContextRepoPrisma.ts tests/share/pointContext.test.ts tests/share/pointContextRepoMemory.test.ts
git commit -m "$(cat <<'EOF'
feat(share): PointContextRow 补 bangumiId/ep/scene/image

卡片服务端渲染要用；/api/share/point-context 的响应体保持原样并加回归守住。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A9：抽出 `loadPointContext` 内部函数

**Files:**
- Modify: `lib/share/handlers/pointContext.ts:74-156`（把 handler 里的读取逻辑抽成可复用的纯 async 函数）
- Test: `tests/share/pointContext.test.ts`（追加 `loadPointContext` 的直调用例；原有 HTTP 用例一条不改，作为「行为不变」的证据）

卡片 handler 不能走 HTTP 打自己一次（spec §3.4：「复用 `lib/share/handlers/pointContext.ts` 的内部函数，不走 HTTP」）。这一 Task 只做提取，HTTP 行为逐字节不变。

- [ ] **Step 1: 写失败测试**

在 `tests/share/pointContext.test.ts` 末尾追加：

```ts
describe('loadPointContext（卡片 handler 复用的内部函数）', () => {
  it('返回卡片需要的全部字段，含 bangumiId/ep/scene/image', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const loaded = await loadPointContext(
      { repo, geocode: async () => null, now: () => NOW },
      '101:budo',
      'zh',
    )
    expect(loaded).toMatchObject({
      bangumiId: 101,
      episode: '3',
      scene: '1194',
      image: 'https://image.anitabi.cn/points/101/budo.jpg',
    })
    expect(typeof loaded!.displayName).toBe('string')
    expect(typeof loaded!.animeTitle).toBe('string')
  })

  it('点位不存在返回 null', async () => {
    const repo = new MemoryPointContextRepo([])
    expect(
      await loadPointContext({ repo, geocode: async () => null, now: () => NOW }, 'nope', 'zh'),
    ).toBeNull()
  })

  it('有坐标却拿不到地址时 addressPending 为 true', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const loaded = await loadPointContext(
      { repo, geocode: async () => null, now: () => NOW },
      '101:budo',
      'zh',
    )
    expect(loaded!.address).toBeNull()
    expect(loaded!.addressPending).toBe(true)
  })

  it('不做限流：限流只属于 HTTP 层', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const deps = { repo, geocode: async () => null, now: () => NOW }
    for (let i = 0; i < 400; i++) {
      expect(await loadPointContext(deps, '101:budo', 'zh')).not.toBeNull()
    }
  })
})
```

并把 `loadPointContext` 加进该文件对 `@/lib/share/handlers/pointContext` 的 import。

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/pointContext.test.ts
```

预期：`does not provide an export named 'loadPointContext'`。

- [ ] **Step 3: 最小实现**

在 `lib/share/handlers/pointContext.ts` 的 `createGetPointContextHandler` 之前插入：

```ts
/** 卡片渲染要用、但 PointContextResponse 里没有的那几项也一并带出来 */
export type LoadedPointContext = {
  bangumiId: number
  displayName: string
  animeTitle: string
  address: string | null
  geo: [number, number] | null
  note: string | null
  inJapan: boolean
  episode: string | null
  /** 未格式化的场景秒数；卡片侧用 formatSceneTime 转 mm:ss */
  scene: string | null
  /** 动画截图原始 URL（未归一） */
  image: string | null
  /** 有坐标却没拿到地址（上游未回 / 预算耗尽）：HTTP 层据此把公共缓存收到 5 分钟 */
  addressPending: boolean
}

/**
 * 点位上下文的读取与地理编码回填。HTTP handler 与卡片 handler 共用这一份，
 * 卡片路由据此不用打自己一次 HTTP。限流与响应头留在 HTTP 层，这里不做。
 */
export async function loadPointContext(
  deps: PointContextDeps,
  pointId: string,
  locale: SupportedLocale,
): Promise<LoadedPointContext | null> {
  const now = deps.now()
  // 点位与地址缓存并发读，串行会白等一个 RTT
  const [point, addressRow] = await Promise.all([
    deps.repo.findPoint(pointId, locale),
    deps.repo.findAddress(pointId),
  ])
  if (!point) return null

  const rawName = String(point.localizedName || point.name || '').trim()
  // animeTitle 兜底按 locale 定：localized i18n 标题 → bangumi 标题列（ja: jaRaw→original；
  // en: english→romaji；zh: zh）→ candidates[0]
  const localeFallback = point.localizedBangumiTitle
    ?? (locale === 'ja'
      ? point.bangumiTitles.jaRaw || point.bangumiTitles.original
      : locale === 'en'
        ? point.bangumiTitles.english || point.bangumiTitles.romaji
        : point.bangumiTitles.zh)
  const animeTitle = String(localeFallback || point.bangumiTitleCandidates[0] || '').trim()
  const candidates = [point.localizedBangumiTitle, ...point.bangumiTitleCandidates].filter(
    (value): value is string => Boolean(value && value.trim()),
  )
  const displayName = stripAnimeTitlePrefix(rawName, candidates)
  const note = String(point.localizedNote || point.mark || '').trim() || null
  const geo: [number, number] | null =
    point.geoLat != null && point.geoLng != null ? [point.geoLat, point.geoLng] : null
  const inJapan = geo ? isInJapan(geo[0], geo[1]) : false

  let address = pickAddress(addressRow, locale)
  if (!address && geo) {
    // 全局日预算：当日已回填的行数用完就不再打上游，address 留 null 按短缓存返回
    const utcDayStart = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000)
    const resolvedToday = await deps.repo.countResolvedSince(utcDayStart)
    if (resolvedToday < DAILY_GEOCODE_BUDGET) {
      const resolved = await deps.geocode({ lat: geo[0], lng: geo[1], includeCountry: !inJapan })
      // 三语全空说明上游没给出可用的行政区，不写缓存，下次还能再试
      if (resolved && (resolved.zh || resolved.en || resolved.ja)) {
        const row: PointAddressRow = {
          pointId,
          addressZh: resolved.zh,
          addressEn: resolved.en,
          addressJa: resolved.ja,
        }
        await deps.repo.saveAddress({ ...row, source: 'maptiler' }).catch((error: unknown) => {
          console.error('[share.point_context.cache_write_failed]', { pointId, error })
        })
        address = pickAddress(row, locale)
      }
    }
  }

  return {
    bangumiId: point.bangumiId,
    displayName,
    animeTitle,
    address,
    geo,
    note,
    inJapan,
    episode: point.ep,
    scene: point.scene,
    image: point.image,
    addressPending: Boolean(geo && !address),
  }
}
```

把 `createGetPointContextHandler` 里从 `// 点位与地址缓存并发读` 到 `const cacheControl = ...` 之间的整段（原第 93-151 行）替换成：

```ts
    const loaded = await loadPointContext(deps, pointId, locale)
    if (!loaded) return NextResponse.json({ error: '点位不存在' }, { status: 404 })

    const body: PointContextResponse = {
      address: loaded.address,
      geo: loaded.geo,
      note: loaded.note,
      inJapan: loaded.inJapan,
      displayName: loaded.displayName,
      animeTitle: loaded.animeTitle,
    }
    // 有坐标却没拿到地址（上游未回/预算耗尽）：可能是暂时性失败，公共缓存只敢放 5 分钟
    const cacheControl = loaded.addressPending ? 'public, max-age=300' : 'public, max-age=86400'
```

handler 里原来的 `const now = deps.now()` 保留（限流仍要用），`loadPointContext` 内部自己再取一次 `deps.now()`。

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/pointContext.test.ts && npx tsc -p tsconfig.app.json --noEmit
```

预期：原有 HTTP 用例（限流、404、地址回填、预算、缓存头）一条不改全绿，新增的 `loadPointContext` 用例也绿。

- [ ] **Step 5: commit**

```
git add lib/share/handlers/pointContext.ts tests/share/pointContext.test.ts
git commit -m "$(cat <<'EOF'
refactor(share): 抽出 loadPointContext 供卡片 handler 复用

HTTP 行为不变（原有用例一条未改）；限流与响应头仍留在 HTTP 层。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A10：`renderAndStoreCard` 渲染与落盘

**Files:**
- Create: `lib/share/handlers/card.ts`（本 Task 只落参数校验、缓存键、`renderAndStoreCard`）
- Test: `tests/share/card.test.ts`（本 Task 只落这部分）

- [ ] **Step 1: 写失败测试**

新建 `tests/share/card.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  cardCacheKey,
  isCheckinPhotoKey,
  normalizeCardLayout,
  normalizeCardLocale,
  renderAndStoreCard,
} from '@/lib/share/handlers/card'
import type { CardDeps } from '@/lib/share/handlers/card'
import { MemoryPointContextRepo } from '@/lib/share/pointContextRepoMemory'
import type { PointContextRow } from '@/lib/share/pointContextRepo'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

const ROW: PointContextRow = {
  pointId: '101:suga',
  bangumiId: 101,
  ep: '1',
  scene: '1194',
  image: 'https://image.anitabi.cn/points/101/suga.jpg',
  name: '《你的名字。》须贺神社',
  localizedName: null,
  mark: '男女主角重逢的阶梯',
  localizedNote: null,
  geoLat: 35.6895,
  geoLng: 139.7,
  localizedBangumiTitle: '你的名字。',
  bangumiTitleCandidates: ['你的名字。'],
  bangumiTitles: { zh: '你的名字。', jaRaw: null, original: null, romaji: null, english: null },
}

export function makeStore(seed?: Record<string, Uint8Array>) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  for (const [key, bytes] of Object.entries(seed ?? {})) {
    objects.set(key, { bytes, contentType: 'image/webp' })
  }
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(found.bytes)
            controller.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

export function makeDeps(overrides: Partial<CardDeps> = {}): CardDeps {
  const { store } = makeStore()
  return {
    repo: new MemoryPointContextRepo([ROW]),
    geocode: async () => null,
    getStore: () => store,
    renderCard: vi.fn(async () => new Uint8Array([0x52, 0x49, 0x46, 0x46])),
    resolveAnimeImageUrl: async () => 'https://img.seichigo.com/mirror/v1/x/y.jpg',
    fetchImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
    origin: 'https://seichigo.com',
    now: () => NOW,
    ...overrides,
  }
}

describe('参数归一', () => {
  it('locale 非法回落 zh，layout 非法回落 landscape', () => {
    expect(normalizeCardLocale('ja')).toBe('ja')
    expect(normalizeCardLocale('de')).toBe('zh')
    expect(normalizeCardLocale(null)).toBe('zh')
    expect(normalizeCardLayout('portrait')).toBe('portrait')
    expect(normalizeCardLayout('square')).toBe('landscape')
  })

  it('photo 只接受 checkin/<userId>/<pointId>.jpg 形状', () => {
    expect(isCheckinPhotoKey('checkin/u1/101:suga.jpg')).toBe(true)
    expect(isCheckinPhotoKey('share/AbC12xYz-deadbeef.webp')).toBe(false)
    expect(isCheckinPhotoKey('checkin/../../etc/passwd.jpg')).toBe(false)
    expect(isCheckinPhotoKey('checkin/u1/p.png')).toBe(false)
    expect(isCheckinPhotoKey('')).toBe(false)
  })
})

describe('cardCacheKey', () => {
  it('无实拍时按 pointId__locale__layout', async () => {
    expect(await cardCacheKey('101:suga', 'zh', 'landscape', null)).toBe(
      'og-cards/101:suga__zh__landscape.webp',
    )
  })

  it('带实拍时追加 photoKey 的 sha256 前 12 位', async () => {
    const key = await cardCacheKey('101:suga', 'ja', 'portrait', 'checkin/u1/101:suga.jpg')
    expect(key.startsWith('og-cards/101:suga__ja__portrait__')).toBe(true)
    expect(/__[0-9a-f]{12}\.webp$/.test(key)).toBe(true)
  })

  it('同一实拍 key 两次算出同一缓存键', async () => {
    const a = await cardCacheKey('p', 'zh', 'landscape', 'checkin/u1/p.jpg')
    const b = await cardCacheKey('p', 'zh', 'landscape', 'checkin/u1/p.jpg')
    expect(a).toBe(b)
  })
})

describe('renderAndStoreCard', () => {
  it('渲染成功后写进 R2 并返回字节', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store })
    const bytes = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(bytes).not.toBeNull()
    expect(objects.get('og-cards/101:suga__zh__landscape.webp')?.contentType).toBe('image/webp')
  })

  it('把动画截图内联成 base64 传给渲染器，HTML 里不留外链', async () => {
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const deps = makeDeps({ renderCard })
    await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    const html = renderCard.mock.calls[0]![0].html
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('https://img.seichigo.com')
  })

  it('取动画截图失败时用粉色渐变兜底，仍然出图', async () => {
    const deps = makeDeps({ fetchImage: async () => null })
    const bytes = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(bytes).not.toBeNull()
  })

  it('二维码编码的是稳定深链，不含短码', async () => {
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    await renderAndStoreCard(makeDeps({ renderCard }), {
      pointId: '101:suga',
      locale: 'ja',
      layout: 'portrait',
      photoKey: null,
    })
    // 深链本身只出现在二维码的模块里，这里断言 HTML 没有短链路径
    expect(renderCard.mock.calls[0]![0].html).not.toContain('/s/')
  })

  it('点位不存在返回 null 且不写 R2', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, repo: new MemoryPointContextRepo([]) })
    expect(
      await renderAndStoreCard(deps, {
        pointId: 'nope',
        locale: 'zh',
        layout: 'landscape',
        photoKey: null,
      }),
    ).toBeNull()
    expect(objects.size).toBe(0)
  })

  it('渲染器返回 null 时不写缓存', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, renderCard: async () => null })
    expect(
      await renderAndStoreCard(deps, {
        pointId: '101:suga',
        locale: 'zh',
        layout: 'landscape',
        photoKey: null,
      }),
    ).toBeNull()
    expect(objects.size).toBe(0)
  })

  it('带实拍时从 ASSET_STORE 读原图并内联', async () => {
    const photo = new Uint8Array([9, 9, 9])
    const { store } = makeStore({ 'checkin/u1/101:suga.jpg': photo })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    await renderAndStoreCard(makeDeps({ getStore: () => store, renderCard }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    expect(renderCard.mock.calls[0]![0].html).toContain('data:image/webp;base64,CQkJ')
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/card.test.ts
```

预期：`Failed to resolve import "@/lib/share/handlers/card"`。

- [ ] **Step 3: 最小实现**

新建 `lib/share/handlers/card.ts`：

```ts
import type { SupportedLocale } from '@/lib/i18n/types'
import { t } from '@/lib/i18n'
import { buildCardHtml, formatSceneTime } from '@/lib/share/cardHtml'
import type { PointContextDeps } from '@/lib/share/handlers/pointContext'
import { loadPointContext } from '@/lib/share/handlers/pointContext'
import type { ShareStore } from '@/lib/share/store'
import { SHARE_CARD_SIZES, isShareCardLayout, type ShareCardLayout } from '@/lib/share/types'
import { buildCardQrTarget } from '@/lib/share/view'

export type CardDeps = PointContextDeps & {
  /** 每次请求现取：R2 绑定挂在 per-request 的 cloudflare context 上 */
  getStore: () => ShareStore | null
  renderCard: (input: { html: string; width: number; height: number }) => Promise<Uint8Array | null>
  /** 动画截图原始 URL → R2 镜像公共域 URL（resolveMirrorPublicUrl） */
  resolveAnimeImageUrl: (rawUrl: string) => Promise<string | null>
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>
  /** 站点权威 origin，用来拼二维码深链 */
  origin: string
}

const LOCALES: readonly string[] = ['zh', 'en', 'ja']

export function normalizeCardLocale(value: string | null): SupportedLocale {
  const raw = String(value || '').trim()
  return LOCALES.includes(raw) ? (raw as SupportedLocale) : 'zh'
}

export function normalizeCardLayout(value: string | null): ShareCardLayout {
  const raw = String(value || '').trim()
  return isShareCardLayout(raw) ? raw : 'landscape'
}

/**
 * 只接受实拍 key 的形状（`checkin/<userId>/<pointId>.jpg`，见 lib/share/store.ts:34）。
 * 显式挡掉 `..`，防止把读取引到桶里其他对象。
 */
export function isCheckinPhotoKey(value: string): boolean {
  const key = String(value || '')
  if (!key || key.includes('..')) return false
  return /^checkin\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_:.-]{1,200}\.jpg$/.test(key)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** `og-cards/<pointId>__<locale>__<layout>[__<photoKey sha256 前 12>].webp` */
export async function cardCacheKey(
  pointId: string,
  locale: SupportedLocale,
  layout: ShareCardLayout,
  photoKey: string | null,
): Promise<string> {
  const base = `og-cards/${pointId}__${locale}__${layout}`
  if (!photoKey) return `${base}.webp`
  return `${base}__${(await sha256Hex(photoKey)).slice(0, 12)}.webp`
}

/** Worker 里没有 Buffer 保证，按 8KB 分块走 btoa */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function toDataUri(bytes: Uint8Array, contentType: string): string {
  const type = String(contentType || '').trim() || 'image/jpeg'
  return `data:${type};base64,${bytesToBase64(bytes)}`
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/**
 * 渲染一张卡片并写进 R2。返回字节；任何一环失败都返回 null 且不写缓存，
 * 由调用方走兜底（302 到动画截图 / /opengraph-image）。
 * 预热与请求路径共用这一个函数。
 */
export async function renderAndStoreCard(
  deps: CardDeps,
  input: {
    pointId: string
    locale: SupportedLocale
    layout: ShareCardLayout
    photoKey: string | null
  },
): Promise<Uint8Array | null> {
  const context = await loadPointContext(deps, input.pointId, input.locale)
  if (!context) return null

  const store = deps.getStore()

  const animeUrl = context.image ? await deps.resolveAnimeImageUrl(context.image) : null
  const animeImage = animeUrl ? await deps.fetchImage(animeUrl) : null
  const photoObject =
    input.photoKey && store ? await store.get(input.photoKey).catch(() => null) : null
  const photoBytes = photoObject ? await readAllBytes(photoObject.body) : null

  const size = SHARE_CARD_SIZES[input.layout]
  const html = buildCardHtml({
    layout: input.layout,
    locale: input.locale,
    displayName: context.displayName,
    animeTitle: context.animeTitle,
    episode: context.episode,
    scene: context.scene ? formatSceneTime(context.scene) : null,
    address: context.address,
    note: context.note,
    geo: context.geo,
    inJapan: context.inJapan,
    animeImageDataUri: animeImage ? toDataUri(animeImage.bytes, animeImage.contentType) : null,
    photoDataUri: photoBytes ? toDataUri(photoBytes, photoObject!.contentType) : null,
    qrTargetUrl: buildCardQrTarget({
      origin: deps.origin,
      locale: input.locale,
      bangumiId: context.bangumiId,
      pointId: input.pointId,
    }),
    text: {
      qrTitle: t('share.cardQrTitle', input.locale),
      qrSub: t('share.cardQrSub', input.locale),
      tagline: t('share.cardTagline', input.locale),
    },
  })

  const bytes = await deps.renderCard({ html, width: size.width, height: size.height })
  if (!bytes) return null

  if (store) {
    const key = await cardCacheKey(input.pointId, input.locale, input.layout, input.photoKey)
    await store.put(key, bytes, 'image/webp').catch((error: unknown) => {
      console.error('[share.card.cache_write_failed]', { key, error })
    })
  }
  return bytes
}
```

> **执行顺序**：`buildCardQrTarget` 由 Task A11 落到 `lib/share/view.ts`。A11 没有任何前置依赖，执行时**先跑 A11 再跑 A10**。

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/card.test.ts
```

预期：本 Task 的用例全绿。

- [ ] **Step 5: commit**

```
git add lib/share/handlers/card.ts tests/share/card.test.ts
git commit -m "$(cat <<'EOF'
feat(share): renderAndStoreCard 服务端卡片渲染与 R2 落盘

参数归一、photo key 形状校验、缓存键（带实拍时挂 sha256 前 12 位）、图片内联 base64。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A11：`buildCardQrTarget` 与 `buildShareOgImageUrl`

**Files:**
- Modify: `lib/share/view.ts:66`（文件末尾追加两个纯函数）
- Test: `tests/share/view.test.ts`

> 无前置依赖，**执行时排在 Task A10 之前**。

二维码从「编码短链」改成「编码稳定的点位深链」（spec §2）：每产生一个新短码就是一次缓存未命中，改完之后卡片才真正是 `(pointId, locale, layout, photo?)` 的函数。渠道归因不受影响——扫码本来就固定记 `image`（`lib/share/types.ts:33` 的 `save: 'image'`）。

- [ ] **Step 1: 写失败测试**

在 `tests/share/view.test.ts` 末尾追加：

```ts
describe('buildCardQrTarget', () => {
  const base = { origin: 'https://seichigo.com', bangumiId: 101, pointId: '101:suga' }

  it('zh 无语言前缀，utm_medium 固定 image', () => {
    expect(buildCardQrTarget({ ...base, locale: 'zh' })).toBe(
      'https://seichigo.com/map?b=101&p=101%3Asuga&utm_source=share&utm_medium=image&utm_campaign=point_card',
    )
  })

  it('en / ja 带语言前缀', () => {
    expect(buildCardQrTarget({ ...base, locale: 'en' })).toContain('https://seichigo.com/en/map?')
    expect(buildCardQrTarget({ ...base, locale: 'ja' })).toContain('https://seichigo.com/ja/map?')
  })

  it('不含短链路径：卡片可长期缓存的前提', () => {
    expect(buildCardQrTarget({ ...base, locale: 'zh' })).not.toContain('/s/')
  })
})

describe('buildShareOgImageUrl', () => {
  const base = {
    origin: 'https://seichigo.com',
    code: 'AbC12xYz',
    pointId: '101:suga',
    locale: 'zh' as const,
  }

  it('有 imageKey 时维持现状指向 /api/share/img/<code>，并带指纹', () => {
    expect(
      buildShareOgImageUrl({ ...base, imageKey: 'share/AbC12xYz-deadbeef.webp', fingerprint: 'deadbeef' }),
    ).toBe('https://seichigo.com/api/share/img/AbC12xYz?v=deadbeef')
  })

  it('旧格式（无指纹）不带 ?v=', () => {
    expect(buildShareOgImageUrl({ ...base, imageKey: 'share/AbC12xYz.jpg', fingerprint: null })).toBe(
      'https://seichigo.com/api/share/img/AbC12xYz',
    )
  })

  it('没有 imageKey 时指向卡片路由的横版', () => {
    expect(buildShareOgImageUrl({ ...base, imageKey: null, fingerprint: null })).toBe(
      'https://seichigo.com/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    )
  })

  it('匿名链的 locale 跟着短链走', () => {
    expect(
      buildShareOgImageUrl({ ...base, locale: 'ja', imageKey: null, fingerprint: null }),
    ).toContain('locale=ja')
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/view.test.ts
```

预期：`does not provide an export named 'buildCardQrTarget'`。

- [ ] **Step 3: 最小实现**

`lib/share/view.ts` 顶部 import 改为：

```ts
import type { SupportedLocale } from '@/lib/i18n/types'
import {
  SHARE_CHANNEL_UTM_MEDIUM,
  buildCardImagePath,
  isShareChannel,
} from '@/lib/share/types'
```

文件末尾追加：

```ts
/**
 * 二维码目标：稳定的点位深链，不是短链。
 * 短链每产生一个新短码就是一次卡片缓存未命中；改成深链之后卡片才是
 * (pointId, locale, layout, photo?) 的函数，可长期缓存。
 * 渠道归因不受影响——扫码本来就固定记 image（见 SHARE_CHANNEL_UTM_MEDIUM.save）。
 */
export function buildCardQrTarget(input: {
  origin: string
  locale: SupportedLocale
  bangumiId: number
  pointId: string
}): string {
  const prefix = input.locale === 'zh' ? '' : `/${input.locale}`
  const params = new URLSearchParams()
  params.set('b', String(input.bangumiId))
  params.set('p', input.pointId)
  params.set('utm_source', 'share')
  params.set('utm_medium', 'image')
  params.set('utm_campaign', 'point_card')
  return `${input.origin}${prefix}/map?${params.toString()}`
}

/**
 * 短链页的 OG 图选路：
 * - 该链接有 imageKey（登录用户上传过带实拍的卡）→ 维持现状指向 /api/share/img/<code>，
 *   靠 ?v=<指纹> 让换图后的 URL 变化，绕开爬虫侧旧缓存
 * - 否则 → 指向服务端卡片路由的横版；匿名分享从此也有完整卡片预览
 */
export function buildShareOgImageUrl(input: {
  origin: string
  code: string
  pointId: string
  locale: SupportedLocale
  imageKey: string | null
  fingerprint: string | null
}): string {
  if (input.imageKey) {
    const version = input.fingerprint ? `?v=${input.fingerprint}` : ''
    return `${input.origin}/api/share/img/${input.code}${version}`
  }
  return `${input.origin}${buildCardImagePath(input.pointId, input.locale, 'landscape')}`
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/view.test.ts
```

预期：全绿（原有 `buildShareTitle` / `buildShareDescription` / `buildShareRedirectTarget` 用例一条不改）。

- [ ] **Step 5: commit**

```
git add lib/share/view.ts tests/share/view.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 二维码改编码稳定深链，OG 图选路收口成纯函数

buildCardQrTarget 让卡片变成 (pointId,locale,layout,photo?) 的函数；
buildShareOgImageUrl 在无 imageKey 时指向服务端卡片路由。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A12：卡片 GET handler 的缓存、限流、预算与兜底

**Files:**
- Modify: `lib/share/handlers/card.ts`（追加 `createGetCardHandler`）
- Test: `tests/share/card.test.ts`（追加 handler 用例，复用本文件已导出的 `makeStore` / `makeDeps`）

- [ ] **Step 1: 写失败测试**

在 `tests/share/card.test.ts` 追加（并把 `createGetCardHandler` 加进 import）：

```ts
import { beforeEach } from 'vitest'
import { DAILY_RENDER_BUDGET, resetCardRate } from '@/lib/share/cardBudget'

function get(url: string, ip?: string): Request {
  return new Request(url, { headers: ip ? { 'cf-connecting-ip': ip } : undefined })
}

const CARD_URL = 'https://seichigo.com/api/share/card/101%3Asuga?locale=zh&layout=landscape'
const params = (pointId = '101:suga') => ({ params: Promise.resolve({ pointId }) })

beforeEach(() => resetCardRate())

describe('GET /api/share/card/[pointId]', () => {
  it('缓存命中直接回图，immutable，且不触发渲染', async () => {
    const { store } = makeStore({
      'og-cards/101:suga__zh__landscape.webp': new Uint8Array([1, 2, 3]),
    })
    const renderCard = vi.fn(async () => new Uint8Array([9]))
    const res = await createGetCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('未命中时渲染、写缓存并回图', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.webp')).toBe(true)
  })

  it('非法 pointId 直接 400', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/..%2F..%2Fetc'),
      params('../../etc'),
    )
    expect(res.status).toBe(400)
  })

  it('locale/layout 非法值回落 zh/landscape（不报错）', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get('https://seichigo.com/api/share/card/101%3Asuga?locale=de&layout=square'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.webp')).toBe(true)
  })

  it('photo 形状不对时当作没传（不 500、不越权读桶）', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(`${CARD_URL}&photo=share%2FAbC12xYz-deadbeef.webp`),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.webp')).toBe(true)
  })

  it('photo 不在桶里时也当作没传', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(`${CARD_URL}&photo=checkin%2Fu1%2F101%3Asuga.jpg`),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.webp')).toBe(true)
  })

  it('Browser Run 失败 → 302 到动画截图公共域，短缓存，不写缓存', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(
      makeDeps({ getStore: () => store, renderCard: async () => null }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://img.seichigo.com/mirror/v1/x/y.jpg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(objects.size).toBe(0)
  })

  it('连动画截图也没有 → 302 到 /opengraph-image', async () => {
    const res = await createGetCardHandler(
      makeDeps({ renderCard: async () => null, resolveAnimeImageUrl: async () => null }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://seichigo.com/opengraph-image')
  })

  it('点位不存在 → 404', async () => {
    const res = await createGetCardHandler(
      makeDeps({ repo: new MemoryPointContextRepo([]) }),
    )(get(CARD_URL), params())
    expect(res.status).toBe(404)
  })

  it('匿名超过日限流 → 429（缓存命中不计入）', async () => {
    const { store } = makeStore()
    const handler = createGetCardHandler(makeDeps({ getStore: () => store }))
    // 第一次未命中：渲染并写缓存，计 1 次
    expect((await handler(get(CARD_URL, '9.9.9.9'), params())).status).toBe(200)
    // 之后全部命中缓存，不该继续计数
    for (let i = 0; i < 500; i++) {
      expect((await handler(get(CARD_URL, '9.9.9.9'), params())).status).toBe(200)
    }
    // 换一个未命中的组合，仍在配额内
    expect(
      (await handler(get(`${CARD_URL.replace('layout=landscape', 'layout=portrait')}`, '9.9.9.9'), params()))
        .status,
    ).toBe(200)
  })

  it('日预算耗尽 → 走兜底且不渲染', async () => {
    const { store } = makeStore({
      'og-cards/_budget/2026-09-08.json': new TextEncoder().encode(
        JSON.stringify({ count: DAILY_RENDER_BUDGET }),
      ),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    expect(res.status).toBe(302)
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('渲染成功后日预算 +1', async () => {
    const { store, objects } = makeStore()
    await createGetCardHandler(makeDeps({ getStore: () => store }))(get(CARD_URL, '1.2.3.4'), params())
    const budget = objects.get('og-cards/_budget/2026-09-08.json')
    expect(new TextDecoder().decode(budget!.bytes)).toBe('{"count":1}')
  })

  it('拿不到 R2 绑定时仍能出图（不缓存）', async () => {
    const res = await createGetCardHandler(makeDeps({ getStore: () => null }))(
      get(CARD_URL),
      params(),
    )
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/card.test.ts
```

预期：`does not provide an export named 'createGetCardHandler'`。

- [ ] **Step 3: 最小实现**

在 `lib/share/handlers/card.ts` 顶部补 import：

```ts
import { NextResponse } from 'next/server'
import { DAILY_RENDER_BUDGET, bumpRenderBudget, checkCardRate, readRenderBudget } from '@/lib/share/cardBudget'
import { hashIp, readClientIp } from '@/lib/share/ipHash'
```

文件末尾追加：

```ts
// pointId 会进 R2 key 与 URL，字符集与 lib/share/handlers/links.ts:23 保持一致
const POINT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/

const IMMUTABLE = 'public, max-age=31536000, immutable'
/** 失败兜底不写缓存，公共缓存只敢放 60 秒 */
const FALLBACK_CACHE = 'public, max-age=60'

function imageResponse(body: BodyInit): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/webp',
      'cache-control': IMMUTABLE,
      'x-content-type-options': 'nosniff',
    },
  })
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': FALLBACK_CACHE },
  })
}

/**
 * 兜底：Browser Run 报错/超时/预算耗尽 → 302 到该点位的动画截图 R2 公共域 URL；
 * 都没有 → 302 到站点默认 OG。
 */
async function fallbackResponse(deps: CardDeps, image: string | null): Promise<Response> {
  const mirror = image ? await deps.resolveAnimeImageUrl(image) : null
  return redirect(mirror || `${deps.origin}/opengraph-image`)
}

export function createGetCardHandler(deps: CardDeps) {
  return async function getCard(
    req: Request,
    ctx: { params: Promise<{ pointId: string }> },
  ): Promise<Response> {
    const raw = await ctx.params
    const pointId = decodeURIComponent(String(raw.pointId || '')).trim()
    if (!POINT_ID_PATTERN.test(pointId) || pointId.includes('..')) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }

    const url = new URL(req.url)
    const locale = normalizeCardLocale(url.searchParams.get('locale'))
    const layout = normalizeCardLayout(url.searchParams.get('layout'))

    const store = deps.getStore()

    // photo 只接受实拍 key 的形状，且必须真的存在于 ASSET_STORE；不合格一律当没传
    const photoParam = String(url.searchParams.get('photo') || '').trim()
    let photoKey: string | null = null
    if (photoParam && isCheckinPhotoKey(photoParam) && store) {
      const exists = await store.get(photoParam).catch(() => null)
      if (exists) photoKey = photoParam
    }

    // 1) 缓存命中：直接回，且不计限流、不动预算
    if (store) {
      const key = await cardCacheKey(pointId, locale, layout, photoKey)
      const cached = await store.get(key).catch(() => null)
      if (cached) return imageResponse(cached.body)
    }

    const now = deps.now()

    // 2) 匿名限流（只有未命中才走到这）
    const ip = readClientIp(req)
    if (ip) {
      const ipHash = await hashIp(ip, now)
      if (!checkCardRate(ipHash, now)) {
        return NextResponse.json({ error: '今日请求次数已达上限，请明天再试' }, { status: 429 })
      }
    }

    // 3) 全局日预算：耗尽就不再渲染，直接兜底
    if (store && (await readRenderBudget(store, now)) >= DAILY_RENDER_BUDGET) {
      const context = await loadPointContext(deps, pointId, locale)
      if (!context) return NextResponse.json({ error: '点位不存在' }, { status: 404 })
      return fallbackResponse(deps, context.image)
    }

    const context = await loadPointContext(deps, pointId, locale)
    if (!context) return NextResponse.json({ error: '点位不存在' }, { status: 404 })

    const bytes = await renderAndStoreCard(deps, { pointId, locale, layout, photoKey })
    if (!bytes) return fallbackResponse(deps, context.image)

    if (store) {
      await bumpRenderBudget(store, now).catch((error: unknown) => {
        console.error('[share.card.budget_write_failed]', { error })
      })
    }
    return imageResponse(bytes)
  }
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/card.test.ts && npx tsc -p tsconfig.app.json --noEmit
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/handlers/card.ts tests/share/card.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 卡片 GET handler —— 缓存命中、限流、日预算与失败兜底

命中不计限流不动预算；渲染失败/预算耗尽 302 到动画截图或 /opengraph-image，短缓存 60 秒。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A13：卡片路由壳与生产依赖装配

**Files:**
- Create: `lib/share/cardApi.ts`
- Create: `app/api/share/card/[pointId]/route.ts`
- Test: 无新增单测（装配层与路由壳照 `lib/share/pointContextApi.ts` + `app/api/share/point-context/route.ts` 的既有形状写；由 Task A17 的本地 curl 验收覆盖）

- [ ] **Step 1: 写实现**

新建 `lib/share/cardApi.ts`：

```ts
import type { CardDeps } from '@/lib/share/handlers/card'

let cached: CardDeps | null = null

/** 抓上游图的超时：卡片本身有 20 秒预算，图不能占太多 */
const IMAGE_FETCH_TIMEOUT_MS = 6_000
/** 单张内联图上限 3MB：超了就当抓不到，走渐变兜底，别把 Browser Run 的请求体撑爆 */
const MAX_INLINE_IMAGE_BYTES = 3_000_000

/**
 * 卡片自带一套 deps（同 lib/share/pointContextApi.ts 的理由）：ShareApiDeps 被
 * v1 的四条路由与它们的单测共用，往里加必填字段会连带改动 v1 测试。
 */
export async function getCardDeps(): Promise<CardDeps> {
  if (cached) return cached

  const [
    { PrismaPointContextRepo },
    { fetchMapTilerAddresses },
    { getShareStore },
    { readBrowserRunConfig, renderHtmlToWebp },
    { resolveMirrorPublicUrl },
    { getSiteOrigin },
  ] = await Promise.all([
    import('@/lib/share/pointContextRepoPrisma'),
    import('@/lib/share/geocode'),
    import('@/lib/share/store'),
    import('@/lib/share/browserRun'),
    import('@/lib/anitabi/imageProxy'),
    import('@/lib/seo/site'),
  ])

  cached = {
    repo: new PrismaPointContextRepo(),
    geocode: (input) => fetchMapTilerAddresses(input),
    getStore: getShareStore,
    now: () => new Date(),
    origin: getSiteOrigin(),
    resolveAnimeImageUrl: (rawUrl) => resolveMirrorPublicUrl(rawUrl, { kind: 'point' }),
    async renderCard(input) {
      const config = readBrowserRunConfig()
      if (!config) {
        console.error('[share.card.no_browser_run_config]', {
          event: 'share_card_no_browser_run_config',
        })
        return null
      }
      return renderHtmlToWebp({ ...input, config })
    },
    async fetchImage(url) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
        if (!res.ok) return null
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (!bytes.byteLength || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) return null
        return {
          bytes,
          contentType: String(res.headers.get('content-type') || 'image/jpeg'),
        }
      } catch {
        return null
      }
    },
  }

  return cached
}
```

新建 `app/api/share/card/[pointId]/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { getCardDeps } from '@/lib/share/cardApi'
import { createGetCardHandler } from '@/lib/share/handlers/card'

export const runtime = 'nodejs'
// 限流要读 cf-connecting-ip，缓存与预算都要现取 R2 绑定，不能被静态化
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ pointId: string }> }) {
  try {
    const deps = await getCardDeps()
    return await createGetCardHandler(deps)(req, ctx)
  } catch (err) {
    console.error('[api/share/card] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
```

- [ ] **Step 2: 跑一次确认接得上**

```
npx tsc -p tsconfig.app.json --noEmit && npx vitest run tests/share
```

预期：类型干净、`tests/share` 全绿。

- [ ] **Step 3: 本地起服务打两次**

```
npm run dev -- -p 3457
# 另一个终端（把 <pointId> 换成本地库里真实存在的点位 id）
time curl -s -o /tmp/card1.webp -w '%{http_code} %{size_download}\n' \
  'http://localhost:3457/api/share/card/<pointId>?locale=zh&layout=landscape'
time curl -s -o /tmp/card2.webp -w '%{http_code} %{size_download}\n' \
  'http://localhost:3457/api/share/card/<pointId>?locale=zh&layout=landscape'
cmp /tmp/card1.webp /tmp/card2.webp && echo '两次字节一致'
```

预期：两次都 200；第二次显著更快（第一次含 1.2-1.8 秒 Browser Run，第二次只读 R2）；`cmp` 无输出。若 `.env.local` 没配密钥，两次都会是 302——那是预期兜底，不是失败。

用完按 pid 停 dev（不要按端口 kill；3001 是 claudecodeui）。

- [ ] **Step 4: commit**

```
git add lib/share/cardApi.ts app/api/share/card
git commit -m "$(cat <<'EOF'
feat(share): 卡片路由与生产依赖装配

GET /api/share/card/[pointId]；Browser Run 密钥缺失时整条路由降级为兜底 302。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A14：建链成功后预热两种版式

**Files:**
- Modify: `lib/share/api.ts:6-15`（`ShareApiDeps` 增可选 `prewarmCard`）与 `:31-38`（生产装配）
- Modify: `lib/share/handlers/links.ts:75-87`（`allocateShareCode` 之后）
- Test: `tests/share/links.test.ts`

用户点开分享面板时通常已经命中缓存。`waitUntil` 走 `lib/share/background.ts` 的 `runShareBackground`——它内部**以 ctx 为 this 调用** `ctx.waitUntil`，拆下来单独调用会抛 `Illegal invocation`（2026-09-08 资产迁 R2 上线实测，见 `lib/asset/handlers.ts:114-121` 的事故注释）。

- [ ] **Step 1: 写失败测试**

在 `tests/share/links.test.ts` 末尾追加：

```ts
describe('建链成功后预热卡片', () => {
  it('新建短链时预热当前语言的两种版式', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const prewarmCard = vi.fn(async () => undefined)
    const res = await createPostShareLinkHandler({ ...makeDeps({ repo, userId: 'u1' }), prewarmCard })(
      makeRequest({ pointId: '101:suga', bangumiId: 101, locale: 'ja', layout: 'portrait' }),
    )
    expect(res.status).toBe(201)
    expect(prewarmCard).toHaveBeenCalledTimes(1)
    expect(prewarmCard).toHaveBeenCalledWith({ pointId: '101:suga', locale: 'ja' })
  })

  it('预热抛错不影响建链结果', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const prewarmCard = vi.fn(async () => {
      throw new Error('boom')
    })
    const res = await createPostShareLinkHandler({ ...makeDeps({ repo, userId: 'u1' }), prewarmCard })(
      makeRequest({ pointId: '101:suga', bangumiId: 101, locale: 'zh', layout: 'portrait' }),
    )
    expect(res.status).toBe(201)
  })

  it('命中 24 小时去重（200）时不重复预热', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const prewarmCard = vi.fn(async () => undefined)
    const deps = { ...makeDeps({ repo, userId: 'u1' }), prewarmCard }
    const body = { pointId: '101:suga', bangumiId: 101, locale: 'zh' as const, layout: 'portrait' as const }
    expect((await createPostShareLinkHandler(deps)(makeRequest(body))).status).toBe(201)
    expect((await createPostShareLinkHandler(deps)(makeRequest(body))).status).toBe(200)
    expect(prewarmCard).toHaveBeenCalledTimes(1)
  })

  it('没有 prewarmCard 依赖时照常建链（vitest / next dev）', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    const res = await createPostShareLinkHandler(makeDeps({ repo, userId: 'u1' }))(
      makeRequest({ pointId: '101:suga', bangumiId: 101, locale: 'zh', layout: 'portrait' }),
    )
    expect(res.status).toBe(201)
  })
})
```

（`makeDeps` / `makeRequest` / `NOW` 沿用该文件已有的助手；若签名不同按文件内既有写法调整。）

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/links.test.ts
```

预期：`prewarmCard` 从未被调用，前三条断言失败。

- [ ] **Step 3: 最小实现**

`lib/share/api.ts` 的 `ShareApiDeps` 末尾加：

```ts
  /**
   * 建链成功后的卡片预热（两种版式各渲染一次，忽略结果）。
   * 可选：vitest 与 next dev 下不注入也能正常建链。
   */
  prewarmCard?: (input: { pointId: string; locale: SupportedLocale }) => Promise<unknown>
```

并在文件顶部加 `import type { SupportedLocale } from '@/lib/i18n/types'`；生产装配里加一项：

```ts
    prewarmCard: async ({ pointId, locale }) => {
      // 懒引：cardApi 会拖进 Browser Run 与镜像域，建链路径本身用不到
      const [{ getCardDeps }, { renderAndStoreCard }] = await Promise.all([
        import('@/lib/share/cardApi'),
        import('@/lib/share/handlers/card'),
      ])
      const cardDeps = await getCardDeps()
      await Promise.all(
        (['portrait', 'landscape'] as const).map((layout) =>
          renderAndStoreCard(cardDeps, { pointId, locale, layout, photoKey: null }),
        ),
      )
    },
```

`lib/share/handlers/links.ts` 顶部加 `import { runShareBackground } from '@/lib/share/background'`，并把结尾改成：

```ts
    // 预热：用户看到面板时通常已命中缓存。waitUntil 必须以 ctx 为 this 调用，
    // 由 runShareBackground 统一处理（见 lib/share/background.ts:21-24）
    if (deps.prewarmCard) {
      runShareBackground(
        deps.prewarmCard({ pointId: parsed.data.pointId, locale: parsed.data.locale }),
      )
    }

    return NextResponse.json(toResponse(created.code, deps.origin), { status: 201 })
```

（放在 `const created = await allocateShareCode(...)` 之后、`return` 之前；24 小时去重命中的 200 分支在更早处已经 `return`，天然不会重复预热。）

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share/links.test.ts && npx tsc -p tsconfig.app.json --noEmit
```

预期：新增四条全绿，原有限流/去重/参数用例一条不改。

- [ ] **Step 5: commit**

```
git add lib/share/api.ts lib/share/handlers/links.ts tests/share/links.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 建链成功后后台预热两种版式的卡片

走 runShareBackground（waitUntil 以 ctx 为 this 调用）；去重命中的 200 分支不重复预热。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A15：上传端点的 `card` 改可选

**Files:**
- Modify: `lib/share/types.ts:59-65`（`ShareUploadResponse`）
- Modify: `lib/share/repo.ts:51-55`（`markUploaded` 的 `imageKey` 改可空）
- Modify: `lib/share/repoMemory.ts:80-91`
- Modify: `lib/share/repoPrisma.ts:76-94`
- Modify: `lib/share/handlers/upload.ts:76-136`
- Test: `tests/share/upload.test.ts`、`tests/share/repoMemory.test.ts`

前端不再生成卡片，但「添加实拍」仍要把照片传上来换一个 photo key。`card` 缺省时跳过卡片校验与 `imageKey` 回填；photo 校验与每日 30 次配额都不变——所以 photo-only 也必须自增 `uploadCount`，否则这条路成了没配额的上传口子。

- [ ] **Step 1: 写失败测试**

在 `tests/share/upload.test.ts` 增改：

```ts
function photoForm(bytes: Uint8Array<ArrayBuffer>, type = 'image/jpeg') {
  const form = new FormData()
  form.set('photo', new File([bytes], 'photo.jpg', { type }))
  return form
}

describe('card 可选（服务端渲染改造后）', () => {
  it('只传 photo 也成功，返回 photoKey、imageUrl 为 null', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo, 'u1')
    const { store, objects } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(photoForm(jpeg(1200, 900))),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    expect(objects.has('checkin/u1/101:suga.jpg')).toBe(true)
    expect((await repo.findByCode('AbC12xYz'))?.imageKey).toBeNull()
  })

  it('photo-only 也计每日配额', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo, 'u1')
    const { store } = makeStore()
    const handler = createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))
    for (let i = 0; i < USER_DAILY_UPLOAD_LIMIT; i++) {
      expect((await handler(makeRequest(photoForm(jpeg(1200, 900))), ctx)).status).toBe(200)
    }
    expect((await handler(makeRequest(photoForm(jpeg(1200, 900))), ctx)).status).toBe(429)
  })

  it('card 与 photo 都没有 → 400', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo, 'u1')
    const { store } = makeStore()
    const res = await createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))(
      makeRequest(new FormData()),
      ctx,
    )
    expect(res.status).toBe(400)
  })

  it('传了 card 时校验一条不放（415/413/422 全部保持）', async () => {
    const repo = new MemoryShareLinkRepo(() => NOW)
    await seed(repo, 'u1')
    const { store } = makeStore()
    const handler = createPostShareUploadHandler(makeDeps({ repo, store, userId: 'u1' }))
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1440), 'image/png')), ctx)).status).toBe(415)
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1440, 1_600_000))), ctx)).status).toBe(413)
    expect((await handler(makeRequest(cardForm(jpeg(1080, 1350))), ctx)).status).toBe(422)
  })
})
```

同时把原有「合法卡片写进 R2 并回填 imageKey/userId」用例的期望响应体补上 `photoKey: null`（该用例只传 card）。

在 `tests/share/repoMemory.test.ts` 追加：

```ts
it('markUploaded 传 null imageKey 时只自增 uploadCount', async () => {
  const repo = new MemoryShareLinkRepo(() => NOW)
  const created = await repo.create({
    code: 'AbC12xYz',
    pointId: 'p1',
    bangumiId: 1,
    locale: 'zh',
    layout: 'portrait',
    userId: 'u1',
    ipHash: null,
  })
  expect(created.imageKey).toBeNull()
  const updated = await repo.markUploaded('AbC12xYz', { imageKey: null, userId: 'u1' })
  expect(updated?.imageKey).toBeNull()
  expect(updated?.uploadCount).toBe(1)
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/share/upload.test.ts tests/share/repoMemory.test.ts
```

预期：`只传 photo 也成功` 得到 400「缺少卡片图片」；`photo-only 也计每日配额` 第 31 次仍返回 200；`markUploaded` 用例类型不符。

- [ ] **Step 3: 最小实现**

`lib/share/types.ts` 的 `ShareUploadResponse` 改成：

```ts
export type ShareUploadResponse = {
  ok: true
  /** 卡片公开读取地址 /api/share/img/<code>；这次没传 card 时为 null */
  imageUrl: string | null
  /** 写进 UserPointState.photoUrl 的地址；没传 photo 时为 null */
  photoUrl: string | null
  /** 实拍的 R2 key，前端拿它拼带 photo 参数的卡片 URL；没传 photo 时为 null */
  photoKey: string | null
}
```

`lib/share/repo.ts` 的 `markUploaded` 签名改成：

```ts
  /**
   * 回填 imageKey/userId 并原子自增 uploadCount、刷新 updatedAt。
   * imageKey 传 null 表示这次只传了实拍：不动 imageKey，只计配额。
   */
  markUploaded(
    code: string,
    input: { imageKey: string | null; userId: string },
  ): Promise<ShareLinkRecord | null>
```

`lib/share/repoMemory.ts`：

```ts
  async markUploaded(
    code: string,
    input: { imageKey: string | null; userId: string },
  ): Promise<ShareLinkRecord | null> {
    const found = this.rows.get(code)
    if (!found) return null
    if (input.imageKey !== null) found.imageKey = input.imageKey
    found.userId = input.userId
    found.uploadCount += 1
    found.updatedAt = this.now()
    return { ...found }
  }
```

`lib/share/repoPrisma.ts`：

```ts
  async markUploaded(
    code: string,
    input: { imageKey: string | null; userId: string },
  ): Promise<ShareLinkRecord | null> {
    try {
      const updated = await prisma.shareLink.update({
        where: { code },
        data: {
          // imageKey 为 null 表示只传了实拍：整个字段不出现在 data 里，保持原值
          ...(input.imageKey !== null ? { imageKey: input.imageKey } : {}),
          userId: input.userId,
          uploadCount: { increment: 1 },
        },
      })
      return toRecord(updated)
    } catch (error) {
      if (isPrismaKnownRequestError(error) && error.code === 'P2025') return null
      throw error
    }
  }
```

`lib/share/handlers/upload.ts` 的 formData 之后整段改成：

```ts
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
```

`cardFingerprint` 的形参类型保持 `Uint8Array<ArrayBuffer>` 不变。

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/share && npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tests.json --noEmit
```

预期：全绿。

- [ ] **Step 5: commit**

```
git add lib/share/types.ts lib/share/repo.ts lib/share/repoMemory.ts lib/share/repoPrisma.ts lib/share/handlers/upload.ts tests/share/upload.test.ts tests/share/repoMemory.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 上传端点 card 改可选，photo-only 也计配额并返回 photoKey

前端不再生成卡片；markUploaded 的 imageKey 可为 null 表示只补传实拍。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track A — Task A16：短链页 OG 图改指卡片路由

**Files:**
- Modify: `app/s/[code]/page.tsx:5`（删掉 `resolveMirrorPublicUrl` 的 import）、`:10`（import 改）、`:54-60`（OG 图选路）
- Test: 由 Task A11 的 `buildShareOgImageUrl` 单测覆盖（页面本身不引入新测试文件——`generateMetadata` 依赖 React `cache()` 与 Prisma，单测成本远高于收益）

- [ ] **Step 1: 确认 A11 的测试已覆盖**

```
npx vitest run tests/share/view.test.ts
```

预期：`buildShareOgImageUrl` 的四条用例全绿（有 imageKey / 无指纹 / 无 imageKey / locale 跟随）。

- [ ] **Step 2: 改实现**

删掉第 5 行 `import { resolveMirrorPublicUrl } from '@/lib/anitabi/imageProxy'`（OG 图不再需要它；动画截图兜底已经在卡片路由里）。

第 10 行的 import 改成：

```ts
import {
  buildShareDescription,
  buildShareOgImageUrl,
  buildShareRedirectTarget,
  buildShareTitle,
} from '@/lib/share/view'
```

第 54-60 行整段替换成：

```ts
  // 有 imageKey（登录用户传过带实拍的卡）→ 维持现状并靠 ?v=<指纹> 破爬虫缓存；
  // 否则指向服务端卡片路由——匿名分享从此也有完整卡片预览，不需要任何用户上传
  const image = buildShareOgImageUrl({
    origin,
    code: link.code,
    pointId: link.pointId,
    locale: link.locale,
    imageKey: link.imageKey,
    fingerprint: link.imageKey ? shareCardFingerprint(link.imageKey) : null,
  })
```

`snapshot` 仍然要留着（title / description 用它），只是不再参与 OG 图选路。

- [ ] **Step 3: 跑通过**

```
npx tsc -p tsconfig.app.json --noEmit && npm run lint 2>&1 | grep -E "app/s/" || echo 'lint 无该文件告警'
```

预期：类型干净；`resolveMirrorPublicUrl` 未使用的告警不再出现（已删 import）。

- [ ] **Step 4: commit**

```
git add app/s/\[code\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(share): 短链页 OG 图在无 imageKey 时指向服务端卡片路由

匿名分享从此有完整卡片预览；有上传卡片的仍走 /api/share/img/<code>?v=<指纹>。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track B — Task B1：三语新增 `share.addPhotoLoginRequired`

**Files:**
- Modify: `lib/i18n/locales/zh.json`（`share.addPhoto` 之后）
- Modify: `lib/i18n/locales/en.json`（同位置）
- Modify: `lib/i18n/locales/ja.json`（同位置）
- Test: `tests/i18n/shareKeys.test.ts:66-74`

- [ ] **Step 1: 写失败测试**

在 `tests/i18n/shareKeys.test.ts` 第 68 行的 `V2_1_KEYS` 之后加一组，并把它接进第 71 行的展开列表：

```ts
  // 2026-09-08 服务端渲染改造：未登录时「添加实拍」的需登录态
  const OG_SERVER_RENDER_KEYS = ['addPhotoLoginRequired']
```

```ts
    for (const key of [
      ...REVIEW_FIX_KEYS,
      ...V2_KEYS,
      ...CAPTION_EDITOR_KEYS,
      ...V2_1_KEYS,
      ...OG_SERVER_RENDER_KEYS,
    ]) {
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/i18n/shareKeys.test.ts
```

预期：三条 `%s 含有评审修复新增的键` 全部失败在 `share.addPhotoLoginRequired`。

- [ ] **Step 3: 最小实现**

`lib/i18n/locales/zh.json` 的 `"addPhoto": "添加实拍",` 之后插入：

```json
    "addPhotoLoginRequired": "登录后添加实拍",
```

`lib/i18n/locales/en.json` 的 `"addPhoto": "Add your photo",` 之后插入：

```json
    "addPhotoLoginRequired": "Sign in to add your photo",
```

`lib/i18n/locales/ja.json` 的 `"addPhoto": "実写を追加",` 之后插入：

```json
    "addPhotoLoginRequired": "ログインして実写を追加",
```

（缩进跟随各文件 `share` 段的现有缩进。）

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/i18n/shareKeys.test.ts
```

预期：全绿（键集合三语一致、无空值）。

- [ ] **Step 5: commit**

```
git add lib/i18n/locales/zh.json lib/i18n/locales/en.json lib/i18n/locales/ja.json tests/i18n/shareKeys.test.ts
git commit -m "$(cat <<'EOF'
feat(i18n): 新增 share.addPhotoLoginRequired 三语文案

服务端渲染改造后「添加实拍」改为登录可用，未登录时显示需登录态。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track B — Task B2：`shareClient` 取图与实拍上传

**Files:**
- Modify: `components/share/shareClient.ts:29-45`（`uploadShareAssets` 换成 `uploadSharePhoto`）、文件末尾追加 `fetchCardBlob`
- Test: `tests/components/shareClient.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `tests/components/shareClient.test.tsx` 末尾追加：

```ts
describe('fetchCardBlob', () => {
  it('把卡片 URL 取成 blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchCardBlob('/api/share/card/p1?locale=zh&layout=landscape')
    expect(out).toBeInstanceOf(Blob)
    expect(fetchMock).toHaveBeenCalledWith('/api/share/card/p1?locale=zh&layout=landscape')
  })

  it('非 2xx 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    expect(await fetchCardBlob('/api/share/card/p1')).toBeNull()
  })

  it('302 到兜底图时（fetch 自动跟随）仍返回 blob', async () => {
    const blob = new Blob([new Uint8Array([9])], { type: 'image/jpeg' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blob, { status: 200 })))
    expect(await fetchCardBlob('/api/share/card/p1')).toBeInstanceOf(Blob)
  })

  it('抛错返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await fetchCardBlob('/api/share/card/p1')).toBeNull()
  })
})

describe('uploadSharePhoto', () => {
  it('只带 photo 字段发到上传端点，回传 photoKey', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, imageUrl: null, photoUrl: '/api/share/photo/u1/p1', photoKey: 'checkin/u1/p1.jpg' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
    const out = await uploadSharePhoto('AbC12xYz', file)
    expect(out?.photoKey).toBe('checkin/u1/p1.jpg')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/share/links/AbC12xYz/upload')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('photo')).toBeInstanceOf(File)
    expect(form.get('card')).toBeNull()
  })

  it('401 / 429 / 503 都返回 null', async () => {
    for (const status of [401, 429, 503]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status })))
      const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
      expect(await uploadSharePhoto('AbC12xYz', file), String(status)).toBeNull()
    }
  })
})
```

并把 `fetchCardBlob` / `uploadSharePhoto` 加进该文件的 import。

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/components/shareClient.test.tsx
```

预期：`does not provide an export named 'fetchCardBlob'`。

- [ ] **Step 3: 最小实现**

`components/share/shareClient.ts` 里把 `uploadShareAssets`（第 29-45 行）整段替换成：

```ts
/**
 * 只补传实拍：卡片自 2026-09-08 起由服务端渲染，前端不再生成也不再上传 card。
 * 失败（未登录 401、限流 429、无绑定 503）都只返回 null——加实拍是锦上添花，
 * 失败了继续用不带实拍的服务端卡片。
 */
export async function uploadSharePhoto(
  code: string,
  photo: File,
): Promise<ShareUploadResponse | null> {
  try {
    const form = new FormData()
    form.set('photo', photo)
    const res = await fetch(`/api/share/links/${code}/upload`, { method: 'POST', body: form })
    if (!res.ok) return null
    return (await res.json()) as ShareUploadResponse
  } catch {
    return null
  }
}

/**
 * 取服务端卡片图。保存/复制/系统分享与预览共用同一个 blob，只发一次请求。
 * 渲染失败时后端会 302 到动画截图或站点默认 OG，fetch 自动跟随，仍拿得到图。
 */
export async function fetchCardBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}
```

`CreateShareLinkRequest` 等既有 import 保持不动（`ShareUploadResponse` 仍在用）。

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/components/shareClient.test.tsx
```

预期：新增用例全绿；原有 `createShareLink` / `copyImage` / `transcodeToJpeg` 等用例不变。此时 `PointSharePanel.tsx` 还在 import `uploadShareAssets`，`tsc` 会报——B3 修掉。

- [ ] **Step 5: commit**

```
git add components/share/shareClient.ts tests/components/shareClient.test.tsx
git commit -m "$(cat <<'EOF'
feat(share): shareClient 换成 fetchCardBlob + uploadSharePhoto

卡片改由服务端渲染，前端只负责取图与补传实拍。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track B — Task B3：卡片文件名按内容类型给扩展名

**Files:**
- Modify: `components/share/shareText.ts:66-73`（`buildCardFilename` 加可选 contentType）
- Test: `tests/components/shareText.test.ts`

服务端卡片是 WebP，`.jpg` 的文件名会让部分系统的图库拒收。默认值保持 `image/jpeg`，既有调用与既有测试一条不动。

- [ ] **Step 1: 写失败测试**

在 `tests/components/shareText.test.ts` 的 `buildCardFilename` 段落追加：

```ts
  it('WebP 内容给 .webp 扩展名', () => {
    expect(buildCardFilename('须贺神社', 'image/webp')).toBe('seichigo-须贺神社.webp')
  })

  it('不传或非 webp 时仍是 .jpg', () => {
    expect(buildCardFilename('须贺神社')).toBe('seichigo-须贺神社.jpg')
    expect(buildCardFilename('须贺神社', 'image/jpeg')).toBe('seichigo-须贺神社.jpg')
  })
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/components/shareText.test.ts
```

预期：`WebP 内容给 .webp 扩展名` 得到 `seichigo-须贺神社.jpg`。

- [ ] **Step 3: 最小实现**

`components/share/shareText.ts` 的 `buildCardFilename` 替换成：

```ts
/**
 * 分享卡片文件名：点位名只保留各国文字/数字/_/-，其余折叠成单个 -，截 40 字符。
 * 扩展名跟着实际内容走——服务端卡片是 WebP，兜底 302 到的动画截图可能是 JPEG。
 */
export function buildCardFilename(name: string, contentType = 'image/jpeg'): string {
  const slug = String(name || '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)
  const ext = String(contentType || '').toLowerCase().includes('webp') ? 'webp' : 'jpg'
  return `seichigo-${slug || 'card'}.${ext}`
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/components/shareText.test.ts
```

预期：全绿（原有用例不传第二参，行为不变）。

- [ ] **Step 5: commit**

```
git add components/share/shareText.ts tests/components/shareText.test.ts
git commit -m "$(cat <<'EOF'
feat(share): 卡片文件名扩展名跟随内容类型

服务端卡片是 WebP，.jpg 的名字会让部分系统图库拒收；默认值保持 jpg。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track B — Task B4：面板改用服务端卡片图

**Files:**
- Modify: `components/share/PointSharePanel.tsx`（全量重写，从 709 行降到约 430 行）
- Test: `tests/components/pointSharePanel.test.tsx`（全量重写）

行为要点：预览改 `<img>` 指向服务端卡片 URL（同一个 blob 供保存/复制/系统分享复用，只发一次请求）；版式切换换 `layout` 查询参数重新取图；「添加实拍」上传后拿 `photoKey` 拼带 `photo` 参数的卡片 URL 刷新预览；未登录时该按钮显示为需登录态，点击跳 `/auth/signin?callbackUrl=<当前页>`。

- [ ] **Step 1: 写失败测试**

把 `tests/components/pointSharePanel.test.tsx` 整体替换成：

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

const createShareLinkMock = vi.fn()
const fetchCardBlobMock = vi.fn()
const uploadSharePhotoMock = vi.fn()
const transcodeToJpegMock = vi.fn()
const copyImageMock = vi.fn()
const downloadBlobMock = vi.fn()
const fetchPointContextMock = vi.fn()
const canShareFilesMock = vi.fn()
const shareViaSystemMock = vi.fn()
const copyTextMock = vi.fn()
const openBlankWindowMock = vi.fn()
const openOrNavigateMock = vi.fn()
vi.mock('@/components/share/shareClient', async () => {
  const actual = await vi.importActual<typeof import('@/components/share/shareClient')>(
    '@/components/share/shareClient',
  )
  return {
    ...actual,
    createShareLink: (...args: any[]) => createShareLinkMock(...args),
    fetchCardBlob: (...args: any[]) => fetchCardBlobMock(...args),
    uploadSharePhoto: (...args: any[]) => uploadSharePhotoMock(...args),
    transcodeToJpeg: (...args: any[]) => transcodeToJpegMock(...args),
    copyImage: (...args: any[]) => copyImageMock(...args),
    downloadBlob: (...args: any[]) => downloadBlobMock(...args),
    fetchPointContext: (...args: any[]) => fetchPointContextMock(...args),
    canShareFiles: (...args: any[]) => canShareFilesMock(...args),
    shareViaSystem: (...args: any[]) => shareViaSystemMock(...args),
    copyText: (...args: any[]) => copyTextMock(...args),
    openBlankWindow: (...args: any[]) => openBlankWindowMock(...args),
    openOrNavigate: (...args: any[]) => openOrNavigateMock(...args),
  }
})

const useSessionMock = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => useSessionMock() }))

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

function cardBlob(tag = 'card'): Blob {
  return new Blob([tag], { type: 'image/webp' })
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.localStorage?.clear()
  useSessionMock.mockReturnValue({ status: 'authenticated' })
  createShareLinkMock.mockResolvedValue({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' })
  fetchCardBlobMock.mockResolvedValue(cardBlob())
  fetchPointContextMock.mockResolvedValue({
    address: '東京都 新宿区 须贺町',
    geo: [35.6895, 139.7],
    note: '重逢的阶梯',
    inJapan: true,
    displayName: '须贺神社',
    animeTitle: '你的名字。',
  })
  canShareFilesMock.mockReturnValue(false)
  ;(globalThis.URL as any).createObjectURL ??= vi.fn(() => 'blob:preview')
  ;(globalThis.URL as any).revokeObjectURL ??= vi.fn()
})

describe('PointSharePanel 预览走服务端卡片', () => {
  it('首屏用竖版卡片 URL 取图', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalled())
    expect(fetchCardBlobMock.mock.calls[0][0]).toBe(
      '/api/share/card/101%3Asuga?locale=zh&layout=portrait',
    )
  })

  it('取到图之前显示骨架文案，取到后显示预览图', async () => {
    let resolveCard: (blob: Blob) => void = () => {}
    fetchCardBlobMock.mockReturnValue(new Promise<Blob>((resolve) => { resolveCard = resolve }))
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByText(t('share.generating', 'zh'))).toBeInTheDocument()
    resolveCard(cardBlob())
    await waitFor(() =>
      expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toBeInTheDocument(),
    )
  })

  it('切横版时换 layout 参数重新取图', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText(t('share.layoutLandscape', 'zh')))
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(2))
    expect(fetchCardBlobMock.mock.calls[1][0]).toBe(
      '/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    )
  })

  it('取图失败显示重试，点重试重新取', async () => {
    fetchCardBlobMock.mockResolvedValueOnce(null)
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByText(t('share.generateFailed', 'zh'))).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.retry', 'zh')))
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(2))
  })

  it('保存图片用的是取回来的那个 blob，不再发第二次请求', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.saveImage', 'zh')))
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    expect(downloadBlobMock.mock.calls[0][1]).toMatch(/\.webp$/)
    expect(fetchCardBlobMock).toHaveBeenCalledTimes(1)
  })

  it('不再向上传端点推卡片', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toBeInTheDocument())
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })
})

describe('添加实拍', () => {
  it('登录用户选图后上传并用 photo 参数重取卡片', async () => {
    uploadSharePhotoMock.mockResolvedValue({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(uploadSharePhotoMock).toHaveBeenCalledWith('AbC12xYz', file))
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(2))
    expect(fetchCardBlobMock.mock.calls[1][0]).toContain('photo=checkin%2Fu1%2F101%3Asuga.jpg')
  })

  it('上传失败时提示且不改卡片 URL', async () => {
    uploadSharePhotoMock.mockResolvedValue(null)
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('share.toastFailed', 'zh')))
    expect(fetchCardBlobMock).toHaveBeenCalledTimes(1)
  })

  it('超过 5MB 直接提示，不上传', async () => {
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const big = new File([new Uint8Array(5_000_001)], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [big] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(t('share.toastPhotoTooLarge', 'zh')),
    )
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })

  it('未登录时显示需登录态且不打开文件选择', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalled())
    expect(screen.getByText(t('share.addPhotoLoginRequired', 'zh'))).toBeInTheDocument()
    expect(screen.queryByText(t('share.addPhoto', 'zh'))).toBeNull()
  })

  it('未登录时点击跳登录页并带 callbackUrl', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://seichigo.com/map', assign },
    })
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText(t('share.addPhotoLoginRequired', 'zh')))
    expect(assign).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=https%3A%2F%2Fseichigo.com%2Fmap',
    )
  })
})

describe('目的地与文案（回归）', () => {
  it('卡片没就绪时先出骨架', () => {
    fetchCardBlobMock.mockReturnValue(new Promise(() => {}))
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByTestId('share-destinations-skeleton')).toBeInTheDocument()
  })

  it('桌面路径出三列六个目的地', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    expect(screen.getByText(t('share.platformX', 'zh'))).toBeInTheDocument()
    expect(screen.getByText(t('share.saveImage', 'zh'))).toBeInTheDocument()
  })

  it('手机路径走系统面板并带渠道参数', async () => {
    canShareFilesMock.mockReturnValue(true)
    shareViaSystemMock.mockResolvedValue('files')
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.platformXiaohongshu', 'zh')))
    await waitFor(() => expect(shareViaSystemMock).toHaveBeenCalled())
    expect(shareViaSystemMock.mock.calls[0][0].url).toBe('https://seichigo.com/s/AbC12xYz?c=xhs')
  })
})
```

- [ ] **Step 2: 跑一次看失败**

```
npx vitest run tests/components/pointSharePanel.test.tsx
```

预期：大面积失败——旧面板还在 import `uploadShareAssets` 与 `PointShareCard`，`fetchCardBlob` 从未被调用。

- [ ] **Step 3: 最小实现**

把 `components/share/PointSharePanel.tsx` 整体替换成：

```tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, ChevronRight, Copy, Download, Loader2, LogIn, Share2, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import {
  SHARE_PHOTO_MAX_BYTES,
  buildCardImagePath,
  type PointContextResponse,
  type ShareCardLayout,
  type ShareChannel,
} from '@/lib/share/types'
import {
  buildCardFilename,
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  retargetCaptionChannel,
  toCityLevelAddress,
  withShareChannel,
} from '@/components/share/shareText'
import {
  blobToFile,
  canShareFiles,
  copyImage,
  copyText,
  createShareLink,
  downloadBlob,
  fetchCardBlob,
  fetchPointContext,
  openBlankWindow,
  openOrNavigate,
  readPreferredLayout,
  shareViaSystem,
  transcodeToJpeg,
  uploadSharePhoto,
  writePreferredLayout,
} from '@/components/share/shareClient'

export type PointSharePanelProps = {
  pointId: string
  bangumiId: number
  pointName: string
  animeTitle: string
  cityName: string
  /** 卡片改服务端渲染后由后端从库里读，这两项保留只为不动 MapDialogs 的调用点 */
  episode: string | null
  scene: string | null
  animeImage: string
  locale?: SupportedLocale
  onClose?: () => void
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

/** <img> 原生能吃的格式；其余（HEIC 等）先转 JPEG 再上传 */
const NATIVE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** 手机路径下五个目的地都走系统面板，只有渠道参数不同 */
const MOBILE_DESTINATIONS: ReadonlyArray<{ channel: ShareChannel; labelKey: string }> = [
  { channel: 'x', labelKey: 'share.platformX' },
  { channel: 'rd', labelKey: 'share.platformReddit' },
  { channel: 'ln', labelKey: 'share.platformLine' },
  { channel: 'xhs', labelKey: 'share.platformXiaohongshu' },
  { channel: 'wx', labelKey: 'share.platformWechat' },
]

const CAPTION_COLLAPSED_MAX = 40

export default function PointSharePanel({
  pointId,
  bangumiId,
  pointName,
  animeTitle,
  cityName,
  locale = 'zh',
  onClose,
}: PointSharePanelProps) {
  // 首屏固定 portrait：useState 初值在 SSR 也会跑，直接读 localStorage 会水合不一致，
  // 挂载后再读本地偏好
  const [layout, setLayout] = useState<ShareCardLayout>('portrait')
  useEffect(() => {
    setLayout(readPreferredLayout())
  }, [])
  const [context, setContext] = useState<PointContextResponse | null>(null)
  const [shareUrl, setShareUrl] = useState<string>('')
  const [code, setCode] = useState<string>('')
  const [linkFailed, setLinkFailed] = useState(false)
  const [photoKey, setPhotoKey] = useState<string | null>(null)
  const [cardBlob, setCardBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cardFailed, setCardFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captionOverride, setCaptionOverride] = useState<string | null>(null)
  const [captionExpanded, setCaptionExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { status: sessionStatus } = useSession()
  const signedIn = sessionStatus === 'authenticated'

  // 版式变了就换一条短链：短链上记录了 layout，分享出去的那条要对得上
  useEffect(() => {
    let cancelled = false
    setShareUrl('')
    setCode('')
    setLinkFailed(false)
    createShareLink({ pointId, bangumiId, locale, layout }).then((result) => {
      if (cancelled) return
      if (!result) {
        setLinkFailed(true)
        return
      }
      setShareUrl(result.url)
      setCode(result.code)
    })
    return () => {
      cancelled = true
    }
  }, [pointId, bangumiId, locale, layout, retryNonce])

  // 文案里的地址要它；卡片本身已经由服务端读同一份上下文，前端不再等它
  useEffect(() => {
    let cancelled = false
    setContext(null)
    fetchPointContext(pointId, locale).then((result) => {
      if (cancelled) return
      setContext(result)
    })
    return () => {
      cancelled = true
    }
  }, [pointId, locale, retryNonce])

  const cardUrl = useMemo(
    () => buildCardImagePath(pointId, locale, layout, photoKey),
    [pointId, locale, layout, photoKey],
  )

  // 预览、保存、复制、系统分享共用同一个 blob：整条链路只发一次卡片请求
  useEffect(() => {
    let cancelled = false
    setCardFailed(false)
    setCardBlob(null)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    fetchCardBlob(cardUrl).then((blob) => {
      if (cancelled) return
      if (!blob) {
        setCardFailed(true)
        return
      }
      setCardBlob(blob)
      setPreviewUrl(URL.createObjectURL(blob))
    })
    return () => {
      cancelled = true
    }
  }, [cardUrl, retryNonce])

  const previewUrlRef = useRef<string | null>(null)
  useEffect(() => {
    previewUrlRef.current = previewUrl
  }, [previewUrl])
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const displayName = context?.displayName?.trim() || pointName
  const cardAnimeTitle = context?.animeTitle?.trim() || animeTitle

  const showToast = useCallback(
    (key: string, vars?: Record<string, string>) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      let text = t(key, locale)
      if (vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value)
      }
      setToast(text)
      toastTimerRef.current = setTimeout(() => setToast(null), 2600)
    },
    [locale],
  )

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // 文案里的地址只到市区一级；没拿到 context 时退回作品的 city
  const captionAddress = context?.address
    ? toCityLevelAddress(context.address, locale)
    : String(cityName || '').trim()

  // 生成文案固定带 c=copy：编辑器默认内容 = 「复制文案」动作的结果
  const generatedCaption = buildShareCaption(t('share.captionTemplate', locale), {
    anime: cardAnimeTitle,
    point: displayName,
    address: captionAddress,
    url: shareUrl ? withShareChannel(shareUrl, 'copy') : '',
  })
  const editorValue = captionOverride ?? generatedCaption

  const captionFor = useCallback(
    (channel: ShareChannel) => retargetCaptionChannel(editorValue, shareUrl, channel),
    [editorValue, shareUrl],
  )

  const captionSummarySource = editorValue
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const collapsedCaption =
    captionSummarySource.length > CAPTION_COLLAPSED_MAX
      ? `${captionSummarySource.slice(0, CAPTION_COLLAPSED_MAX)}…`
      : captionSummarySource

  const cardFilename = useMemo(
    () => buildCardFilename(displayName, cardBlob?.type),
    [displayName, cardBlob],
  )
  const cardFile = useMemo(
    () => (cardBlob ? blobToFile(cardBlob, cardFilename) : null),
    [cardBlob, cardFilename],
  )
  // 手机/桌面只看 navigator.canShare({ files })，不看 UA
  const mobilePath = useMemo(() => (cardFile ? canShareFiles([cardFile]) : false), [cardFile])

  const goSignIn = () => {
    const back = typeof window !== 'undefined' ? window.location.href : '/'
    window.location.assign(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`)
  }

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reset = () => {
      if (fileRef.current) fileRef.current.value = ''
    }
    if (file.size > SHARE_PHOTO_MAX_BYTES) {
      showToast('share.toastPhotoTooLarge')
      reset()
      return
    }
    let next = file
    if (!NATIVE_PHOTO_TYPES.has(file.type)) {
      const transcoded = await transcodeToJpeg(file)
      if (!transcoded) {
        showToast('share.toastPhotoUnsupported')
        reset()
        return
      }
      next = new File([transcoded], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, {
        type: 'image/jpeg',
      })
    }
    if (!code) {
      showToast('share.toastFailed')
      reset()
      return
    }
    setBusy(true)
    try {
      // 先把实拍传上去拿 R2 key，再用带 photo 参数的卡片 URL 刷新预览
      const result = await uploadSharePhoto(code, next)
      if (!result?.photoKey) {
        showToast('share.toastFailed')
        return
      }
      setPhotoKey(result.photoKey)
    } finally {
      setBusy(false)
      reset()
    }
  }

  const removePhoto = () => {
    setPhotoKey(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const shareToSystem = async (channel: ShareChannel) => {
    if (!cardFile || !shareUrl || busy) return
    setBusy(true)
    try {
      const result = await shareViaSystem({
        files: [cardFile],
        text: captionFor(channel),
        url: withShareChannel(shareUrl, channel),
      })
      if (result === 'text') showToast('share.toastShareFilesUnsupported')
      if (result === 'failed') showToast('share.toastFailed')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 桌面 X：window.open 必须留在 click 的同步链路里 —— 先拿窗口引用，
   * 再 await 剪贴板，最后设 location，否则 await 之后的 open 会被弹窗拦截。
   */
  const handleDesktopX = async () => {
    if (!cardBlob || !shareUrl || busy) return
    setBusy(true)
    const win = openBlankWindow()
    try {
      const copied = await copyImage(cardBlob)
      if (!copied) downloadBlob(cardBlob, cardFilename)
      if (!openOrNavigate(win, buildXIntentUrl(captionFor('x')))) {
        const copiedText = await copyText(captionFor('x'))
        if (copiedText) {
          showToast('share.toastSavedAndCopiedOpenApp', { app: t('share.platformX', locale) })
        } else {
          showToast('share.toastFailed')
        }
        return
      }
      showToast(copied ? 'share.toastImageCopiedPasteInPost' : 'share.toastImageDownloadedDragIntoPost')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyImage = async () => {
    if (!cardBlob || busy) return
    setBusy(true)
    try {
      if (await copyImage(cardBlob)) {
        showToast('share.toastImageCopied')
        return
      }
      downloadBlob(cardBlob, cardFilename)
      showToast('share.toastSaved')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyText = async () => {
    if (busy) return
    setBusy(true)
    try {
      showToast((await copyText(captionFor('copy'))) ? 'share.toastCopied' : 'share.toastFailed')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () => {
    if (!cardBlob) return
    downloadBlob(cardBlob, cardFilename)
    showToast('share.toastSaved')
  }

  /** 桌面小红书/微信：下载图片 + 复制文案，一次点击做完 */
  const handleAppFlow = async (channel: 'xhs' | 'wx') => {
    if (!cardBlob || busy) return
    setBusy(true)
    try {
      downloadBlob(cardBlob, cardFilename)
      const copied = await copyText(captionFor(channel))
      if (copied) {
        showToast('share.toastSavedAndCopiedOpenApp', {
          app: t(channel === 'xhs' ? 'share.platformXiaohongshu' : 'share.platformWechat', locale),
        })
      } else {
        showToast('share.toastSaved')
      }
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(cardBlob && shareUrl)

  return (
    <div className="flex max-h-[88dvh] flex-col overflow-hidden rounded-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
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
              {cardFailed || linkFailed ? (
                <>
                  <p className="text-sm">{t('share.generateFailed', locale)}</p>
                  <button
                    type="button"
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="rounded-full bg-brand px-4 py-1.5 text-xs font-medium text-white"
                  >
                    {t('share.retry', locale)}
                  </button>
                </>
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
              aria-pressed={layout === value}
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
          <div className="ml-auto flex flex-col items-end gap-1">
            {!signedIn ? (
              // 匿名上传会被拿来传违规图：实拍一律要登录
              <button
                type="button"
                onClick={goSignIn}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand"
              >
                <LogIn className="h-4 w-4" />
                {t('share.addPhotoLoginRequired', locale)}
              </button>
            ) : photoKey ? (
              <button type="button" onClick={removePhoto} className="text-xs font-medium text-gray-500 underline">
                {t('share.removePhoto', locale)}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || !code}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  {t('share.addPhoto', locale)}
                </button>
                <span className="max-w-[180px] text-right text-[11px] leading-tight text-gray-400">
                  {t('share.photoHint', locale)}
                </span>
              </>
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

        {captionExpanded ? (
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">{t('share.captionLabel', locale)}</span>
              <textarea
                rows={3}
                value={editorValue}
                aria-label={t('share.captionLabel', locale)}
                onChange={(event) => setCaptionOverride(event.target.value)}
                className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
              />
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-expanded
                onClick={() => setCaptionExpanded(false)}
                className="text-xs font-medium text-gray-500"
              >
                {t('share.collapseCaption', locale)}
              </button>
              {captionOverride !== null ? (
                <button
                  type="button"
                  onClick={() => setCaptionOverride(null)}
                  className="text-xs font-medium text-brand"
                >
                  {t('share.resetCaption', locale)}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t('share.captionLabel', locale)}
            aria-expanded={false}
            onClick={() => setCaptionExpanded(true)}
            className="flex w-full items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-700"
          >
            <span className="min-w-0 flex-1 truncate">{collapsedCaption}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        )}

        {mobilePath ? (
          <button
            type="button"
            disabled={!ready}
            onClick={() => shareToSystem('sys')}
            className={`${BUTTON_BASE} text-sm w-full bg-gray-900 text-white`}
          >
            <Share2 className="h-4 w-4" />
            {t('share.shareTo', locale)}
          </button>
        ) : null}

        {/* 卡片没就绪时 mobilePath 还判不出来（要靠 canShare({files})），
            先出骨架占位，别让整片按钮在两条路径之间翻一次页 */}
        {!cardBlob ? (
          <div className="grid grid-cols-3 gap-2" data-testid="share-destinations-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((slot) => (
              <div key={slot} className="h-11 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : (
        <div
          data-testid="share-destinations"
          className={`grid gap-2 ${mobilePath ? 'grid-cols-5' : 'grid-cols-3'}`}
        >
          {mobilePath ? (
            MOBILE_DESTINATIONS.map((destination) => (
              <button
                key={destination.channel}
                type="button"
                disabled={!ready}
                onClick={() => shareToSystem(destination.channel)}
                className={`${BUTTON_BASE} w-full bg-gray-100 px-1.5 text-xs text-gray-800`}
              >
                {t(destination.labelKey, locale)}
              </button>
            ))
          ) : (
            <>
              <button
                type="button"
                disabled={!ready}
                onClick={handleDesktopX}
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformX', locale)}
              </button>
              <a
                href={
                  ready
                    ? buildRedditSubmitUrl(
                        withShareChannel(shareUrl, 'rd'),
                        t('share.redditTitle', locale)
                          .replace('{point}', displayName)
                          .replace('{anime}', cardAnimeTitle),
                      )
                    : undefined
                }
                aria-disabled={!ready}
                target="_blank"
                rel="noreferrer"
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800 no-underline ${ready ? '' : 'pointer-events-none opacity-50'}`}
              >
                {t('share.platformReddit', locale)}
              </a>
              <a
                href={ready ? buildLineShareUrl(withShareChannel(shareUrl, 'ln'), captionFor('ln')) : undefined}
                aria-disabled={!ready}
                target="_blank"
                rel="noreferrer"
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800 no-underline ${ready ? '' : 'pointer-events-none opacity-50'}`}
              >
                {t('share.platformLine', locale)}
              </a>
              <button
                type="button"
                disabled={!ready}
                onClick={() => handleAppFlow('xhs')}
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformXiaohongshu', locale)}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => handleAppFlow('wx')}
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformWechat', locale)}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={handleSave}
                className={`${BUTTON_BASE} text-sm w-full bg-brand text-white`}
              >
                <Download className="h-4 w-4" />
                {t('share.saveImage', locale)}
              </button>
            </>
          )}
        </div>
        )}

        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500"
          >
            {t('share.more', locale)}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {moreOpen ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {mobilePath ? (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={handleSave}
                  className={`${BUTTON_BASE} text-sm bg-gray-100 text-gray-800`}
                >
                  <Download className="h-4 w-4" />
                  {t('share.saveImage', locale)}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={handleCopyImage}
                  className={`${BUTTON_BASE} text-sm bg-gray-100 text-gray-800`}
                >
                  <Copy className="h-4 w-4" />
                  {t('share.copyImage', locale)}
                </button>
              )}
              <button
                type="button"
                disabled={!shareUrl}
                onClick={handleCopyText}
                className={`${BUTTON_BASE} text-sm bg-gray-100 text-gray-800`}
              >
                {t('share.copyText', locale)}
              </button>
            </div>
          ) : null}
        </div>

        {toast ? (
          <div role="status" className="rounded-xl bg-gray-900/90 px-3 py-2 text-center text-xs text-white">
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑通过**

```
npx vitest run tests/components/pointSharePanel.test.tsx && node scripts/check-line-budget.mjs
```

预期：新面板测试全绿；行数预算不报（新文件约 430 行 < 750）。此时 `tests/components/pointSharePanelCaption.test.tsx` 还桩着已不再被 import 的 `PointShareCard`，B5 处理。

- [ ] **Step 5: commit**

```
git add components/share/PointSharePanel.tsx tests/components/pointSharePanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(share): 分享面板预览改用服务端卡片图

不再在浏览器画 canvas；预览/保存/复制/系统分享共用同一个 blob，版式切换换查询参数重取，
实拍改登录可用（未登录显示需登录态并跳 /auth/signin）。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Track B — Task B5：删除画布实现与其测试

**Files:**
- Modify: `tests/components/pointSharePanelCaption.test.tsx:10`（去掉 `PointShareCard` 的桩，改桩 `fetchCardBlob`）
- Delete: `components/share/PointShareCard.tsx`
- Delete: `components/share/pointShareCardDraw.ts`
- Delete: `components/share/japanLocator.ts`
- Delete: `tests/components/pointShareCard.test.tsx`
- Delete: `tests/components/pointShareCardDraw.test.ts`
- Delete: `tests/components/japanLocator.test.ts`

三个实现文件在 B4 之后已经没有任何生产引用（`components/share/PointSharePanel.tsx:9` 是唯一入口，已删）。三个测试文件是它们的专属测试，必须同批删掉——留着会在删实现后直接红。`formatSceneTime` 的测试（原 `tests/components/pointShareCard.test.tsx:218-225`）已由 `tests/share/cardHtml.test.ts` 的同名段落接管（Task A4）；`japanLocator` 的投影测试已由 `tests/share/japanPath.test.ts` 接管（Task A2）。

- [ ] **Step 1: 先改测试（改完先跑，确认红/绿位置符合预期）**

`tests/components/pointSharePanelCaption.test.tsx` 要做三处改动：

1. 删掉第 6-21 行整块：注释 `// 卡片渲染器在 jsdom 里没有 canvas…`、`let lastCardInput`、`let cardStubAutoRender` 与 `vi.mock('@/components/share/PointShareCard', ...)`。
2. 第 24 行 `const uploadShareAssetsMock = vi.fn()` 改成：

```ts
const fetchCardBlobMock = vi.fn()
const uploadSharePhotoMock = vi.fn()
```

3. `vi.mock('@/components/share/shareClient', ...)` 返回体里的 `uploadShareAssets: (...args: any[]) => uploadShareAssetsMock(...args),` 换成：

```ts
    fetchCardBlob: (...args: any[]) => fetchCardBlobMock(...args),
    uploadSharePhoto: (...args: any[]) => uploadSharePhotoMock(...args),
```

并在该文件的 `beforeEach` 里补一条默认返回（文案用例只关心文案，卡片给个立即成功的桩即可）：

```ts
  fetchCardBlobMock.mockResolvedValue(new Blob(['card'], { type: 'image/webp' }))
```

文件里若还有 `lastCardInput` / `cardStubAutoRender` 的残留引用（例如某条断言检查卡片输入），把该条断言删掉——卡片输入已由服务端决定，前端测不到也不该测。

```
npx vitest run tests/components/pointSharePanelCaption.test.tsx
```

预期：全绿（文案编辑器的行为与卡片渲染无关，本就不该依赖画布桩）。

- [ ] **Step 2: 删文件**

```
git rm components/share/PointShareCard.tsx \
       components/share/pointShareCardDraw.ts \
       components/share/japanLocator.ts \
       tests/components/pointShareCard.test.tsx \
       tests/components/pointShareCardDraw.test.ts \
       tests/components/japanLocator.test.ts
```

- [ ] **Step 3: 跑一次确认没有残留引用**

```
grep -rn "pointShareCardDraw\|japanLocator\|share/PointShareCard\|uploadShareAssets" app components features lib tests || echo '无残留引用'
npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tests.json --noEmit
```

预期：`无残留引用`，两条类型检查都干净。

- [ ] **Step 4: 全量跑通过**

```
npm test
```

预期：`check-line-budget` 通过、`node` / `jsdom` / `workers` 三个 project 全绿。

- [ ] **Step 5: commit**

```
git add -A components/share tests/components
git commit -m "$(cat <<'EOF'
refactor(share): 删除浏览器 canvas 卡片实现与其测试

PointShareCard / pointShareCardDraw / japanLocator 三件套整体下线，
投影逻辑已由 lib/share/japanPath.ts 接管，formatSceneTime 由 lib/share/cardHtml.ts 接管。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
EOF
)"
```

---

## Task V — 合流验收（两条 Track 都落地后）

**Files:**
- 无改动；本 Task 只跑验证

- [ ] **Step 1: 全量单测与类型**

```
npm test && npm run typecheck
```

预期：全绿。

- [ ] **Step 2: 本地冒烟**

```
npm run dev -- -p 3457
```

浏览器打开 `http://localhost:3457/map`，逐条确认：
1. 打开任一点位 → 分享 → 预览出现的是服务端图（Network 面板里只有一条 `/api/share/card/...` 请求，且没有任何 canvas 相关请求）。
2. 切到横版 → 再发一条 `/api/share/card/...?layout=landscape`，预览换成 1200×630 比例。
3. 点「保存图片」→ 下载文件名以 `.webp` 结尾，尺寸与当前版式一致。
4. 退出登录后重开面板 →「添加实拍」显示为需登录态；点击跳到 `/auth/signin?callbackUrl=...`。
5. 登录后选一张实拍 → 上传完成后预览刷新为对比布局，`/api/share/card/...` 带上 `photo=checkin/...`。
6. 再次打开同一点位 → 预览近乎瞬时（缓存命中）。

用完按 pid 停 dev（不要按端口 kill）。

- [ ] **Step 3: 卡片接口的缓存一致性**

```
time curl -s -o /tmp/c1.webp -w '%{http_code}\n' 'http://localhost:3457/api/share/card/<pointId>?locale=ja&layout=portrait'
time curl -s -o /tmp/c2.webp -w '%{http_code}\n' 'http://localhost:3457/api/share/card/<pointId>?locale=ja&layout=portrait'
cmp /tmp/c1.webp /tmp/c2.webp && echo '两次字节一致'
```

预期：第二次显著更快，字节一致。

- [ ] **Step 4: 预览部署自测（不合并）**

按仓库既有规矩：改动完成默认只出预览，站长明确同意后才合并部署。

```
npm run cf:build && npx opennextjs-cloudflare upload
```

拿到预览 URL 后：
- 打开 `<预览域>/api/share/card/<pointId>?locale=zh&layout=landscape`，确认返回 1200×630 WebP（而不是 302 兜底）——生产 secret 已就位，预览版本共用同一套 secret。
- 把 `<预览域>/s/<某条匿名短码>` 贴进 X Card Validator，确认预览是卡片而不是裸动画截图。

- [ ] **Step 5: 记录开放问题**

把 Step 2-4 里出现的任何未决项追加到 `.omc/plans/open-questions.md`。

---

## Self-Review：逐条对照设计文档

| Spec 章节 | 要求 | 覆盖的 Task |
|---|---|---|
| **一、卡片 HTML 生成器** | 新建 `lib/share/cardHtml.ts`，`CardHtmlInput` 与 `buildCardHtml` 签名 | A4（常量 + `formatSceneTime` + `buildAnimeMetaLine`）、A5（`CardHtmlInput` + `buildCardHtml`） |
| 一 · 输出完整 HTML，body 固定版式尺寸、`margin:0`、`overflow:hidden` | A5 Step 1 的前两条断言 + Step 3 的 `styles()` |
| 一 · 照搬导航胶囊版面，flex + `-webkit-line-clamp`，不手算几何 | A4（数值逐项对照 `pointShareCardDraw.ts` 的行号）、A5（`.clamp-name` / `.clamp1` / `.clamp2`） |
| 一 · 日本轮廓 SVG path，复用投影算法搬到 `lib/share/japanPath.ts`，`inJapan` 为 false 不渲染 | A2（`buildJapanOutlinePath`）、A5（`locatorSvg` 与 `inJapan` 断言） |
| 一 · 二维码服务端生成 SVG 内联 | A3（`buildQrSvg`，走 `svg-tag` 深引而非 `toString`，避开 png/fs）、A5（`capsuleSection` 内联） |
| 一 · 图片一律内联 base64 | A10（`toDataUri` + 「HTML 里不留外链」断言） |
| 一 · Noto Sans CJK 字体栈 | A5（`FONT_STACK` 与其断言） |
| **二、二维码目标改稳定 URL** | 编码 `/{locale}/map?b=&p=&utm_source=share&utm_medium=image&utm_campaign=point_card` | A11（`buildCardQrTarget` 四条断言，含「不含 `/s/`」） |
| 二 · 短链角色不变、`og:image` 改指卡片 | A11（`buildShareOgImageUrl`）、A16（接进 `app/s/[code]/page.tsx`） |
| **三、渲染接口** | `GET /api/share/card/[pointId]?locale&layout&photo` | A13（路由壳） |
| 三 ·1 pointId 校验；locale/layout 非法回落；photo 只接受 checkin 形状且必须存在 | A10（`normalizeCardLocale/Layout`、`isCheckinPhotoKey`）、A12（400 / 回落 / photo 两条断言） |
| 三 ·2 R2 缓存键（带实拍时挂 photoKey 的 sha256 前 12 位） | A10（`cardCacheKey` 三条断言） |
| 三 ·3 命中直接返回 + immutable | A12（命中用例，断言 `cache-control` 与「不触发渲染」） |
| 三 ·4 未命中：复用 pointContext 内部函数、取动画截图转 base64、取 photo、`buildCardHtml` → Browser Run → 存 R2 | A9（`loadPointContext`）、A6（Browser Run 请求体与 20 秒超时）、A10（`renderAndStoreCard`）、A12（未命中用例） |
| 三 ·5 失败兜底：302 到动画截图 → `/opengraph-image`；不写缓存、`max-age=60` | A12（三条兜底断言） |
| 三 ·6 匿名日 300 次，缓存命中不计入 | A7（`checkCardRate`）、A12（限流用例显式验证命中不计数） |
| 三 ·7 全局日预算 3000，实施时择一并写明 | A7（**选定 R2 日计数对象**，理由与并发少计的取舍写在代码注释与 Task 说明里）、A12（预算耗尽与 +1 两条断言） |
| **四、预热** | 建链成功后 `ctx.waitUntil` 触发两种版式渲染，忽略结果 | A14（走 `runShareBackground`，四条断言含「抛错不影响建链」「去重命中不重复预热」） |
| **五、短链页** | 有 `imageKey` 维持现状；否则指向卡片接口横版 | A11（`buildShareOgImageUrl` 四条断言）、A16（页面接线，删掉不再需要的 `resolveMirrorPublicUrl` import） |
| **六、面板改造** | 删除三个画布文件及其测试 | B5（`git rm` 六个文件 + 残留引用 grep） |
| 六 · 预览改 `<img src="/api/share/card/...">`，加载中骨架 | B4（首屏 URL、骨架文案、预览图三条断言） |
| 六 · 保存/复制/系统分享 fetch 同一 URL 得 blob 再走现有逻辑 | B2（`fetchCardBlob`）、B4（「只发一次请求」断言）、B3（文件名扩展名跟随内容类型） |
| 六 · 版式切换换 `layout` 查询参数重取 | B4（切横版断言 URL） |
| 六 ·「添加实拍」改登录可用，未登录显示 `share.addPhotoLoginRequired`；登录用户只传 photo 拿 key 再刷新预览 | B1（三语文案）、B4（登录/未登录四条断言） |
| 六 · `uploadShareAssets` 的 card 不再由前端生成，端点保留 card 可选 | B2（换成 `uploadSharePhoto`，断言 `form.get('card')` 为 null）、A15（端点 card 可选） |
| **七、清理** | card 缺省时跳过尺寸/体积校验，photo 校验不变 | A15（四条断言，含「传了 card 时 415/413/422 一条不放」） |
| 七 · `ShareLink.imageKey` 语义不变 | A15（photo-only 时 `imageKey` 保持 null 的断言）、A16（有 imageKey 仍走 `/api/share/img/<code>`） |
| 七 · `qrcode` 从客户端用法转服务端用法，前端不再引入 | A3（服务端 `buildQrSvg`）、B5（删掉唯一 import `qrcode` 的 `PointShareCard.tsx`） |
| **八、验收 · 单测** | `buildCardHtml` 有无地址/说明/坐标/实拍 × 三语 × 两版式，不含未替换占位符 | A5（九条断言） |
| 八 · `japanPath` 投影四角与东京落点 | A2（四角在框内、等比居中、东京/京都/札幌相对位置） |
| 八 · 卡片接口缓存命中/未命中/Browser Run 失败兜底/限流/预算耗尽 | A12（逐条对应） |
| 八 · 短链页 OG 在有无 `imageKey` 两种情况的 URL | A11（`buildShareOgImageUrl` 四条） |
| 八 · 集成：curl 两次，第二次更快且字节一致 | A13 Step 3、Task V Step 3 |
| 八 · 浏览器冒烟 6 条 | Task V Step 2 |
| 八 · 上线后 X Card Validator | Task V Step 4 |
| **九、执行约定 · Track A 文件清单** | `cardHtml` / `japanPath` / `browserRun` / 卡片路由与 handler / 短链页 OG / links 预热 / upload card 可选 | A1-A16，全部落在 File Structure 的 Track A 表内 |
| 九 · Track B 文件清单 | 面板改造、删三个画布文件与测试、`shareClient` 取图、i18n 新增 | B1-B5，全部落在 Track B 表内 |
| 九 · 两条 Track 文件不相交；`buildCardImagePath` 由 A 先建、B 只 import | A1（先建）、B4（只 import）；File Structure 两张表无交集 |

### 自查中发现并已修掉的问题

1. **`buildCardQrTarget` 的依赖倒序**：A10 的 `renderAndStoreCard` 要用它，但它属于 `lib/share/view.ts`。已在 A10 与 A11 里显式写明「A11 先于 A10 执行」。
2. **卡片需要的字段 `PointContextResponse` 里没有**：`bangumiId`（二维码深链）、`ep` / `s`（作品行）、`image`（动画截图）四项都不在现有响应体里。已加 Task A8 扩 `PointContextRow`，并在 A8 里加一条回归守住「`/api/share/point-context` 响应体不变宽」（spec 的非目标）。
3. **photo-only 上传是没配额的口子**：`card` 改可选后，配额靠 `markUploaded` 自增 `uploadCount`，不传 card 就不会走到那一步。已把 `markUploaded` 的 `imageKey` 改成可空（A15），photo-only 也自增计数，并写了「第 31 次返回 429」的断言。
4. **`qrcode` 的 node 入口会把 `pngjs` / `fs` 拖进 Worker 包**：`lib/index.js` → `lib/server.js` → `renderer/png.js`（pngjs + zlib + stream）与 `renderer/svg.js` 的 `require('fs')`。已改为深引 `lib/core/qrcode.js` + `lib/renderer/svg-tag.js`（已核对 `svg-tag.js` 只依赖 `./utils`，`render` 同步返回字符串；`qrcode/package.json` 无 `exports` 字段，深引合法），并补 `types/qrcode-internals.d.ts`。
5. **spec §3.7 的日预算留了「择一」**：已明确选 R2 日计数对象而不是 isolate 内计数——后者在多 isolate 下完全失效，而这是全局预算；同时在注释里写清读-改-写在并发下会少计，作为防跑飞护栏可接受。
6. **保存下来的文件名还是 `.jpg`**：服务端卡片是 WebP，`.jpg` 名字会被部分系统图库拒收。已加 Task B3 给 `buildCardFilename` 加可选 contentType，默认值保持原行为，既有测试一条不改。
7. **`formatSceneTime` 的测试会随文件删除一起消失**：原本只存在于 `tests/components/pointShareCard.test.tsx:218-225`。已在 A4 的 `tests/share/cardHtml.test.ts` 里原样接管，B5 才允许删。
8. **`japanLocator` 的投影测试同理**：已由 A2 的 `tests/share/japanPath.test.ts` 接管（改成相对位置断言，不硬编码 bbox 数值，避免数据更新即失败）。
9. **`pointSharePanelCaption.test.tsx` 桩着即将删除的模块**：`vi.mock('@/components/share/PointShareCard')` 会在删文件后报解析失败。已在 B5 Step 1 先改测试再删文件。
10. **`ShareApiDeps` 加必填字段会连带改 v1 四条路由的全部单测**：`prewarmCard` 已定为可选，vitest 与 next dev 不注入也能建链（A14 有专门一条断言）。
11. **`MapDialogs.tsx` / `useAnitabiMapController.ts` 的行数预算**：已读 `line-budget.allowlist.json`——前者不在册（418 行 / 预算 750），后者在册（883）。本计划两个都不改：`PointSharePanel` 的 props 形状保持不变（`episode` / `scene` / `animeImage` 三个字段留在类型里但不再解构），调用点零改动。
12. **`ctx.waitUntil` 的 this 绑定**：预热直接写 `ctx.waitUntil(...)` 会踩 2026-09-08 的 `Illegal invocation` 事故。已统一走 `lib/share/background.ts` 的 `runShareBackground`，并在 Task A14 的说明里点名 `lib/asset/handlers.ts:114-121` 的事故注释。
13. **本地开发密钥没有落点**：spec 只说了生产已 `wrangler secret put`。已在 File Structure 后补「本地开发如何注入密钥」一节（写变量名与放置位置，不写真实值），并让 `readBrowserRunConfig()` 缺失时整条路由降级为兜底 302 而不是 500。
