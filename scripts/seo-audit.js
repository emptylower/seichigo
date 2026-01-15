#!/usr/bin/env node
/* eslint-disable no-console */

const { JSDOM } = require('jsdom')

const DEFAULT_BASE_URL = process.env.SITE_URL || 'https://seichigo.com'
const DEFAULT_CONCURRENCY = Number(process.env.SEO_AUDIT_CONCURRENCY || 6)
const DEFAULT_MAX_URLS = Number(process.env.SEO_AUDIT_MAX_URLS || 0)
const DEFAULT_TIMEOUT_MS = Number(process.env.SEO_AUDIT_TIMEOUT_MS || 20000)
const DEFAULT_MIN_DESCRIPTION_LEN = Number(process.env.SEO_AUDIT_MIN_DESCRIPTION_LEN || 50)
const DEFAULT_MAX_DESCRIPTION_LEN = Number(process.env.SEO_AUDIT_MAX_DESCRIPTION_LEN || 180)

const SITE_DEFAULT_TITLE = 'SeichiGo — 动漫圣地巡礼攻略'
const SITE_DEFAULT_DESCRIPTION =
  '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。'

function printHelp() {
  console.log(`SeichiGo SEO audit

Usage:
  node scripts/seo-audit.js [options]

Options:
  --base-url <url>         Base URL to audit (default: ${DEFAULT_BASE_URL})
  --sitemap <path|url>     Sitemap URL or path (default: /sitemap.xml)
  --concurrency <n>        Concurrent fetches (default: ${DEFAULT_CONCURRENCY})
  --max <n>                Limit audited URLs (default: ${DEFAULT_MAX_URLS || 'all'})
  --timeout-ms <n>         Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --include-private        Also check private areas are noindex
  --fail-on-warn           Non-zero exit if warnings exist
  --format <pretty|json>   Output format (default: pretty)
  --only <id1,id2>         Only run selected checks
  --skip <id1,id2>         Skip selected checks
  -h, --help               Show help

Examples:
  node scripts/seo-audit.js --base-url https://seichigo.com
  node scripts/seo-audit.js --base-url http://localhost:3000 --include-private
`)
}

function parseArgs(argv) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    sitemap: '/sitemap.xml',
    concurrency: DEFAULT_CONCURRENCY,
    max: DEFAULT_MAX_URLS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    includePrivate: false,
    failOnWarn: false,
    format: 'pretty',
    only: [],
    skip: [],
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') return { ...out, help: true }
    if (arg === '--include-private') {
      out.includePrivate = true
      continue
    }
    if (arg === '--fail-on-warn') {
      out.failOnWarn = true
      continue
    }
    if (arg === '--base-url') {
      out.baseUrl = String(argv[++i] || '').trim()
      continue
    }
    if (arg === '--sitemap') {
      out.sitemap = String(argv[++i] || '').trim()
      continue
    }
    if (arg === '--concurrency') {
      out.concurrency = Number(argv[++i] || 0)
      continue
    }
    if (arg === '--max') {
      out.max = Number(argv[++i] || 0)
      continue
    }
    if (arg === '--timeout-ms') {
      out.timeoutMs = Number(argv[++i] || 0)
      continue
    }
    if (arg === '--format') {
      out.format = String(argv[++i] || '').trim() || 'pretty'
      continue
    }
    if (arg === '--only') {
      out.only = String(argv[++i] || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      continue
    }
    if (arg === '--skip') {
      out.skip = String(argv[++i] || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      continue
    }
  }

  if (!out.baseUrl) out.baseUrl = DEFAULT_BASE_URL
  if (!Number.isFinite(out.concurrency) || out.concurrency <= 0) out.concurrency = DEFAULT_CONCURRENCY
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) out.timeoutMs = DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(out.max) || out.max < 0) out.max = 0
  if (out.format !== 'json') out.format = 'pretty'
  return out
}

function normalizeUrlForCompare(input) {
  try {
    const url = new URL(String(input))
    url.hash = ''
    url.search = ''
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
    return url.toString()
  } catch {
    return String(input)
  }
}

