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
