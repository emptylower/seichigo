/**
 * 第六轮 E1：代理 `url` 参数的稳健解析。
 *
 * Cloudflare/OpenNext 上 `req.url` 的 query 已被平台解码过一次，客户端只做
 * 单次编码的多参数上游 URL（`…jpg%3Fq%3D80%26w%3D640`）在服务端变成
 * `url=…jpg?q=80&w=640`——`&w=640` 被当成代理自己的顶层参数，目标在第一个
 * `&` 处截断，导致 R2 mirror key 与 5 月种子任务写入的键错位（线上实证
 * 2026-09-03）。本地 Node 开发服务器没有这层解码，所以解析必须两端兼容：
 *
 * 1. 从 `req.url` 取原始 query（不先经 URLSearchParams），用正则抓 `url=`
 *    的值——平台解码过的截断形态在这里露馅（值里出现明文 `?`/`&`）。
 * 2. 值先 `decodeURIComponent` 一次；若结果仍含 `%3A%2F%2F` / `%3F` / `%26`
 *    （客户端双重编码，见第六轮 E2 的 buildProxyImageUrl），再解一次。
 * 3. 若 `url=` 之后还跟着非代理参数（`w` / `q` / `h` / `plan` 等，不在
 *    `url` / `_retry` / `name` / `__mi_*` 集合里），说明是"平台已解码一次、
 *    客户端又只单次编码"的存量 URL——把它们按原顺序追加回目标 query。
 * 4. 其余校验（协议、凭据）与 imageServe 的 parseTargetUrl 同口径；
 *    私网 host 校验仍由调用方的 assertAllowedTargetUrl 负责。
 */

const PROXY_RESERVED_QUERY_KEYS: ReadonlySet<string> = new Set(['url', '_retry', 'name'])
const MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX = '__mi_'
const STILL_ENCODED_PATTERN = /%3A%2F%2F|%3F|%26/i

function isProxyReservedQueryKey(key: string): boolean {
  return PROXY_RESERVED_QUERY_KEYS.has(key) || key.startsWith(MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX)
}

function decodeUrlParamValue(value: string): string {
  const once = decodeURIComponent(value)
  return STILL_ENCODED_PATTERN.test(once) ? decodeURIComponent(once) : once
}

function parseValidatedTargetUrl(rawTarget: string, requestUrl: URL): URL | null {
  const raw = rawTarget.trim()
  if (!raw) return null
  try {
    const url = raw.includes('://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`, requestUrl.origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.username || url.password ? null : url
  } catch {
    return null
  }
}

export function resolveProxyTargetUrl(req: Request): URL | null {
  let requestUrl: URL
  try {
    requestUrl = new URL(req.url)
  } catch {
    return null
  }

  const rawQuery = requestUrl.search.startsWith('?') ? requestUrl.search.slice(1) : ''
  const pairs = rawQuery.split('&')
  let urlPairIndex = -1
  let captured = ''
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!
    if (!pair.startsWith('url=')) continue
    urlPairIndex = index
    captured = pair.slice('url='.length)
    break
  }
  if (urlPairIndex === -1) return null

  let decodedTarget: string
  try {
    decodedTarget = decodeUrlParamValue(captured)
  } catch {
    return null
  }

  const target = parseValidatedTargetUrl(decodedTarget, requestUrl)
  if (!target) return null

  for (let index = urlPairIndex + 1; index < pairs.length; index += 1) {
    const pair = pairs[index]!
    if (!pair) continue
    const eqIndex = pair.indexOf('=')
    const key = eqIndex === -1 ? pair : pair.slice(0, eqIndex)
    if (isProxyReservedQueryKey(key)) continue
    if (target.searchParams.has(key)) continue
    target.searchParams.set(key, eqIndex === -1 ? '' : pair.slice(eqIndex + 1))
  }

  return target
}