function safeUrl(input, base) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw.startsWith('//')) return null
  try {
    const url = base ? new URL(raw, base) : new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function stripOrigin(url) {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}${u.hash}`
  } catch {
    return url
  }
}

function parseSitemapUrls(xml) {
  const urls = []
  const re = /<loc>([^<]+)<\/loc>/g
  let match
  while ((match = re.exec(String(xml || '')))) {
    const loc = String(match[1] || '').trim()
    if (!loc) continue
    urls.push(loc)
  }
  return urls
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

function getMeta(doc, selector) {
  const el = doc.querySelector(selector)
  if (!el) return null
  const content = el.getAttribute('content')
  return content ? String(content).trim() : null
}

function getCanonicalHref(doc) {
  const el = doc.querySelector('link[rel="canonical"]')
  if (!el) return null
  const href = el.getAttribute('href')
  return href ? String(href).trim() : null
}

function flattenJsonLd(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((v) => flattenJsonLd(v))
  const graph = value['@graph']
  if (Array.isArray(graph)) return [value, ...graph.flatMap((v) => flattenJsonLd(v))]
  return [value]
}

function extractJsonLd(doc) {
  const issues = []
  const objects = []
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
  for (const s of scripts) {
    const raw = String(s.textContent || '').trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      objects.push(...flattenJsonLd(parsed))
    } catch (err) {
      issues.push({
        level: 'error',
        code: 'jsonld_parse_error',
        message: `JSON-LD 解析失败：${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return { objects, issues }
}

function getJsonLdTypes(obj) {
  const t = obj && obj['@type']
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string')
  return []
}

function findJsonLdByType(list, type) {
  return list.filter((o) => getJsonLdTypes(o).includes(type))
}

function buildChecks(options) {
  const checks = [
    {
      id: 'status',
      run(ctx) {
        if (ctx.isPrivate) return []
        if (ctx.status >= 200 && ctx.status < 300) return []
        return [{ level: 'error', code: 'http_status', message: `HTTP 状态异常：${ctx.status}` }]
      },
    },
    {
      id: 'robots_public',
      run(ctx) {
        if (ctx.isPrivate) return []
        const robots = getMeta(ctx.doc, 'meta[name="robots"]')
        if (!robots) return []
        if (robots.toLowerCase().includes('noindex')) {
          return [{ level: 'error', code: 'robots_noindex', message: `公开页面不应 noindex：${robots}` }]
        }
        return []
      },
    },
    {
      id: 'canonical',
      run(ctx) {
        if (ctx.isPrivate) return []
        const href = getCanonicalHref(ctx.doc)
        if (!href) return [{ level: 'error', code: 'canonical_missing', message: '缺少 canonical link' }]
        const abs = safeUrl(href, ctx.baseUrl)
        if (!abs) return [{ level: 'error', code: 'canonical_invalid', message: `canonical href 非法：${href}` }]
        const got = normalizeUrlForCompare(abs)
        const expected = normalizeUrlForCompare(ctx.expectedCanonical)
        if (got !== expected) {
          return [
            {
              level: 'error',
              code: 'canonical_mismatch',
              message: `canonical 不匹配：got=${stripOrigin(got)} expected=${stripOrigin(expected)}`,
            },
          ]
        }
        return []
      },
    },
    {
      id: 'title',
      run(ctx) {
        if (ctx.isPrivate) return []
        const title = String(ctx.doc.title || '').trim()
        if (!title) return [{ level: 'error', code: 'title_missing', message: '缺少 <title>' }]
        if (ctx.pathname !== '/' && title === SITE_DEFAULT_TITLE) {
          return [{ level: 'error', code: 'title_default', message: '页面标题仍为默认值（疑似未设置 metadata.title）' }]
        }
        if (title.length > 80) {
          return [{ level: 'warn', code: 'title_too_long', message: `标题过长（${title.length}）` }]
        }
        return []
      },
    },
    {
      id: 'description',
      run(ctx) {
        if (ctx.isPrivate) return []
        const desc = getMeta(ctx.doc, 'meta[name="description"]')
        if (!desc) return [{ level: 'error', code: 'description_missing', message: '缺少 meta description' }]
        if (ctx.isPost && desc === SITE_DEFAULT_DESCRIPTION) {
          return [{ level: 'warn', code: 'description_default', message: '文章 description 仍为全站默认值（建议设置文章摘要）' }]
        }
        if (desc.length < DEFAULT_MIN_DESCRIPTION_LEN) {
          return [{ level: 'warn', code: 'description_too_short', message: `description 偏短（${desc.length}）` }]
        }
        if (desc.length > DEFAULT_MAX_DESCRIPTION_LEN) {
          return [{ level: 'warn', code: 'description_too_long', message: `description 偏长（${desc.length}）` }]
        }
        return []
      },
    },
    {
      id: 'open_graph',
      run(ctx) {
        if (ctx.isPrivate) return []
        const required = ['og:title', 'og:description', 'og:url', 'og:type', 'og:image']
        const missing = required.filter((p) => !getMeta(ctx.doc, `meta[property="${p}"]`))
        if (!missing.length) return []
        const level = ctx.isPost ? 'error' : 'warn'
        return [{ level, code: 'og_missing', message: `缺少 OpenGraph：${missing.join(', ')}` }]
      },
    },
    {
      id: 'twitter',
      run(ctx) {
        if (ctx.isPrivate) return []
        const required = ['twitter:card']
        const missing = required.filter((n) => !getMeta(ctx.doc, `meta[name="${n}"]`))
        if (!missing.length) return []
        const level = ctx.isPost ? 'error' : 'warn'
        return [{ level, code: 'twitter_missing', message: `缺少 Twitter meta：${missing.join(', ')}` }]
      },
    },
    {
      id: 'jsonld',
      run(ctx) {
        if (!ctx.isPost) return []
        const issues = []
        const blog = findJsonLdByType(ctx.jsonLd, 'BlogPosting')
        if (!blog.length) issues.push({ level: 'error', code: 'jsonld_blogposting_missing', message: '缺少 BlogPosting JSON-LD' })
        const breadcrumb = findJsonLdByType(ctx.jsonLd, 'BreadcrumbList')
        if (!breadcrumb.length) issues.push({ level: 'error', code: 'jsonld_breadcrumb_missing', message: '缺少 BreadcrumbList JSON-LD' })
        const itemLists = findJsonLdByType(ctx.jsonLd, 'ItemList')
        if (!itemLists.length) issues.push({ level: 'error', code: 'jsonld_itemlist_missing', message: '缺少 ItemList(JSON-LD 路线点位)' })

        for (const list of itemLists) {
          const elements = Array.isArray(list.itemListElement) ? list.itemListElement : []
          for (const el of elements) {
            const place = el && el.item
            if (!place || place['@type'] !== 'Place') {
              issues.push({ level: 'warn', code: 'jsonld_place_type', message: 'ItemList 中存在非 Place 的点位' })
              continue
            }
            const geo = place.geo
            if (!geo) {
              issues.push({ level: 'warn', code: 'jsonld_geo_missing', message: 'Place 缺少 GeoCoordinates（如果有坐标建议补齐）' })
              continue
            }
            const lat = geo.latitude
            const lng = geo.longitude
            if (typeof lat !== 'number' || typeof lng !== 'number') {
              issues.push({ level: 'warn', code: 'jsonld_geo_invalid', message: 'GeoCoordinates 坐标不是数字' })
            }
          }
        }

        return issues
      },
    },
  ]

  const only = new Set(options.only || [])
  const skip = new Set(options.skip || [])
  return checks.filter((c) => (!only.size || only.has(c.id)) && !skip.has(c.id))
}

async function poolMap(items, concurrency, mapper) {
  const results = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) break
      results[idx] = await mapper(items[idx], idx)
    }
  })

  await Promise.all(workers)
  return results
}

