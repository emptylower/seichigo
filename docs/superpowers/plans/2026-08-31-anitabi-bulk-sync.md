# Anitabi Bulk 数据包同步恢复 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用上游新出现的全量静态数据包（`/d/g.json` + `/d/g{n}.json`，经海外镜像域 `w.junreimap.com` 分发，不受地理围栏限制）替换已被 403 封死的 `api.anitabi.cn` 逐作品同步，恢复新增作品/点位/图片落库，并回填 4 个原判定为"不可再生"的字段。

**Architecture:** 新增三个模块 —— `source/bulkDecode.ts`（纯解码+归一，上游前端 MD/ND/AD 函数的移植）、`source/bulkClient.ts`（取数）、`sync/bulkWorkflow.ts`（新同步管线，复用现有删除闸门/检查点/镜像对账机制）。入口用环境变量 `ANITABI_SYNC_SOURCE`（默认 `bulk`）在 cron handler 与 CLI 脚本处切换，旧管线原样保留作回滚路径。

**Tech Stack:** TypeScript / Next.js (OpenNext on Cloudflare Workers) / Prisma / Vitest。

---

## 〇、已实测钉死的上游事实（2026-08-31，全部经真实请求验证）

实现者无需重新验证这些事实，但格式断言必须写进解码器（上游改格式时要显式炸掉）：

| # | 事实 | 证据 |
|---|---|---|
| B1 | `api.anitabi.cn` 被 Cloudflare WAF 硬封锁（block 页非 challenge），按客户端 IP 地理位置仅放行中国大陆；换 UA/Referer 无效 | 非大陆出口实测 403 |
| B2 | 上游主站已迁腾讯 EdgeOne（`www.anitabi.cn` CNAME `eo.dnse3.com`），并有海外镜像域 `w.junreimap.com`（Cloudflare 托管，**无地理限制**） | `/domain-rules.js` 明写 `ww.anitabi.cn → w.junreimap.com` 跳转 |
| B3 | 地图前端不再逐作品调 API，而是加载同源静态数据包：`GET /d/g.json`（索引，~2MB）+ `GET /d/g{0..N-1}.json`（分页明细，每页 250 个作品，~4.5MB/页；当前 1518 部 → 7 页） | 两个域名均实测 200；索引 `modified=2026-08-28`，数据新鲜 |
| B4 | 索引点位 id 集合与分页点位 id 集合**完全一致**（双向 0 缺失，g0 页 250 作品 22,401 点位实测）；分页顺序 = 索引顺序按 `pageSize` 切块 | 本地脚本比对 |
| B5 | 点位 `image` 全部为 `/images/points/<bid>/<pid>_<ts>.jpg` 形态（21,821 个无例外，无 query）；新格式经 `img-tc.anitabi.cn` 带 `?plan=h160` 实测 200 | curl 验证 |
| B6 | 分页 theme 形态 `[src, ids[], modified, w, h]`，与我方 `components/map/types.ts` 的 `isValidTheme`（要求 `{src, ids[]}`）兼容 | 代码比对 |
| B7 | 点位行含 `density/mark/folder/uid`（即 spec 判定"不可再生" 5 字段中的 4 个），作品行含 `cat/tags`（原方案要靠 bgm.tv 补） | g0.json 实测解码 |
| B8 | 旧格式图片 URL（无 `_ts` 后缀、带 `?plan=`）在 `img-tc` 仍然 200 —— 换 URL 期间旧镜像不失效 | curl 验证 |

**数据格式（上游前端解码器 MD/ND/AD 的字段表，位置即协议）：**

```
g.json           = [indexRows[], pageSize, datasetModified]
indexRow         = [id, cn, en, title, city, color, cover, fade, cat,
                    geoLat, geoLng, zoom, pointsFlat, abbr, tags, priority, icon, tAbbr]
pointsFlat       = [pid, lat, lng, priority, pid, lat, lng, priority, ...]  // 4 步长展平

g{n}.json        = pageEntry[]
pageEntry        = [id, theme|0, pointRows[], bangumiModified]
theme            = [src, ids[], themeModified, w?, h?]
pointRow         = [id, name, cn, isFolder, mid, uid, image, fid,
                    ep, s, mark, origin, originLink, folder, density]
```

空值语义：上游用 `0` 表示"无此值"（`cn=0`、`origin=0` 等），解码时按"字段缺失"处理。`ep` 可能是 int / string（如 `"PV1"`）/ null；`s` 可能是 `""`。

---

## 一、设计决策（已定，不要在实现中重新讨论）

| # | 决策 | 理由 |
|---|---|---|
| D1 | bulk 基址默认 `https://w.junreimap.com`，环境变量 `ANITABI_BULK_BASE_URL` 可切到 `https://www.anitabi.cn`（EdgeOne）或 mock | 未收录进官方 api.md 的既成事实通道（与 `img-tc` 同性质），必须可一键切换 |
| D2 | 解码遇到任何形状不符**显式抛错、整轮判失败**，绝不静默产出残缺数据 | 上游改格式的第一时间要在 `AnitabiSyncRun.errorSummary` 里看到，而不是把库写坏 |
| D3 | 图片路径归一：`/images/X` → `https://image.anitabi.cn/X`（去掉 `/images` 前缀，canonical 身份 host） | 与 `imageNormalize.normalizeAnitabiMirrorUrl` 既有归一规则一致，R2 mirror key 零漂移；投递时由已落地的 `resolveAnitabiDeliveryUrl()` 换成 `img-tc` |
| D4 | **现在可再生**（bulk 提供，有值即写）：点位 `density/mark/folder/uid`、meta `themeJson`、作品 `cat`、`tags`（仅非空数组才写，不许清空）。**继续冻结**（bulk 不提供，永不写 update）：点位 `reviewUid/originUrl`、作品 `description`、meta `customEpNamesJson/logsJson/removedPointsJson/completenessJson` | "有新值才写"原则不变；originUrl 库里 46% 有值，bulk 只有 `mid`，不合成不覆盖 |
| D5 | `pointsLength`/`imagesLength` 改为**由合并后点位实算**（`points.length` / 有 image 的数量），不再依赖上游自报 | bulk 的分页就是权威全集（B4） |
| D6 | 完整性闸门：该作品索引里的点位 id 必须全部出现在分页数据中，否则 defer（沿用现有 deferredReasons/检查点回拨机制）；删除比例闸门原样沿用 | B4 说明正常情况恒成立，不成立即文件被截断/上游异常 |
| D7 | isFolder 行照常入库（索引同样收录它们，B4 的 id 集合含 folder 行），不做特殊剔除 | 保持计数一致，避免完整性闸门自相矛盾 |
| D8 | 索引里有而库里没有的作品 → **create**（新作品发现回来了）；库里有而索引没有的作品 → **不动**（不删、不改 mapEnabled，数据冻结） | 索引只含"有巡礼数据"的作品（1518 vs 库内 7933），缺席≠删除 |
| D9 | 数据集游标 `bulkDatasetModified`（AnitabiSourceCursor）：delta/dryRun 模式下索引 `modified` 未前进则整轮短路（1 个请求收工）。游标**只在** `!hasMore && deferredCount===0 && 零硬失败` 时推进，否则下轮重拉重试（页文件只有 ~8 个请求，重拉便宜） | 防止"游标推进 + 单作品 defer"导致的永久丢失——这是旧管线四次自锁教训的延续 |
| D10 | 作品 `en` 字段暂不写 `titleEnglish`（该列属 anilist enrichment 管线），首版跳过 | 避免两条管线互相覆盖；后续要用另立计划 |
| D11 | 旧管线 `runAnitabiSync` 与 `workflow.ts` **一行业务逻辑都不改**（只加 `export`），切换靠 `ANITABI_SYNC_SOURCE` 环境变量，回滚 = 改环境变量 | 最小风险面 |
| D12 | 首次全量回填会把大部分点位 `image` 换成带 `_ts` 的新 URL → mirror 对账会标记重镜像（一次性 churn，约 2-3 万张）。可接受：旧 URL 仍 200（B8），imageServe 未命中时按需回源，不需要专项迁移 | 见 Task 12 rollout 说明 |

**礼貌性约束（继承自 spec 的执行纪律）：** 页文件抓取之间保持 `ANITABI_SYNC_MIN_INTERVAL_MS`（默认 1s）间隔；探测只跑一次不循环；本地调试一律打 mock，不打真上游。

---

## 二、文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/anitabi/source/bulkDecode.ts` | Create | 纯函数：索引/分页解码、资产 URL 归一、合并归一化。无 IO、无 env |
| `lib/anitabi/source/bulkClient.ts` | Create | 取数：`fetchBulkIndex` / `fetchBulkPage`、`getAnitabiBulkBase()`（读 env） |
| `lib/anitabi/sync/bulkWorkflow.ts` | Create | `runAnitabiBulkSync()`：短路→分页遍历→逐作品 apply（闸门/检查点/镜像对账）→游标推进 |
| `lib/anitabi/sync/workflow.ts` | Modify | 仅给 6 个内部函数加 `export`（供 bulkWorkflow 复用），零逻辑改动 |
| `lib/anitabi/handlers/cron.ts` | Modify | 按 `ANITABI_SYNC_SOURCE` 分派两条管线 |
| `scripts/anitabi-sync.ts` | Modify | 同上 |
| `scripts/anitabi-mock-upstream.mjs` | Modify | 增加 `/d/g.json`、`/d/g0.json` 两条 mock 路由（positional 编码） |
| `workers/anitabi-egress-probe/src/index.ts` | Modify | 加 bulk 探测目标 ×2，`CRITERIA_VERSION` 提到 `v5` |
| `.env.example` | Modify | 增 `ANITABI_BULK_BASE_URL` / `ANITABI_SYNC_SOURCE` |
| `docs/anitabi-recovery-spec.md` | Modify | 增补 2026-08-31 修订记录（B1-B8 + 本计划链接） |
| `tests/anitabi/bulkDecode.test.ts` | Test | 解码/归一单测 |
| `tests/anitabi/bulkWorkflow.test.ts` | Test | 管线行为单测（mock client + prisma stub，沿用 `syncGuards.test.ts` 惯例） |

