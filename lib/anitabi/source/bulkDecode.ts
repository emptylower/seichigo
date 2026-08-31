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
  // 上游协议用数字 0 表示"无此值"（normalizeText(0) 会得到 '0'，需先显式排除）。
  if (value === 0 || value == null) return null
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
  // 上游协议用数字 0 表示"无此值"（normalizeText(0) 会得到 '0'，需先显式排除）。
  if (v === 0) return undefined
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