async function auditPublicUrl(url, options, checks) {
  const expectedCanonical = url
  const res = await fetchWithTimeout(url, { redirect: 'follow' }, options.timeoutMs)
  const status = res.status
  const finalUrl = res.url || url
  const html = await res.text()
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const { objects: jsonLd, issues: jsonLdIssues } = extractJsonLd(doc)

  const parsed = new URL(finalUrl)
  const pathname = parsed.pathname
  const ctx = {
    baseUrl: options.baseUrl,
    url: finalUrl,
    expectedCanonical,
    status,
    pathname,
    isPost: /^\/posts\/[^/]+$/.test(pathname),
    isPrivate: false,
    doc,
    jsonLd,
  }

  const issues = [...jsonLdIssues]
  for (const check of checks) {
    try {
      issues.push(...(check.run(ctx) || []))
    } catch (err) {
      issues.push({
        level: 'error',
        code: 'check_crash',
        message: `检查项 ${check.id} 执行失败：${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return { url: finalUrl, status, issues }
}

async function auditPrivateUrl(url, options) {
  const res = await fetchWithTimeout(url, { redirect: 'manual' }, options.timeoutMs)
  const status = res.status
  const xRobots = String(res.headers.get('x-robots-tag') || '').toLowerCase()
  const issues = []
  if (!xRobots.includes('noindex')) {
    issues.push({ level: 'error', code: 'private_noindex_missing', message: `缺少 X-Robots-Tag noindex（got: ${xRobots || 'none'}）` })
  }
  return { url, status, issues }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const baseUrl = safeUrl(options.baseUrl)
  if (!baseUrl) {
    console.error(`Invalid --base-url: ${options.baseUrl}`)
    process.exitCode = 2
    return
  }
  options.baseUrl = baseUrl.replace(/\/$/, '')

  const sitemapUrl = safeUrl(options.sitemap, options.baseUrl) || new URL('/sitemap.xml', options.baseUrl).toString()
  const robotsUrl = new URL('/robots.txt', options.baseUrl).toString()

  const preflight = { sitemapUrl, robotsUrl, sitemapOk: false, robotsOk: false, robotsHasSitemap: false }
  const errors = []

  try {
    const res = await fetchWithTimeout(robotsUrl, { redirect: 'follow' }, options.timeoutMs)
    const text = await res.text()
    preflight.robotsOk = res.status >= 200 && res.status < 300
    preflight.robotsHasSitemap = text.includes(`Sitemap: ${options.baseUrl}/sitemap.xml`)
    if (!preflight.robotsOk) {
      errors.push({ level: 'error', code: 'robots_fetch', message: `robots.txt HTTP 状态异常：${res.status}` })
    } else if (!preflight.robotsHasSitemap) {
      errors.push({ level: 'error', code: 'robots_sitemap_missing', message: 'robots.txt 未包含 Sitemap 声明' })
    }
  } catch (err) {
    errors.push({ level: 'error', code: 'robots_fetch', message: `robots.txt 拉取失败：${err instanceof Error ? err.message : String(err)}` })
  }

  let sitemapXml = ''
  try {
    const res = await fetchWithTimeout(sitemapUrl, { redirect: 'follow' }, options.timeoutMs)
    sitemapXml = await res.text()
    preflight.sitemapOk = res.status >= 200 && res.status < 300
    if (!preflight.sitemapOk) {
      errors.push({ level: 'error', code: 'sitemap_fetch', message: `sitemap.xml HTTP 状态异常：${res.status}` })
    }
  } catch (err) {
    errors.push({ level: 'error', code: 'sitemap_fetch', message: `sitemap.xml 拉取失败：${err instanceof Error ? err.message : String(err)}` })
  }

  const sitemapUrls = parseSitemapUrls(sitemapXml).filter(Boolean)
  const urls = sitemapUrls.filter((u) => {
    const abs = safeUrl(u)
    if (!abs) return false
    try {
      const parsed = new URL(abs)
      return parsed.origin === new URL(options.baseUrl).origin
    } catch {
      return false
    }
  })

  const checks = buildChecks(options)

  const max = options.max > 0 ? options.max : urls.length
  const publicTargets = urls.slice(0, max)

  const privateTargets = options.includePrivate
    ? ['/auth/signin', '/submit', '/admin/panel', '/me/favorites'].map((p) => new URL(p, options.baseUrl).toString())
    : []

  const publicResults = await poolMap(publicTargets, options.concurrency, (url) => auditPublicUrl(url, options, checks))
  const privateResults = privateTargets.length
    ? await poolMap(privateTargets, Math.min(options.concurrency, privateTargets.length), (url) => auditPrivateUrl(url, options))
    : []

  const results = [...publicResults, ...privateResults]

  const allIssues = [...errors, ...results.flatMap((r) => r.issues)]
  const errorCount = allIssues.filter((i) => i.level === 'error').length
  const warnCount = allIssues.filter((i) => i.level === 'warn').length

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          baseUrl: options.baseUrl,
          preflight,
          totals: {
            urlsInSitemap: sitemapUrls.length,
            auditedPublic: publicTargets.length,
            auditedPrivate: privateTargets.length,
            errors: errorCount,
            warnings: warnCount,
          },
          checks: checks.map((c) => c.id),
          results,
          preflightIssues: errors,
        },
        null,
        2
      )
    )
  } else {
    console.log(`SEO Audit`)
    console.log(`- base:   ${options.baseUrl}`)
    console.log(`- sitemap: ${sitemapUrl}`)
    console.log(`- robots:  ${robotsUrl}`)
    console.log(`- urls:    ${publicTargets.length} (private: ${privateTargets.length})`)
    console.log(`- checks:  ${checks.map((c) => c.id).join(', ') || 'none'}`)
    console.log(`- result:  errors=${errorCount} warnings=${warnCount}`)

    const byUrl = new Map()
    for (const r of results) {
      if (!r.issues.length) continue
      byUrl.set(r.url, r.issues)
    }

    const preflightErrors = errors.filter((i) => i.level === 'error')
    if (preflightErrors.length) {
      console.log(`\nPreflight issues:`)
      for (const i of preflightErrors) {
        console.log(`- [${i.level.toUpperCase()}] ${i.code}: ${i.message}`)
      }
    }

    if (byUrl.size) {
      console.log(`\nPage issues:`)
      for (const [url, issues] of byUrl.entries()) {
        console.log(`- ${stripOrigin(url)}`)
        for (const i of issues) {
          console.log(`  - [${i.level.toUpperCase()}] ${i.code}: ${i.message}`)
        }
      }
    }
  }

  if (errorCount > 0) {
    process.exitCode = 1
    return
  }
  if (options.failOnWarn && warnCount > 0) {
    process.exitCode = 1
    return
  }
  process.exitCode = 0
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 2
})