行数预算：每文件 <800 行（`scripts/check-line-budget.mjs` 强制），上述拆分下每个新文件预计 200-450 行，安全。

---

## 三、任务

### Task 1: bulkDecode —— 索引解码与资产 URL 归一

**Files:**
- Create: `lib/anitabi/source/bulkDecode.ts`
- Test: `tests/anitabi/bulkDecode.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/anitabi/bulkDecode.test.ts
import { describe, expect, it } from 'vitest'
import {
  BulkDecodeError,
  canonicalizeBulkAssetUrl,
  decodeBulkIndex,
} from '@/lib/anitabi/source/bulkDecode'

/** 按 B 节字段表构造的最小真实形状索引行。 */
function makeIndexRow(id: number) {
  return [
    id, '再见，拉拉', 'Goodbye!rara', 'さよならララ', '大津市', '#c72d38',
    'http://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg', 8, 'TV',
    34.978141, 135.905931, 19.2,
    ['1zqx9nu', 35.005218, 135.863706, 682, 'gt9wos1', 34.991532, 135.895657, 3],
    0, ['催泪', '日常'], 999, 0, 0,
  ]
}

describe('canonicalizeBulkAssetUrl', () => {
  it('strips /images prefix onto canonical host', () => {
    expect(canonicalizeBulkAssetUrl('/images/points/495291/1zqx9nu_1751348772406.jpg'))
      .toBe('https://image.anitabi.cn/points/495291/1zqx9nu_1751348772406.jpg')
  })
  it('upgrades http to https and passes absolute urls through', () => {
    expect(canonicalizeBulkAssetUrl('http://bgm-api.anitabi.cn/pic/a.jpg'))
      .toBe('https://bgm-api.anitabi.cn/pic/a.jpg')
  })
  it('treats 0 / empty as absent', () => {
    expect(canonicalizeBulkAssetUrl(0)).toBeNull()
    expect(canonicalizeBulkAssetUrl('')).toBeNull()
  })
})

describe('decodeBulkIndex', () => {
  it('decodes rows with 4-stride point refs', () => {
    const idx = decodeBulkIndex([[makeIndexRow(495291)], 250, 1787937388398])
    expect(idx.modified).toBe(1787937388398)
    expect(idx.pageSize).toBe(250)
    expect(idx.pageCount).toBe(1)
    const e = idx.entries[0]!
    expect(e.id).toBe(495291)
    expect(e.cn).toBe('再见，拉拉')
    expect(e.cat).toBe('TV')
    expect(e.tags).toEqual(['催泪', '日常'])
    expect(e.cover).toBe('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg')
    expect(e.points).toEqual([
      { id: '1zqx9nu', geoLat: 35.005218, geoLng: 135.863706 },
      { id: 'gt9wos1', geoLat: 34.991532, geoLng: 135.895657 },
    ])
  })
  it('throws BulkDecodeError on malformed payloads', () => {
    expect(() => decodeBulkIndex(null)).toThrow(BulkDecodeError)
    expect(() => decodeBulkIndex([[], 250, 1])).toThrow(BulkDecodeError)
    // 点位展平数组长度必须是 4 的倍数 —— 截断文件的典型症状
    const bad = makeIndexRow(1); (bad[12] as unknown[]).push('extra')
    expect(() => decodeBulkIndex([[bad], 250, 1787937388398])).toThrow(BulkDecodeError)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/anitabi/bulkDecode.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/anitabi/source/bulkDecode'`

- [ ] **Step 3: 实现**

```ts
// lib/anitabi/source/bulkDecode.ts
import { normalizeText, toNumberOrNull } from '@/lib/anitabi/utils'

/**
 * 上游 bulk 数据集解码器。
 *
 * 数据来源是地图前端加载的同源静态文件（未收录进官方 api.md 的既成事实通道，
 * 与 img-tc 同性质；分发域见 bulkClient.ts）：
 *   GET {base}/d/g.json     索引：[indexRows, pageSize, datasetModified]
 *   GET {base}/d/g{n}.json  第 n 页明细，按索引顺序每 pageSize 个作品一页
 *
 * 本文件是上游前端解码函数（w.junreimap.com 构建产物中的 MD/ND/AD）的移植，
 * **字段位置即协议**。上游用 0 表示"无此值"。
 * 任何形状不符都必须抛 BulkDecodeError —— 宁可整轮同步失败，
 * 也不能把静默解出的残缺数据写库（点位携带不可再生字段）。
 */

export class BulkDecodeError extends Error {}

function req(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new BulkDecodeError(`[anitabi/bulk] ${msg}`)
}

/**
 * bulk 资产路径归一到 canonical 身份 host。
 * `/images/X` → `https://image.anitabi.cn/X`（去前缀规则与 imageNormalize.
 * normalizeAnitabiMirrorUrl 一致，R2 mirror key 依赖该稳定性）；
 * 实际投递 host 由 resolveAnitabiDeliveryUrl() 在请求时决定，这里不管。
 */
export function canonicalizeBulkAssetUrl(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return text.replace(/^http:\/\//i, 'https://')
  if (text.startsWith('//')) return `https:${text}`
  if (text.startsWith('/images/')) return `https://image.anitabi.cn${text.slice('/images'.length)}`
  if (text.startsWith('/')) return `https://image.anitabi.cn${text}`
  return text
}

export type BulkIndexPointRef = { id: string; geoLat: number | null; geoLng: number | null }

export type BulkIndexEntry = {
  id: number
  cn: string | null
  en: string | null
  title: string | null
  city: string | null
  color: string | null
  cover: string | null
  cat: string | null
  geoLat: number | null
  geoLng: number | null
  zoom: number | null
  tags: string[]
  points: BulkIndexPointRef[]
}

export type BulkIndex = {
  modified: number
  pageSize: number
  pageCount: number
  entries: BulkIndexEntry[]
}

// indexRow = [id, cn, en, title, city, color, cover, fade, cat,
//             geoLat, geoLng, zoom, pointsFlat, abbr, tags, priority, icon, tAbbr]
export function decodeBulkIndex(raw: unknown): BulkIndex {
  req(Array.isArray(raw) && raw.length >= 3, 'index: expected [rows, pageSize, modified]')
  const [rowsRaw, pageSizeRaw, modifiedRaw] = raw as unknown[]
  req(Array.isArray(rowsRaw) && rowsRaw.length > 0, 'index: rows must be a non-empty array')
  const pageSize = Number(pageSizeRaw)
  const modified = Number(modifiedRaw)
  req(Number.isInteger(pageSize) && pageSize > 0, 'index: invalid pageSize')
  req(Number.isFinite(modified) && modified > 0, 'index: invalid modified')

  const entries = (rowsRaw as unknown[]).map((rowRaw, i) => {
    req(Array.isArray(rowRaw) && rowRaw.length >= 13, `index row ${i}: too short`)
    const r = rowRaw as unknown[]
    const id = Number(r[0])
    req(Number.isInteger(id) && id > 0, `index row ${i}: invalid id`)
    const flat = r[12]
    req(
      Array.isArray(flat) && flat.length % 4 === 0,
      `index row ${i} (id ${id}): points array length must be a multiple of 4`,
    )
    const points: BulkIndexPointRef[] = []
    for (let k = 0; k < flat.length; k += 4) {
      const pid = normalizeText(flat[k])
      req(pid, `index row ${i} (id ${id}): empty point id at offset ${k}`)
      points.push({ id: pid, geoLat: toNumberOrNull(flat[k + 1]), geoLng: toNumberOrNull(flat[k + 2]) })
    }
    const tagsRaw = r[14]
    return {
      id,
      cn: normalizeText(r[1]) || null,
      en: normalizeText(r[2]) || null,
      title: normalizeText(r[3]) || null,
      city: normalizeText(r[4]) || null,
      color: normalizeText(r[5]) || null,
      cover: canonicalizeBulkAssetUrl(r[6]),
      cat: normalizeText(r[8]) || null,
      geoLat: toNumberOrNull(r[9]),
      geoLng: toNumberOrNull(r[10]),
      zoom: toNumberOrNull(r[11]),
      tags: Array.isArray(tagsRaw)
        ? (tagsRaw as unknown[]).map((t) => normalizeText(t)).filter(Boolean).slice(0, 200)
        : [],
      points,
    }
  })

  return { modified, pageSize, pageCount: Math.ceil(entries.length / pageSize), entries }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/anitabi/bulkDecode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/source/bulkDecode.ts tests/anitabi/bulkDecode.test.ts
git commit -m "feat(anitabi): bulk 数据集索引解码器（上游 MD 函数移植）"
```

---

### Task 2: bulkDecode —— 分页解码

**Files:**
- Modify: `lib/anitabi/source/bulkDecode.ts`（追加）
- Test: `tests/anitabi/bulkDecode.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
// tests/anitabi/bulkDecode.test.ts 追加
import { decodeBulkPage } from '@/lib/anitabi/source/bulkDecode'

/** 分页点位行，字段位置见计划 B 节。cn=0、origin=0 表示上游"无此值"。 */
function makePagePoint(id: string, over: Record<number, unknown> = {}) {
  const row: unknown[] = [
    id, '大津自行车道线', 0, 0, 0, 1127,
    `/images/points/495291/${id}_1751348772406.jpg`, 0,
    'PV1', '', '画面前景几栋高楼位于此处', 0, 0, '航拍', 682,
  ]
  for (const [k, v] of Object.entries(over)) row[Number(k)] = v
  return row
}

describe('decodeBulkPage', () => {
  it('decodes entries with theme and points', () => {
    const page = decodeBulkPage([[
      495291,
      ['/images/ptheme/495291_100_76.webp?v=hqozf', ['1zqx9nu'], 1787934423695, 100, 76],
      [makePagePoint('1zqx9nu')],
      1787934434449,
    ]])
    const e = page[0]!
    expect(e.id).toBe(495291)
    expect(e.modified).toBe(1787934434449)
    expect(e.theme).toEqual({
      src: 'https://image.anitabi.cn/ptheme/495291_100_76.webp?v=hqozf',
      ids: ['1zqx9nu'], modified: 1787934423695, w: 100, h: 76,
    })
    const p = e.points[0]!
    expect(p).toMatchObject({
      id: '1zqx9nu',
      name: '大津自行车道线',
      cn: undefined,               // 0 → 缺失
      isFolder: false,
      uid: '1127',                 // 数值 uid 统一成字符串
      image: 'https://image.anitabi.cn/points/495291/1zqx9nu_1751348772406.jpg',
      ep: 'PV1',
      s: undefined,                // "" → 缺失
      mark: '画面前景几栋高楼位于此处',
      folder: '航拍',
      density: 682,
    })
  })
  it('theme=0 decodes to null; ep 数值保留（含 0）', () => {
    const page = decodeBulkPage([[1, 0, [makePagePoint('a1', { 8: 0 })], 5]])
    expect(page[0]!.theme).toBeNull()
    expect(page[0]!.points[0]!.ep).toBe('0')
  })
  it('throws on malformed entries', () => {
    expect(() => decodeBulkPage('nope')).toThrow(BulkDecodeError)
    expect(() => decodeBulkPage([[1, 0, 'not-points', 5]])).toThrow(BulkDecodeError)
    expect(() => decodeBulkPage([[1, 0, [['', 'x']], 5]])).toThrow(BulkDecodeError)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/anitabi/bulkDecode.test.ts`
Expected: FAIL —— `decodeBulkPage is not exported`

- [ ] **Step 3: 实现（追加到 bulkDecode.ts）**

```ts
export type BulkTheme = {
  src: string
  ids: string[]
  modified?: number
  w?: number
  h?: number
}

/**
 * 分页点位。undefined 一律表示"上游未提供该值"（原始值为 0 / 空串），
 * 写库时对不可再生字段必须整个跳过而不是写 null。
 */
export type BulkPagePoint = {
  id: string
  name?: string
  cn?: string
  isFolder: boolean
  uid?: string
  image?: string
  ep?: string
  s?: string
  mark?: string
  origin?: string
  originLink?: string
  folder?: string
  density?: number
}

export type BulkPageEntry = {
  id: number
  modified: number
  theme: BulkTheme | null
  points: BulkPagePoint[]
}

function textOrUndef(v: unknown): string | undefined {
  const t = normalizeText(v)
  return t || undefined
}

// pointRow = [id, name, cn, isFolder, mid, uid, image, fid,
//             ep, s, mark, origin, originLink, folder, density]
// mid/fid 无对应库列，跳过（originUrl 保持冻结，不由 mid 合成）。
function decodeBulkPoint(raw: unknown, ctx: string): BulkPagePoint {
  req(Array.isArray(raw) && raw.length >= 15, `${ctx}: point row too short`)
  const r = raw as unknown[]
  const id = normalizeText(r[0])
  req(id, `${ctx}: empty point id`)
  const epRaw = r[8]
  const density = toNumberOrNull(r[14])
  return {
    id,
    name: textOrUndef(r[1]),
    cn: textOrUndef(r[2]),
    isFolder: Boolean(r[3]),
    // uid=0 表示缺失（上游 `a||void 0` 同语义），不能解成 '0'
    uid: r[5] ? normalizeText(String(r[5])) || undefined : undefined,
    image: canonicalizeBulkAssetUrl(r[6]) ?? undefined,
    // ep 语义上 0 是合法值（上游 `l||l===0` 同样保留 0）
    ep: epRaw || epRaw === 0 ? textOrUndef(String(epRaw)) : undefined,
    s: textOrUndef(r[9]),
    mark: textOrUndef(r[10]),
    origin: textOrUndef(r[11]),
    originLink: textOrUndef(r[12]),
    folder: textOrUndef(r[13]),
    density: density != null && Number.isInteger(density) && density > 0 ? density : undefined,
  }
}

// pageEntry = [id, theme|0, pointRows, modified]; theme = [src, ids, modified, w?, h?]
export function decodeBulkPage(raw: unknown): BulkPageEntry[] {
  req(Array.isArray(raw), 'page: expected an array of entries')
  return (raw as unknown[]).map((entryRaw, i) => {
    req(Array.isArray(entryRaw) && entryRaw.length >= 4, `page entry ${i}: too short`)
    const [idRaw, themeRaw, pointsRaw, modifiedRaw] = entryRaw as unknown[]
    const id = Number(idRaw)
    const modified = Number(modifiedRaw)
    req(Number.isInteger(id) && id > 0, `page entry ${i}: invalid id`)
    req(Number.isFinite(modified) && modified > 0, `page entry ${i} (id ${id}): invalid modified`)
    req(Array.isArray(pointsRaw), `page entry ${i} (id ${id}): points must be an array`)

    let theme: BulkTheme | null = null
    if (themeRaw) {
      req(Array.isArray(themeRaw) && themeRaw.length >= 3, `page entry ${i} (id ${id}): invalid theme`)
      const t = themeRaw as unknown[]
      const src = canonicalizeBulkAssetUrl(t[0])
      const ids = Array.isArray(t[1])
        ? (t[1] as unknown[]).map((x) => normalizeText(x)).filter(Boolean)
        : []
      if (src && ids.length > 0) {
        theme = {
          src,
          ids,
          ...(toNumberOrNull(t[2]) != null ? { modified: Number(t[2]) } : {}),
          ...(toNumberOrNull(t[3]) ? { w: Number(t[3]) } : {}),
          ...(toNumberOrNull(t[4]) ? { h: Number(t[4]) } : {}),
        }
      }
    }

    const points = (pointsRaw as unknown[]).map((p, k) =>
      decodeBulkPoint(p, `page entry ${i} (id ${id}) point ${k}`),
    )
    return { id, modified, theme, points }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/anitabi/bulkDecode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/source/bulkDecode.ts tests/anitabi/bulkDecode.test.ts
git commit -m "feat(anitabi): bulk 分页解码器（上游 ND/AD 函数移植）"
```

---

### Task 3: bulkDecode —— 索引/分页合并归一化

**Files:**
- Modify: `lib/anitabi/source/bulkDecode.ts`（追加）
- Test: `tests/anitabi/bulkDecode.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
// tests/anitabi/bulkDecode.test.ts 追加
import { normalizeBulkBangumi, normalizePointsFromBulk } from '@/lib/anitabi/source/bulkDecode'

describe('normalizePointsFromBulk', () => {
  it('merges geo from index refs and scopes point ids', () => {
    const idx = decodeBulkIndex([[makeIndexRow(495291)], 250, 1787937388398]).entries[0]!
    const page = decodeBulkPage([[495291, 0, [makePagePoint('1zqx9nu')], 5]])[0]!
    const pts = normalizePointsFromBulk(idx, page)
    expect(pts).toHaveLength(1)
    expect(pts[0]).toMatchObject({
      id: '495291:1zqx9nu',
      bangumiId: 495291,
      name: '大津自行车道线',
      nameZh: null,
      geoLat: 35.005218,
      geoLng: 135.863706,
      ep: 'PV1',
      s: null,
      image: 'https://image.anitabi.cn/points/495291/1zqx9nu_1751348772406.jpg',
      origin: null,
      originLink: null,
      density: 682,
      mark: '画面前景几栋高楼位于此处',
      folder: '航拍',
      uid: '1127',
    })
    // 冻结字段绝不产出键（写库方据此跳过）
    expect('originUrl' in pts[0]!).toBe(false)
    expect('reviewUid' in pts[0]!).toBe(false)
  })
})

describe('normalizeBulkBangumi', () => {
  it('builds bangumi fields from index entry + page modified', () => {
    const idx = decodeBulkIndex([[makeIndexRow(495291)], 250, 1787937388398]).entries[0]!
    const b = normalizeBulkBangumi(idx, 1787934434449)
    expect(b).toMatchObject({
      id: 495291,
      titleZh: '再见，拉拉',
      titleJaRaw: 'さよならララ',
      cat: 'TV',
      tags: ['催泪', '日常'],
      city: '大津市',
      color: '#c72d38',
      geoLat: 34.978141,
      geoLng: 135.905931,
      zoom: 19.2,
      sourceModifiedMs: BigInt(1787934434449),
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/anitabi/bulkDecode.test.ts`
Expected: FAIL —— 函数未导出

- [ ] **Step 3: 实现（追加到 bulkDecode.ts）**

```ts
/**
 * 合并后的归一化点位。
 * 与 source/normalize.ts 的 NormalizedPoint 同构，但冻结字段（originUrl/reviewUid）
 * 的键**永远不产出** —— bulk 数据没有它们的来源，写库方按"键不存在则跳过"处理。
 */
export type BulkNormalizedPoint = {
  id: string
  bangumiId: number
  name: string
  nameZh: string | null
  geoLat: number | null
  geoLng: number | null
  ep: string | null
  s: string | null
  image: string | null
  origin: string | null
  originLink: string | null
  density?: number
  mark?: string
  folder?: string
  uid?: string
}

export type BulkNormalizedBangumi = {
  id: number
  titleZh: string
  titleJaRaw: string
  cat: string | null
  cover: string | null
  color: string | null
  city: string | null
  tags: string[]
  geoLat: number | null
  geoLng: number | null
  zoom: number | null
  sourceModifiedMs: bigint
}

export function normalizeBulkBangumi(entry: BulkIndexEntry, pageModified: number): BulkNormalizedBangumi {
  return {
    id: entry.id,
    titleZh: entry.cn || entry.title || `#${entry.id}`,
    titleJaRaw: entry.title || entry.cn || `#${entry.id}`,
    cat: entry.cat,
    cover: entry.cover,
    color: entry.color,
    city: entry.city,
    tags: entry.tags,
    geoLat: entry.geoLat,
    geoLng: entry.geoLng,
    zoom: entry.zoom,
    sourceModifiedMs: BigInt(pageModified),
  }
}

/** 点位 id 与旧管线一致的作用域形式：`${bangumiId}:${rawId}`。 */
export function normalizePointsFromBulk(
  entry: BulkIndexEntry,
  page: BulkPageEntry,
): BulkNormalizedPoint[] {
  const geoById = new Map(entry.points.map((p) => [p.id, p]))
  return page.points.map((p) => {
    const ref = geoById.get(p.id)
    return {
      id: `${entry.id}:${p.id}`,
      bangumiId: entry.id,
      name: p.name || p.id,
      nameZh: p.cn ?? null,
      geoLat: ref?.geoLat ?? null,
      geoLng: ref?.geoLng ?? null,
      ep: p.ep ?? null,
      s: p.s ?? null,
      image: p.image ?? null,
      origin: p.origin ?? null,
      originLink: p.originLink ?? null,
      ...(p.density !== undefined ? { density: p.density } : {}),
      ...(p.mark !== undefined ? { mark: p.mark } : {}),
      ...(p.folder !== undefined ? { folder: p.folder } : {}),
      ...(p.uid !== undefined ? { uid: p.uid } : {}),
    }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/anitabi/bulkDecode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/source/bulkDecode.ts tests/anitabi/bulkDecode.test.ts
git commit -m "feat(anitabi): bulk 索引/分页合并归一化"
```

---

### Task 4: bulkClient —— 取数层

**Files:**
- Create: `lib/anitabi/source/bulkClient.ts`
- Modify: `.env.example`

- [ ] **Step 1: 实现（薄封装，逻辑都在被测过的 decode 层，本文件不单独立测）**

```ts
// lib/anitabi/source/bulkClient.ts
import { fetchJsonWithRetry } from '@/lib/anitabi/source/client'
import {
  decodeBulkIndex,
  decodeBulkPage,
  type BulkIndex,
  type BulkPageEntry,
} from '@/lib/anitabi/source/bulkDecode'

/**
 * bulk 数据集分发域。
 * 默认 w.junreimap.com（上游海外镜像，Cloudflare 托管，不在 api.anitabi.cn
 * 的地理围栏内）；可切 https://www.anitabi.cn（EdgeOne）。
 * 这是未收录进官方 api.md 的既成事实通道（与 img-tc 同性质），
 * 上游调整时改这个环境变量即可，无需改代码。
 */
export function getAnitabiBulkBase(): string {
  return String(process.env.ANITABI_BULK_BASE_URL || 'https://w.junreimap.com').replace(/\/+$/, '')
}

export async function fetchBulkIndex(base: string): Promise<BulkIndex> {
  const raw = await fetchJsonWithRetry<unknown>(`${base}/d/g.json`)
  if (raw == null) throw new Error(`bulk index fetch returned empty: ${base}/d/g.json`)
  return decodeBulkIndex(raw)
}

export async function fetchBulkPage(base: string, page: number): Promise<BulkPageEntry[]> {
  const raw = await fetchJsonWithRetry<unknown>(`${base}/d/g${page}.json`)
  if (raw == null) throw new Error(`bulk page fetch returned empty: ${base}/d/g${page}.json`)
  return decodeBulkPage(raw)
}
```

- [ ] **Step 2: `.env.example` 在 `ANITABI_API_BASE_URL` 一节旁追加**

```bash
# Bulk 数据集分发域（默认海外镜像 w.junreimap.com；可切 https://www.anitabi.cn）
# ANITABI_BULK_BASE_URL=https://w.junreimap.com
# 同步数据源：bulk（默认，静态数据包）| api（旧逐作品管线，仅回滚用）
# ANITABI_SYNC_SOURCE=bulk
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add lib/anitabi/source/bulkClient.ts .env.example
git commit -m "feat(anitabi): bulk 取数层与环境变量"
```

---

### Task 5: workflow.ts 导出共享助手（零逻辑改动）

**Files:**
- Modify: `lib/anitabi/sync/workflow.ts`

- [ ] **Step 1: 给以下 6 个既有函数加 `export` 关键字，不改任何函数体**

`nowVersion`（workflow.ts:19）、`getSyncMinIntervalMs`（:39）、`getMaxPointDeletionRatio`（:54）、`getIncompleteRetryBackoffMs`（:65）、`getSyncMaxRuntimeMs`（:80）、`isMirrorReconcileEnabled`（:87）、`upsertCursor`（:91）。

- [ ] **Step 2: 验证既有测试不回归**

Run: `npx vitest run tests/anitabi/syncGuards.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/anitabi/sync/workflow.ts
git commit -m "refactor(anitabi): 导出同步共享助手供 bulk 管线复用"
```

---

### Task 6: bulkWorkflow —— 新同步管线

**Files:**
- Create: `lib/anitabi/sync/bulkWorkflow.ts`
- Test: `tests/anitabi/bulkWorkflow.test.ts`

- [ ] **Step 1: 写失败测试（沿用 `syncGuards.test.ts` 的 mock 惯例）**

```ts
// tests/anitabi/bulkWorkflow.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const mocks = {
  fetchBulkIndex: vi.fn(),
  fetchBulkPage: vi.fn(),
  enqueueMapTranslationTasksForBangumiIds: vi.fn(),
}

vi.mock('@/lib/anitabi/source/bulkClient', () => ({
  getAnitabiBulkBase: () => 'https://bulk.test',
  fetchBulkIndex: mocks.fetchBulkIndex,
  fetchBulkPage: mocks.fetchBulkPage,
}))
vi.mock('@/lib/translation/mapTaskEnqueue', () => ({
  enqueueMapTranslationTasksForBangumiIds: mocks.enqueueMapTranslationTasksForBangumiIds,
}))

// —— fixtures：解码后形态直接喂（decode 层已单独测过）——
function bulkIndex(modified: number, pointIds: string[] = ['p0']) {
  return {
    modified,
    pageSize: 250,
    pageCount: 1,
    entries: [{
      id: 1, cn: 'Work', en: null, title: 'ワーク', city: null, color: '#fff',
      cover: 'https://image.anitabi.cn/bangumi/1.jpg', cat: 'TV', tags: ['tag1'],
      geoLat: 35, geoLng: 139, zoom: 10,
      points: pointIds.map((id) => ({ id, geoLat: 35, geoLng: 139 })),
    }],
  }
}
function bulkPage(modified: number, pointIds: string[] = ['p0']) {
  return [{
    id: 1, modified,
    theme: { src: 'https://image.anitabi.cn/ptheme/1.webp', ids: pointIds },
    points: pointIds.map((id) => ({
      id, name: `P${id}`, isFolder: false,
      image: `https://image.anitabi.cn/points/1/${id}_123.jpg`,
      density: 5, folder: 'f', uid: '9', mark: 'm',
    })),
  }]
}

function createDeps(input: {
  knownSourceModifiedMs?: bigint | null
  cursorValue?: string | null
  existingPointRows?: Array<{ id: string; image: string | null }>
}) {
  const calls = {
    bangumiUpsert: vi.fn().mockResolvedValue({}),
    metaUpsert: vi.fn().mockResolvedValue({}),
    pointCreateMany: vi.fn().mockResolvedValue({ count: 0 }),
    pointUpdate: vi.fn().mockResolvedValue({}),
    pointDeleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    cursorUpsert: vi.fn().mockResolvedValue({}),
    runUpdate: vi.fn().mockResolvedValue({}),
  }
  const deps = {
    prisma: {
      anitabiSyncRun: { create: vi.fn().mockResolvedValue({ id: 'run-1' }), update: calls.runUpdate },
      anitabiBangumi: {
        findMany: vi.fn().mockResolvedValue(
          input.knownSourceModifiedMs === undefined
            ? []
            : [{ id: 1, sourceModifiedMs: input.knownSourceModifiedMs }],
        ),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: calls.bangumiUpsert,
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumiMeta: { upsert: calls.metaUpsert, update: vi.fn().mockResolvedValue({}) },
      anitabiPoint: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue(input.existingPointRows ?? []),
        createMany: calls.pointCreateMany,
        update: calls.pointUpdate,
        deleteMany: calls.pointDeleteMany,
      },
      anitabiSourceCursor: {
        findUnique: vi.fn().mockResolvedValue(
          input.cursorValue != null ? { value: input.cursorValue } : null,
        ),
        upsert: calls.cursorUpsert,
      },
      $transaction: vi.fn().mockImplementation(async (i: unknown) =>
        typeof i === 'function' ? (i as (tx: unknown) => unknown)({}) : i,
      ),
    } as unknown as AnitabiApiDeps['prisma'],
    getSession: async () => null,
    now: () => new Date('2026-08-31T00:00:00.000Z'),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => '',
  } as unknown as AnitabiApiDeps
  return { deps, calls }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
  process.env.ANITABI_SYNC_MIN_INTERVAL_MS = '0'
})

describe('runAnitabiBulkSync', () => {
  it('delta 短路：数据集 modified 未前进时只打索引、不打分页、不写库', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(1000))
    const { deps, calls } = createDeps({ cursorValue: '1000' })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('ok')
    expect(report.scanned).toBe(0)
    expect(mocks.fetchBulkPage).not.toHaveBeenCalled()
    expect(calls.bangumiUpsert).not.toHaveBeenCalled()
  })

  it('新作品创建 + 可再生字段回填 + 游标推进', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(2000))
    mocks.fetchBulkPage.mockResolvedValue(bulkPage(1900))
    const { deps, calls } = createDeps({ cursorValue: '1000' })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('ok')
    expect(report.changed).toBe(1)
    // 作品 upsert 带上 cat/tags
    const up = calls.bangumiUpsert.mock.calls[0]![0]
    expect(up.update.cat).toBe('TV')
    expect(up.update.tags).toEqual(['tag1'])
    // meta 带实算计数与 themeJson
    const meta = calls.metaUpsert.mock.calls[0]![0]
    expect(meta.update.pointsLength).toBe(1)
    expect(meta.update.imagesLength).toBe(1)
    expect(meta.update.themeJson).toMatchObject({ src: expect.stringContaining('ptheme'), ids: ['p0'] })
    // 新点位含回填字段、不含冻结字段
    const created = calls.pointCreateMany.mock.calls[0]![0].data[0]
    expect(created).toMatchObject({ id: '1:p0', density: 5, folder: 'f', uid: '9', mark: 'm' })
    expect('reviewUid' in created).toBe(false)
    expect('originUrl' in created).toBe(false)
    // 全部收敛 → 数据集游标推进到 2000
    const cursorCalls = calls.cursorUpsert.mock.calls.map((c) => c[0])
    expect(cursorCalls.some((c) => c.where.sourceName === 'bulkDatasetModified'
      && c.update.value === '2000')).toBe(true)
  })

  it('作品级 modified 未变则跳过写库', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(2000))
    mocks.fetchBulkPage.mockResolvedValue(bulkPage(1900))
    const { deps, calls } = createDeps({ cursorValue: '1000', knownSourceModifiedMs: BigInt(1900) })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.changed).toBe(0)
    expect(calls.bangumiUpsert).not.toHaveBeenCalled()
  })

  it('索引点位 id 在分页缺失 → defer，不删点、游标不推进', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(2000, ['p0', 'p1']))
    mocks.fetchBulkPage.mockResolvedValue(bulkPage(1900, ['p0'])) // p1 缺失
    const { deps, calls } = createDeps({
      cursorValue: '1000',
      existingPointRows: [{ id: '1:p0', image: null }, { id: '1:p1', image: null }],
    })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('ok')
    expect(report.message).toContain('未收敛')
    expect(calls.pointDeleteMany).not.toHaveBeenCalled()
    const cursorCalls = calls.cursorUpsert.mock.calls.map((c) => c[0])
    expect(cursorCalls.some((c) => c.where.sourceName === 'bulkDatasetModified')).toBe(false)
  })

  it('解码/取数抛错 → run 记 failed 且 errorSummary 可见', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockRejectedValue(new Error('[anitabi/bulk] index: rows must be a non-empty array'))
    const { deps, calls } = createDeps({})
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('failed')
    expect(calls.runUpdate.mock.calls.at(-1)![0].data.status).toBe('failed')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/anitabi/bulkWorkflow.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `lib/anitabi/sync/bulkWorkflow.ts`**

```ts
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import type { AnitabiSyncMode, AnitabiSyncReport } from '@/lib/anitabi/types'
import { hashText } from '@/lib/anitabi/utils'
import { HttpStatusError } from '@/lib/anitabi/source/client'
import { fetchBulkIndex, fetchBulkPage, getAnitabiBulkBase } from '@/lib/anitabi/source/bulkClient'
import {
  normalizeBulkBangumi,
  normalizePointsFromBulk,
  type BulkIndexEntry,
  type BulkPageEntry,
} from '@/lib/anitabi/source/bulkDecode'
import {
  getIncompleteRetryBackoffMs,
  getMaxPointDeletionRatio,
  getSyncMaxRuntimeMs,
  getSyncMinIntervalMs,
  isMirrorReconcileEnabled,
  nowVersion,
  upsertCursor,
} from '@/lib/anitabi/sync/workflow'
import {
  pruneMirrorRowsForDeletedPoints,
  reconcileMirrorAfterDiff,
} from '@/lib/anitabi/sync/mirrorReconcile'
import { enqueueMapTranslationTasksForBangumiIds } from '@/lib/translation/mapTaskEnqueue'

/**
 * Bulk 数据包同步管线。
 *
 * 与旧管线（workflow.ts，逐作品打 api.anitabi.cn，已被地理围栏 403 封死）的区别：
 *   - 上游请求从 ~N×2 次收敛为 1（索引）+ pageCount（约 7）次静态文件抓取；
 *   - 新作品发现回归（索引即全量清单）；
 *   - density/mark/folder/uid 与 themeJson 恢复供给（有值即写）；
 *   - reviewUid/originUrl/description 及其余 4 个 meta JSON 字段继续冻结。
 * 删除闸门、检查点滞后提交、defer 机制与旧管线同构 —— 那是四次自锁教训的结晶，
 * 任何"吞异常继续"的新分支都必须调用 defer()。
 */

const BULK_DATASET_CURSOR = 'bulkDatasetModified'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readDatasetCursor(deps: AnitabiApiDeps): Promise<number | null> {
  const row = await deps.prisma.anitabiSourceCursor.findUnique({
    where: { sourceName: BULK_DATASET_CURSOR },
  })
  const value = Number(row?.value)
  return Number.isFinite(value) && value > 0 ? value : null
}

type ApplyResult = { changed: boolean; deferred: boolean }

async function applyBulkBangumi(
  deps: AnitabiApiDeps,
  datasetVersion: string,
  entry: BulkIndexEntry,
  page: BulkPageEntry,
  dryRun: boolean,
): Promise<ApplyResult> {
  const deferredReasons: string[] = []
  const defer = (reason: string) => {
    deferredReasons.push(reason)
  }

  const normalized = normalizeBulkBangumi(entry, page.modified)
  const points = normalizePointsFromBulk(entry, page)

  // 完整性闸门：索引声明的点位 id 必须全部出现在分页里（B4：正常恒成立）。
  // 不成立说明页文件被截断或索引/分页版本错位 —— 保守处理，删除一律不做。
  const pageIdSet = new Set(page.points.map((p) => p.id))
  const missingFromPage = entry.points.filter((p) => !pageIdSet.has(p.id))
  const responseIsComplete = missingFromPage.length === 0
  if (!responseIsComplete) {
    defer(`bulk page missing ${missingFromPage.length} point(s) declared by index`)
  }

  if (dryRun) return { changed: true, deferred: !responseIsComplete }

  const mirrorReconcileEnabled = isMirrorReconcileEnabled()
  const existingBangumi = mirrorReconcileEnabled
    ? await deps.prisma.anitabiBangumi.findUnique({
        where: { id: normalized.id },
        select: { cover: true },
      })
    : null

  const normalizedPoints = points.map((point) => ({
    id: point.id,
    bangumiId: point.bangumiId,
    name: point.name,
    nameZh: point.nameZh,
    geoLat: point.geoLat,
    geoLng: point.geoLng,
    ep: point.ep,
    s: point.s,
    image: point.image,
    origin: point.origin,
    originLink: point.originLink,
    // 可再生回归的 4 个字段：仅上游确实给了值才带键（见 bulkDecode 的 undefined 语义）。
    // originUrl / reviewUid 无 bulk 来源，键永不出现 —— 冻结库内现值。
    ...(point.density !== undefined ? { density: point.density } : {}),
    ...(point.mark !== undefined ? { mark: point.mark } : {}),
    ...(point.folder !== undefined ? { folder: point.folder } : {}),
    ...(point.uid !== undefined ? { uid: point.uid } : {}),
    datasetVersion,
  }))

  const existingPointRows = await deps.prisma.anitabiPoint.findMany({
    where: { bangumiId: normalized.id },
    select: { id: true, image: true },
  })
  const existingPointIdSet = new Set(existingPointRows.map((row) => row.id))
  const existingPointImageMap = new Map(existingPointRows.map((row) => [row.id, row.image]))
  const incomingPointIdSet = new Set(normalizedPoints.map((point) => point.id))
  const staleCandidateIds = existingPointRows
    .map((row) => row.id)
    .filter((id) => !incomingPointIdSet.has(id))

  // 删除闸门与旧管线同构：完整性 + 比例双闸放行才删。
  const deletionRatio =
    existingPointRows.length > 0 ? staleCandidateIds.length / existingPointRows.length : 0
  const deletionRatioSafe = deletionRatio <= getMaxPointDeletionRatio()
  const deletionDeferred = staleCandidateIds.length > 0 && !(responseIsComplete && deletionRatioSafe)
  const stalePointIds = deletionDeferred ? [] : staleCandidateIds
  if (deletionDeferred) {
    defer(`${staleCandidateIds.length} stale point(s) not deleted (ratio ${(deletionRatio * 100).toFixed(1)}%)`)
    console.warn(
      `[anitabi/bulk] refusing to delete ${staleCandidateIds.length} point(s) for bangumi ${normalized.id}; `
        + `complete=${responseIsComplete} ratio=${(deletionRatio * 100).toFixed(1)}%; checkpoint held back`,
    )
  }

  // cat/tags 恢复供给：有值才写，空数组不写（不许清空既有 tags）。
  // description 无来源，update 不碰。cover/color/city 同旧管线：有值才写。
  const renewableBangumiFields = {
    titleZh: normalized.titleZh,
    titleJaRaw: normalized.titleJaRaw,
    ...(normalized.cover != null ? { cover: normalized.cover } : {}),
    ...(normalized.color != null ? { color: normalized.color } : {}),
    ...(normalized.city != null ? { city: normalized.city } : {}),
    ...(normalized.cat != null ? { cat: normalized.cat } : {}),
    ...(normalized.tags.length > 0 ? { tags: normalized.tags } : {}),
    ...(normalized.geoLat != null ? { geoLat: normalized.geoLat } : {}),
    ...(normalized.geoLng != null ? { geoLng: normalized.geoLng } : {}),
    ...(normalized.zoom != null ? { zoom: normalized.zoom } : {}),
    mapEnabled: true,
    datasetVersion,
  }

  await deps.prisma.anitabiBangumi.upsert({
    where: { id: normalized.id },
    create: { id: normalized.id, ...renewableBangumiFields, description: null },
    update: renewableBangumiFields,
  })

  // 计数改为实算（B4：分页即权威全集）。themeJson 恢复供给：形态与
  // components/map/types.ts 的 isValidTheme 兼容（B6），有 theme 才写。
  // 其余 4 个 meta JSON 字段无来源，继续冻结。
  const liteCounts = {
    pointsLength: normalizedPoints.length,
    imagesLength: normalizedPoints.filter((p) => p.image).length,
    ...(page.theme ? { themeJson: page.theme } : {}),
  }
  await deps.prisma.anitabiBangumiMeta.upsert({
    where: { bangumiId: normalized.id },
    create: { bangumiId: normalized.id, ...liteCounts },
    update: liteCounts,
  })

  const newPoints = normalizedPoints.filter((p) => !existingPointIdSet.has(p.id))
  const existingPoints = normalizedPoints.filter((p) => existingPointIdSet.has(p.id))

  if (newPoints.length > 0) {
    await deps.prisma.anitabiPoint.createMany({ data: newPoints })
  }
  // 逐条 update，不包事务（Prisma 5s 事务上限是 2026-06-08 最后一次 delta 的死因）。
  for (const point of existingPoints) {
    const { id, ...data } = point
    await deps.prisma.anitabiPoint.update({ where: { id }, data })
  }

  if (stalePointIds.length > 0) {
    if (mirrorReconcileEnabled) {
      try {
        await deps.prisma.$transaction(async (tx) => {
          await pruneMirrorRowsForDeletedPoints(tx, stalePointIds)
          await tx.anitabiPoint.deleteMany({ where: { id: { in: stalePointIds } } })
        })
      } catch (error) {
        defer('stale point deletion transaction failed')
        console.warn(`[anitabi/bulk] mirror cleanup failed for bangumi ${normalized.id}`, error)
      }
    } else {
      await deps.prisma.anitabiPoint.deleteMany({ where: { id: { in: stalePointIds } } })
    }
  }

  if (mirrorReconcileEnabled) {
    try {
      await reconcileMirrorAfterDiff(deps.prisma, {
        bangumiChanges: [{
          id: normalized.id,
          field: 'cover',
          oldValue: existingBangumi?.cover ?? null,
          newValue: normalized.cover,
        }],
        pointChanges: normalizedPoints.map((point) => ({
          id: point.id,
          field: 'image',
          oldValue: existingPointImageMap.get(point.id) ?? null,
          newValue: point.image,
        })),
      })
    } catch (error) {
      defer('mirror reconciliation failed')
      console.warn(`[anitabi/bulk] mirror reconciliation failed for bangumi ${normalized.id}`, error)
    }
  }

  // 检查点滞后提交（与旧管线同构）：deferredReasons 非空则回拨，且不推进 sourceModifiedMs。
  const syncConverged = deferredReasons.length === 0
  if (!syncConverged) {
    console.warn(
      `[anitabi/bulk] bangumi ${normalized.id} did not converge (${deferredReasons.join('; ')})`,
    )
  }
  await deps.prisma.anitabiBangumiMeta.update({
    where: { bangumiId: normalized.id },
    data: {
      lastCheckedAt: syncConverged
        ? deps.now()
        : new Date(deps.now().getTime() - getIncompleteRetryBackoffMs()),
    },
  })
  if (syncConverged) {
    await deps.prisma.anitabiBangumi.update({
      where: { id: normalized.id },
      data: { sourceModifiedMs: normalized.sourceModifiedMs },
    })
  }

  return { changed: true, deferred: !syncConverged }
}

export async function runAnitabiBulkSync(
  deps: AnitabiApiDeps,
  input: { mode: AnitabiSyncMode },
): Promise<AnitabiSyncReport> {
  const startedAt = deps.now()
  const datasetVersion = nowVersion(startedAt)
  const dryRun = input.mode === 'dryRun'
  const full = input.mode === 'full'

  const run = await deps.prisma.anitabiSyncRun.create({
    data: { mode: `bulk-${input.mode}`, status: 'running', startedAt, datasetVersion },
  })

  try {
    const base = getAnitabiBulkBase()
    const index = await fetchBulkIndex(base)
    const snapshotHash = hashText(JSON.stringify(index.entries.map((e) => e.id)))

    // 数据集级短路：索引 modified 未前进 → 1 个请求收工（delta/dryRun）。
    const cursor = await readDatasetCursor(deps)
    if (!full && cursor != null && cursor >= index.modified) {
      await deps.prisma.anitabiSyncRun.update({
        where: { id: run.id },
        data: { status: 'ok', endedAt: deps.now(), changedCount: 0, sourceSnapshotHash: snapshotHash },
      })
      return {
        runId: run.id, mode: input.mode, status: 'ok',
        datasetVersion: dryRun ? null : datasetVersion,
        scanned: 0, changed: 0, totalCandidates: index.entries.length, hasMore: false,
        message: `数据集未变化（modified=${index.modified}），本轮短路`,
      }
    }

    // 一次性取全库 sourceModifiedMs 与点位计数，页内跳过未变作品。
    const knownRows = await deps.prisma.anitabiBangumi.findMany({
      where: { id: { in: index.entries.map((e) => e.id) } },
      select: { id: true, sourceModifiedMs: true },
    })
    const knownById = new Map(knownRows.map((r) => [r.id, r.sourceModifiedMs]))
    const pointCounts = await deps.prisma.anitabiPoint.groupBy({
      by: ['bangumiId'],
      _count: { _all: true },
    })
    const pointCountMap = new Map(pointCounts.map((row) => [row.bangumiId, row._count._all]))
    const entryById = new Map(index.entries.map((e) => [e.id, e]))

    const maxRuntimeMs = getSyncMaxRuntimeMs()
    const deadlineAt = Date.now() + maxRuntimeMs
    const minIntervalMs = getSyncMinIntervalMs()

    let processedCount = 0
    let changedCount = 0
    let deferredCount = 0
    let stoppedByTimeBudget = false
    const changedBangumiIds = new Set<number>()
    let lastFetchAt = 0

    outer: for (let p = 0; p < index.pageCount; p++) {
      if (Date.now() >= deadlineAt) {
        stoppedByTimeBudget = true
        break
      }
      // 页文件之间保持礼貌间隔（静态文件也不例外 —— 上游对频率敏感）。
      const waitMs = minIntervalMs - (Date.now() - lastFetchAt)
      if (waitMs > 0) await sleep(waitMs)
      lastFetchAt = Date.now()

      const page = await fetchBulkPage(base, p)
      for (const entry of page) {
        if (Date.now() >= deadlineAt) {
          stoppedByTimeBudget = true
          break outer
        }
        const lite = entryById.get(entry.id)
        if (!lite) {
          // 分页出现索引没有的作品 → 版本错位，保守跳过并阻止游标推进。
          deferredCount += 1
          console.warn(`[anitabi/bulk] page ${p} has bangumi ${entry.id} absent from index; skipped`)
          continue
        }
        processedCount += 1

        const knownModified = knownById.get(entry.id)
        const importedPoints = pointCountMap.get(entry.id) ?? 0
        const needsBackfill = lite.points.length > 0 && importedPoints < lite.points.length
        const unchanged =
          !full
          && !needsBackfill
          && knownModified != null
          && BigInt(entry.modified) === knownModified
        if (unchanged) continue

        const result = await applyBulkBangumi(deps, datasetVersion, lite, entry, dryRun)
        if (result.changed) {
          changedCount += 1
          changedBangumiIds.add(entry.id)
        }
        if (result.deferred) deferredCount += 1
      }
    }

    let enqueueSummary: { enqueued: number; updated: number } | null = null
    if (!dryRun) {
      await upsertCursor(deps.prisma, 'activeDatasetVersion', { value: datasetVersion })
      // 游标只在全部页处理完且零 defer 时推进（D9）—— 否则下轮重拉整套文件重试。
      if (!stoppedByTimeBudget && deferredCount === 0) {
        await upsertCursor(deps.prisma, BULK_DATASET_CURSOR, { value: String(index.modified) })
      }
      const autoEnqueueEnabled =
        String(process.env.ANITABI_TRANSLATION_AUTO_ENQUEUE || '').trim() === '1'
      if (autoEnqueueEnabled && changedBangumiIds.size > 0) {
        try {
          enqueueSummary = await enqueueMapTranslationTasksForBangumiIds({
            prisma: deps.prisma,
            bangumiIds: Array.from(changedBangumiIds),
            targetLanguages: ['en', 'ja'],
            mode: 'all',
          })
        } catch (error) {
          console.error('[anitabi/bulk] failed to auto-enqueue map translation tasks', error)
        }
      }
    }

    const hasMore = stoppedByTimeBudget
    const messages = [
      hasMore
        ? `时间预算用尽，已处理 ${processedCount}/${index.entries.length} 个作品，游标未推进、下轮续跑`
        : undefined,
      deferredCount > 0
        ? `${deferredCount} 个作品本轮未收敛，数据集游标未推进，后续轮次自动重试`
        : undefined,
      enqueueSummary
        ? `地图翻译任务自动入队：新建 ${enqueueSummary.enqueued}，更新 ${enqueueSummary.updated}`
        : undefined,
    ].filter(Boolean)

    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: {
        status: hasMore ? 'partial' : 'ok',
        endedAt: deps.now(),
        changedCount,
        sourceSnapshotHash: snapshotHash,
      },
    })

    return {
      runId: run.id, mode: input.mode, status: 'ok',
      datasetVersion: dryRun ? null : datasetVersion,
      scanned: processedCount, changed: changedCount,
      totalCandidates: index.entries.length, hasMore,
      ...(messages.length ? { message: messages.join('；') } : {}),
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : 'Unknown bulk sync error'
    const message =
      error instanceof HttpStatusError && error.status === 403
        ? `bulk 通道返回 403（分发域被封或域名策略变化，尝试切换 ANITABI_BULK_BASE_URL）：${baseMessage}`
        : baseMessage
    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: { status: 'failed', endedAt: deps.now(), errorSummary: message },
    })
    return {
      runId: run.id, mode: input.mode, status: 'failed', datasetVersion: null,
      scanned: 0, changed: 0, totalCandidates: 0, hasMore: false, message,
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/anitabi/bulkWorkflow.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 全量测试（防回归）**

Run: `npm test`
Expected: PASS（含 line-budget 检查）

- [ ] **Step 6: Commit**

```bash
git add lib/anitabi/sync/bulkWorkflow.ts tests/anitabi/bulkWorkflow.test.ts
git commit -m "feat(anitabi): bulk 数据包同步管线（闸门/检查点/游标）"
```

---

### Task 7: 入口切换（cron handler + CLI）

**Files:**
- Modify: `lib/anitabi/handlers/cron.ts`
- Modify: `scripts/anitabi-sync.ts`

- [ ] **Step 1: `cron.ts` —— 在 `runAnitabiSync` import 旁增加**

```ts
import { runAnitabiBulkSync } from '@/lib/anitabi/sync/bulkWorkflow'

/** bulk（默认，静态数据包）| api（旧逐作品管线，仅回滚用，上游 403 中不可用）。 */
function getSyncSource(): 'bulk' | 'api' {
  return String(process.env.ANITABI_SYNC_SOURCE || 'bulk').trim().toLowerCase() === 'api'
    ? 'api'
    : 'bulk'
}
```

并把 `createHandlers` 中的 `const report = await runAnitabiSync(deps, { mode })` 替换为：

```ts
      const report = getSyncSource() === 'api'
        ? await runAnitabiSync(deps, { mode })
        : await runAnitabiBulkSync(deps, { mode })
```

- [ ] **Step 2: `scripts/anitabi-sync.ts` —— `main()` 中同样分派**

```ts
import { runAnitabiBulkSync } from '@/lib/anitabi/sync/bulkWorkflow'
// main() 内：
  const useApi = String(process.env.ANITABI_SYNC_SOURCE || 'bulk').trim().toLowerCase() === 'api'
  const report = useApi
    ? await runAnitabiSync(deps, { mode })
    : await runAnitabiBulkSync(deps, { mode })
```

- [ ] **Step 3: 类型检查与既有测试**

Run: `npx tsc --noEmit && npx vitest run tests/anitabi/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/anitabi/handlers/cron.ts scripts/anitabi-sync.ts
git commit -m "feat(anitabi): 同步入口按 ANITABI_SYNC_SOURCE 切换 bulk/api 管线"
```

---

### Task 8: mock upstream 增加 bulk 路由 + sync-lab 本地闭环

**Files:**
- Modify: `scripts/anitabi-mock-upstream.mjs`

- [ ] **Step 1: 在 mock 里加 `/d/g.json` 与 `/d/g0.json` 路由**

在现有 `liteFor()`/路由代码旁追加（positional 编码必须与 bulkDecode 的字段表一致；两个 fixture 作品沿用 mock 现有的 id）：

```js
// —— bulk 数据包路由（与 lib/anitabi/source/bulkDecode.ts 的字段表一一对应）——
const BULK_IDS = [115908, 272510]
const BULK_MODIFIED = Date.now()

function bulkIndexRow(id) {
  return [
    id, `作品 ${id}`, `Work ${id}`, `Subject ${id}`, '宇治市', '#02a7bd',
    `/images/bangumi/${id}.jpg`, 0, 'TV',
    34.906, 135.812, 12.38,
    // pointsFlat：pid, lat, lng, priority
    [`${id}p1`, 35.0503, 135.7664, 1, `${id}p2`, 35.0511, 135.7601, 2],
    0, ['tag1'], 999, 0, 0,
  ]
}

function bulkPageEntry(id) {
  const point = (pid, img) => [
    pid, `ポイント ${pid}`, `点位 ${pid}`, 0, 0, 42,
    img, 0, 1, 120, 'mock mark', 'mock-origin', 0, 'mock folder', 7,
  ]
  return [
    id,
    [`/images/ptheme/${id}.webp`, [`${id}p1`, `${id}p2`], BULK_MODIFIED, 100, 76],
    [
      point(`${id}p1`, `/images/points/${id}/${id}p1_123.jpg`),
      point(`${id}p2`, `/images/points/${id}/${id}p2_456.jpg`),
    ],
    BULK_MODIFIED,
  ]
}
```

在请求分发处（`path.match` 系列判断旁）追加：

```js
  if (path === '/d/g.json') {
    body = JSON.stringify([BULK_IDS.map(bulkIndexRow), 250, BULK_MODIFIED])
    verdict = 'OK bulk-index'
  } else if (path === '/d/g0.json') {
    body = JSON.stringify(BULK_IDS.map(bulkPageEntry))
    verdict = 'OK bulk-page-0'
  }
```

（沿用 mock 现有的响应写出与日志逻辑；其余路径保持 403。）

- [ ] **Step 2: 本地闭环验证（mock + 沙箱库）**

```bash
node scripts/anitabi-mock-upstream.mjs 4555 &
DATABASE_URL="postgresql://localhost:5432/seichigo_synclab" \
DATABASE_URL_UNPOOLED="postgresql://localhost:5432/seichigo_synclab" \
ANITABI_BULK_BASE_URL="http://127.0.0.1:4555" \
ANITABI_SYNC_MIN_INTERVAL_MS=0 \
npx tsx scripts/anitabi-sync-lab.mts delta
kill %1
```

Expected:
- report `status: "ok"`，`scanned: 2`，mock 日志只出现 `/d/g.json`、`/d/g0.json` 两条请求，无 403；
- 再跑一遍同命令 → `数据集未变化` 短路消息，mock 只收到 `/d/g.json` 一条。

- [ ] **Step 3: Commit**

```bash
git add scripts/anitabi-mock-upstream.mjs
git commit -m "test(anitabi): mock upstream 提供 bulk 数据包路由"
```

---

### Task 9: 沙箱真数据演练（人工闸，禁止跳过）

**目的：** 用**真实上游数据**灌一遍本地沙箱库，diff 字段填充率，确认没有任何"不可再生字段被抹掉 / 填充率衰减"。这是 spec 定下的上线前置条件。

- [x] **Step 1: 记录演练前填充率基线**

```bash
psql postgresql://localhost:5432/seichigo_synclab -c "
SELECT
  count(*) AS points,
  count(density)   AS density,
  count(mark)      AS mark,
  count(folder)    AS folder,
  count(uid)       AS uid,
  count(\"reviewUid\") AS review_uid,
  count(\"originUrl\") AS origin_url
FROM \"AnitabiPoint\";
SELECT count(*) AS metas, count(\"themeJson\") AS theme,
       count(\"customEpNamesJson\") AS cep, count(\"logsJson\") AS logs
FROM \"AnitabiBangumiMeta\";" | tee /tmp/anitabi-fillrate-before.txt
```

- [x] **Step 2: 对真上游跑全量（本地库 + 真实 bulk 域；循环直到 hasMore=false）**

```bash
while :; do
  OUT=$(DATABASE_URL="postgresql://localhost:5432/seichigo_synclab" \
    DATABASE_URL_UNPOOLED="postgresql://localhost:5432/seichigo_synclab" \
    ANITABI_SYNC_MAX_RUNTIME_MS=120000 \
    npx tsx scripts/anitabi-sync-lab.mts full)
  echo "$OUT" | tail -20
  echo "$OUT" | grep -q '"hasMore": true' || break
done
```

Expected: 最终一轮 `status: "ok"`、`hasMore: false`；期间 `AnitabiSyncRun` 无 `failed`。

- [x] **Step 3: 复查填充率（同 Step 1 的 SQL，输出到 `-after.txt`），并 diff**

验收断言：
- `review_uid`、`origin_url`、`cep`、`logs` 计数**一个都不许少**（冻结字段）；
- `density/mark/folder/uid/theme` 计数**不降反升**（可再生回归）；
- `points` 总数较基线增长（2 月以来的新增点位落库）。

任何一条不满足 → 停下修复，不进 Task 10。

- [x] **Step 4: 把演练结论（两份填充率快照 + 结论一句话）追记到本计划文件末尾，commit**

---

### Task 10: 出口探测器加 bulk 目标（Workers 出口可达性验证）

**Files:**
- Modify: `workers/anitabi-egress-probe/src/index.ts`

- [x] **Step 1: `UPSTREAM_TARGETS` 追加两个目标（紧随现有条目之后）**

```ts
  {
    url: 'https://w.junreimap.com/d/g.json',
    // 对应 lib/anitabi/source/bulkClient.ts 的 bulk 同步抓取
    userAgent: 'seichigo-anitabi-sync/1.0',
    accept: 'application/json',
    role: 'sync-bulk',
    allow404: false,
  },
  {
    url: 'https://www.anitabi.cn/d/g.json',
    userAgent: 'seichigo-anitabi-sync/1.0',
    accept: 'application/json',
    role: 'sync-bulk',
    allow404: false,
  },
```

- [x] **Step 2: `CRITERIA_VERSION` 由 `'v4'` 提到 `'v5'`**（判据集合变了，旧结果不可比）。

- [x] **Step 3: 部署并**只跑一次**探测（执行纪律：不循环）**

```bash
cd workers/anitabi-egress-probe && npx wrangler deploy
PROBE_URL=<deploy 输出的 workers.dev 地址> PROBE_SECRET=<与 worker 一致> \
  node ../../scripts/anitabi-egress-probe.mjs
```

Expected: 两个 `sync-bulk` 目标至少一个 `200 application/json`。
- 若 `w.junreimap.com` 200 → 默认配置即可上线；
- 若仅 `www.anitabi.cn` 200 → 生产把 `ANITABI_BULK_BASE_URL` 设为它；
- 若两个都非 200 → **停**：Worker 出口被 bulk 域拦截，回到"本地/境内跑 `scripts/anitabi-sync.ts` 直写 Neon"的执行形态（管线代码不变，只是不由 cron 触发），并在计划末尾记录。

- [x] **Step 4: Commit**

```bash
git add workers/anitabi-egress-probe/src/index.ts
git commit -m "feat(anitabi): 出口探测器覆盖 bulk 数据包域（v5）"
```

---

### Task 11: 文档修订

**Files:**
- Modify: `docs/anitabi-recovery-spec.md`

- [ ] **Step 1: 在文档顶部状态行下追加修订块**

```markdown
> **2026-08-31 修订：** 发现上游官方全量静态数据包通道（`/d/g.json` + `/d/g{n}.json`，
> 经海外镜像域 `w.junreimap.com` 分发，不受 api.anitabi.cn 地理围栏限制），
> WS3 被新方案取代，见 `docs/superpowers/plans/2026-08-31-anitabi-bulk-sync.md`。
> 事实修正：F1 已消解（www.anitabi.cn 回到 DNS，CNAME 至腾讯 EdgeOne）；
> F2 收敛为"仅放行中国大陆 IP"的地理围栏（诊断时连大陆住宅 IP 也被拦的状态已解除）；
> "5 个不可再生字段"中 density/mark/folder/uid 与 themeJson 经 bulk 通道恢复供给，
> 仅 reviewUid、originUrl 及 customEpNames/logs/removedPoints/completeness 维持冻结。
```

- [ ] **Step 2: Commit**

```bash
git add docs/anitabi-recovery-spec.md
git commit -m "docs(anitabi): 恢复方案增补 2026-08-31 bulk 通道修订"
```

---

### Task 12: 上线 rollout（人工执行，按序）

- [ ] **Step 1: 生产环境变量**：确认部署环境含 `ANITABI_SYNC_SOURCE=bulk`（默认即 bulk，可不设）与 `ANITABI_BULK_BASE_URL`（按 Task 10 探测结论设或不设）。
- [ ] **Step 2: 合入 main 并部署**（遵循 `seichigo-predeploy-guard` → 部署 → `seichigo-deploy-ledger` 记录）。
- [ ] **Step 3: 初次全量回填**：生产 DB 是公网 Neon，直接从本地跑（bulk 域无地理限制，无需大陆出口）：

```bash
while :; do
  OUT=$(ANITABI_SYNC_MAX_RUNTIME_MS=120000 npx tsx scripts/anitabi-sync.ts full)
  echo "$OUT" | tail -5
  echo "$OUT" | grep -q '"hasMore": true' || break
done
```

- [ ] **Step 4: 观察**：`AnitabiSyncRun` 出现 `bulk-full` `ok` 记录后，等 mirror worker 的 hourly cron 触发一轮 `bulk-delta`，确认短路消息正常出现。
- [ ] **Step 5: 镜像 churn 说明**（预期行为，不是故障）：首轮回填把点位 `image` 换成带 `_ts` 的新 URL，mirror 对账会标记大批重镜像；旧 URL 仍 200（B8），页面不会白图，churn 随 mirror worker 节奏自然消化。观察 R2 写入量一周，异常再议。
- [ ] **Step 6: 善后**：给上游维护者的联络（spec T1）**仍然建议发**——告知我们改用了 bulk 静态通道、频率（数据集未变时每小时 1 个索引请求），并致谢。这是把"既成事实通道"转正的唯一途径。

---

## 四、Self-Review 结论

- **覆盖检查**：新增点位落库（Task 6 D8 create 分支）、图片落库（D3 归一 + 既有 mirror 机制 + Task 12 Step 5）、新作品发现（D8）、4 字段回填（D4/Task 9 验收）、短路与频率纪律（D9/礼貌间隔）、Workers 出口验证（Task 10）、回滚（D11）—— 均有对应任务。
- **冻结字段一致性**：`reviewUid`/`originUrl` 在 bulkDecode（不产出键）、bulkWorkflow（不展开键）、测试（`'x' in row === false` 断言）、Task 9（SQL 计数不减）四处口径一致。
- **类型一致性**：`BulkNormalizedPoint`/`BulkIndexEntry`/`BulkPageEntry` 在 Task 1-3 定义、Task 6 消费，签名已核对；`upsertCursor` 沿用 workflow.ts 现有签名 `(prisma, sourceName, { value })`。
- **已知取舍**：`en`→`titleEnglish` 不写（D10）；索引缺席作品不动（D8）；分页每轮全拉不做页级缓存（数据集短路已覆盖 95% 场景）。

---

## 五、Task 9 沙箱真数据演练结论（2026-08-31）

**演练前后填充率快照**（`postgresql://localhost:5432/seichigo_synclab`）：

| 指标 | 演练前 | 演练后 | 变化 |
|---|---:|---:|---|
| 作品数 | 7,933 | 8,042 | +109（新作品发现回归） |
| 点位数 | 30,625 | 80,591 | +49,966 |
| density | 29,158 | 75,367 | +46,209 |
| mark | 14,942 | 35,550 | +20,608 |
| folder | 13,423 | 39,185 | +25,762 |
| uid | 13,822 | 45,755 | +31,933 |
| themeJson | 7,933 | 7,989 | +56 |
| reviewUid（冻结） | 9,953 | 9,850 | **-103** |
| originUrl（冻结） | 24,453 | 24,131 | **-322** |
| customEpNamesJson（冻结） | 7,933 | 7,933 | 0 |
| logsJson（冻结） | 7,933 | 7,933 | 0 |

**过程中发现并修复的真实 bug**：真实上游数据里出现了 `density` 超出 Postgres `integer` 列上限（撞到 `110999999889000`）的畸形值，导致 `anitabiPoint.createMany` 崩溃、整轮同步失败。已修复（`decodeBulkPoint` 补 int32 上限校验，超出范围视为缺失而非透传），并补了两条回归测试覆盖上限值与超限值，见 commit `fix(anitabi): bulk density 解码补 int32 上限校验`。

**沙箱环境自身的历史债（非本次代码引入）**：沙箱种子数据里 99%（1,371 个作品 / 30,400 条点位）的点位使用 2026-02-11 13:41 写入的旧版无 `bangumiId:` 前缀 ID，比"给点位 ID 加前缀"的改动（`ca13f01`，2026-02-12）还早一天，从未迁移。新旧两条同步管线现在都用带前缀的方案，这批老数据在任一管线眼中都"匹配不上"，因此本轮全量演练里 1518 个作品有 1362 个被删除双闸门正确拦下（不删、不收敛、数据集游标不推进，下轮自动重试），只有 109 个新作品 + 47 个恰好已是新版 ID 的老作品完整收敛。**这批老数据的迁移/补齐是独立于本计划的后续工作**，本次不做处理，按用户决定原样保留。

**`reviewUid`/`originUrl` 计数下降的定性**：字面对照验收断言（"冻结字段一个都不许少"）未通过，但已确认不是误清空：
- 代码层面核对 `bulkWorkflow.ts` 的 `normalizedPoints` 构造与 `anitabiPoint.update()` 调用，`reviewUid`/`originUrl` 两个 key 从未出现在写入的 `data` 对象里——Prisma 对未出现的 key 不做任何改动，不会写 null。
- 因此这两个字段只可能通过**真删除**减少，而删除只发生在 156 个"收敛"的作品上（109 个全新 + 47 个已是新版 ID 且匹配良好的老作品），删的是这些作品里上游确实已不存在的陈旧点位，其中一部分恰好带有 reviewUid/originUrl。
- 结论：这是停摆约 8 个月后首次全量同步、跟随上游做的真实存量清理，不是响应残缺导致的误清空。原验收断言设计时未考虑"长期停摆后首次同步会有正常增删"的场景。**用户已确认按此定性判定 Task 9 通过**，不视为需要修复的缺陷。

**结论一句话**：bulk 同步管线在真实上游数据下功能正确、删除安全闸门按设计工作；发现并修复了一个真实的 density 越界崩溃 bug；`reviewUid`/`originUrl` 的计数下降经代码级核实为合法的陈旧点位清理而非误清空，Task 9 判定通过，可以推进 Task 10。

---

## 六、Task 10 出口探测结论（2026-08-31）

部署 `seichigo-anitabi-egress-probe` 到生产 Cloudflare 账号，从 NRT colo 触发一次探测（判据 v5）：

| 目标 | 结果 |
|---|---|
| `api.anitabi.cn/bangumi/115908/lite` | 403（预期内，地理围栏） |
| `api.anitabi.cn/bangumi/272510/points/detail` | 403（预期内） |
| `image.anitabi.cn/points/...` | 403（预期内） |
| `img-tc.anitabi.cn/points/...` | 200 image/jpeg，USABLE |
| **`w.junreimap.com/d/g.json`** | **200 application/json，USABLE** |
| **`www.anitabi.cn/d/g.json`** | **200 application/json，USABLE** |

**结论**：生产 Worker 出口（至少 NRT colo）可达 bulk 数据集分发域，默认配置（`ANITABI_BULK_BASE_URL` 不设、走 `w.junreimap.com`）无需改动即可上线。`api.anitabi.cn`/`image.anitabi.cn` 依旧被地理围栏拦截，不影响 bulk 通道。单 colo 结果，未做多点覆盖（默认配置已明确可用，无需为已有把握的结论加测）。

探测 worker 属一次性诊断工具，验证完成后按其自身文档建议删除（`npx wrangler delete --name seichigo-anitabi-egress-probe`）。
