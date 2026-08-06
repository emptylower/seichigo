#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compileMDX } from 'next-mdx-remote/rsc'
import sanitizeHtml from 'sanitize-html'
import { normalizeContentPath } from '../lib/linkAsset/contentPath.mjs'

export { normalizeContentPath } from '../lib/linkAsset/contentPath.mjs'

const ROOT = process.cwd()
const CONTENT_ROOT = path.join(ROOT, 'content')
const GENERATED_ROOT = path.join(CONTENT_ROOT, 'generated')
const POST_LOCALES = ['zh', 'en', 'ja']
const MIN_LINK_ASSET_CONTENT_TEXT_LENGTH = 120
const h = React.createElement

function rewriteAssetImageSrc(src) {
  if (typeof src !== 'string') return null
  const trimmed = src.trim()
  if (!/^\/assets\/[a-zA-Z0-9_-]+$/.test(trimmed)) return null
  return {
    full: trimmed,
    placeholder: `${trimmed}?w=32&q=20`,
    sd: `${trimmed}?w=854&q=70`,
    hd: `${trimmed}?w=1280&q=80`,
  }
}

function MdxLink({ children, ...rest }) {
  const href = typeof rest.href === 'string' ? rest.href.trim() : ''
  const external = href && !href.startsWith('#') && (/^https?:\/\//i.test(href) || href.startsWith('/'))
  return h('a', external ? { ...rest, target: '_blank', rel: 'noopener noreferrer' } : rest, children)
}

function MdxImg({ src, alt, ...rest }) {
  const rewritten = rewriteAssetImageSrc(src)
  if (!rewritten) return h('img', { ...rest, src: typeof src === 'string' ? src : undefined, alt: String(alt || '') })
  return h('img', {
    ...rest,
    alt: String(alt || ''),
    src: rewritten.placeholder,
    'data-seichi-full': rewritten.full,
    'data-seichi-sd': rewritten.sd,
    'data-seichi-hd': rewritten.hd,
    'data-seichi-blur': 'true',
    loading: 'lazy',
    decoding: 'async',
  })
}

function Callout({ type = 'note', children }) {
  const palette = {
    note: 'bg-pink-50 border-pink-200 text-pink-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    tip: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  }[type] || 'bg-pink-50 border-pink-200 text-pink-900'
  return h('div', { className: `not-prose rounded-lg border p-3 ${palette}` }, children)
}

const LINK_ASSET_MDX_COMPONENTS = {
  Callout,
  a: MdxLink,
  img: MdxImg,
}

function normalizeString(value) {
  return typeof value === 'string' ? value : ''
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

function normalizePostFrontmatter(data, language) {
  return {
    title: normalizeString(data?.title),
    seoTitle: normalizeString(data?.seoTitle) || undefined,
    description: normalizeString(data?.description) || undefined,
    cover: normalizeString(data?.cover) || undefined,
    slug: normalizeString(data?.slug),
    animeId: normalizeString(data?.animeId) || 'unknown',
    city: normalizeString(data?.city),
    areas: normalizeStringArray(data?.areas),
    routeLength: normalizeString(data?.routeLength) || undefined,
    language: normalizeString(data?.language) || language,
    tags: normalizeStringArray(data?.tags),
    publishDate: normalizeString(data?.publishDate) || undefined,
    updatedDate: normalizeString(data?.updatedDate) || undefined,
    status: normalizeString(data?.status) || 'published',
    tldr: data?.tldr && typeof data.tldr === 'object' ? data.tldr : undefined,
    transportation: data?.transportation && typeof data.transportation === 'object' ? data.transportation : undefined,
    photoTips: normalizeStringArray(data?.photoTips),
    title_en: normalizeString(data?.title_en) || undefined,
    seoTitle_en: normalizeString(data?.seoTitle_en) || undefined,
    description_en: normalizeString(data?.description_en) || undefined,
  }
}

function addProgressiveAttrsToHtml(html) {
  return html.replace(/<img\b([^>]*?)src="([^"]+)"([^>]*)>/g, (match, before, src, after) => {
    const rewritten = rewriteAssetImageSrc(src)
    if (!rewritten) return match

    const existing = `${before}${after}`
    const attrs = [
      `src="${rewritten.placeholder}"`,
      `data-seichi-full="${rewritten.full}"`,
      `data-seichi-sd="${rewritten.sd}"`,
      `data-seichi-hd="${rewritten.hd}"`,
      'data-seichi-blur="true"',
      /loading=/.test(existing) ? null : 'loading="lazy"',
      /decoding=/.test(existing) ? null : 'decoding="async"',
    ].filter(Boolean)

    const cleaned = existing
      .replace(/\s+src="[^"]*"/g, '')
      .replace(/\s+loading="[^"]*"/g, '')
      .replace(/\s+decoding="[^"]*"/g, '')
      .trim()

    const suffix = cleaned ? ` ${cleaned}` : ''
    return `<img ${attrs.join(' ')}${suffix}>`
  })
}

async function ensureGeneratedDir() {
  await fs.mkdir(GENERATED_ROOT, { recursive: true })
}

async function writeJson(filename, value) {
  await fs.writeFile(path.join(GENERATED_ROOT, filename), `${JSON.stringify(value)}\n`, 'utf-8')
}

async function readDirSafe(dir) {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function buildAnimeSnapshot() {
  const dir = path.join(CONTENT_ROOT, 'anime')
  const files = (await readDirSafe(dir)).filter((file) => file.endsWith('.json')).sort()
  const rows = []

  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '')
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (!normalizeString(parsed?.id)) continue
      rows.push(parsed)
    } catch {
      // Ignore malformed source files; runtime uses the generated snapshot.
    }
  }

  await writeJson('public-anime.json', rows)
}

function countRenderedText(html) {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
    .length
}

export async function buildLinkAssetSnapshot(options = {}) {
  const root = options.root || ROOT
  const generatedRoot = options.generatedRoot || path.join(root, 'content', 'generated')
  const dir = path.join(root, 'content', 'link-assets')
  const files = await readDirSafe(dir)
  const jsonFiles = files.filter((file) => file.endsWith('.json')).sort()
  const rows = []

  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '')
    if (!raw) continue

    let asset
    try {
      asset = JSON.parse(raw)
    } catch {
      // Ignore malformed source files; runtime uses the generated snapshot.
      continue
    }

    const id = normalizeString(asset?.id)
    if (!id) continue

    const declaredContentFile = normalizeString(asset?.contentFile)
    const contentFile = declaredContentFile ? normalizeContentPath(declaredContentFile) : null
    if (declaredContentFile && !contentFile) {
      throw new Error(
        `[link-asset:${id}] invalid contentFile: ${declaredContentFile}; ` +
        'expected a path starting with "/content/" and containing no ".."'
      )
    }
    const markdownPath = contentFile
      ? path.join(root, contentFile.slice(1))
      : null
    let contentHtml = null

    if (markdownPath) {
      let markdown
      try {
        markdown = await fs.readFile(markdownPath, 'utf-8')
      } catch (error) {
        throw new Error(
          `[link-asset:${id}] cannot read declared contentFile: ${contentFile}`,
          { cause: error }
        )
      }

      contentHtml = await compileLinkAssetMarkdownToHtml(markdown)
      const textLength = countRenderedText(contentHtml)
      if (textLength < MIN_LINK_ASSET_CONTENT_TEXT_LENGTH) {
        throw new Error(
          `[link-asset:${id}] compiled content is too short: ${textLength} visible characters ` +
          `(minimum ${MIN_LINK_ASSET_CONTENT_TEXT_LENGTH})`
        )
      }
    }

    rows.push({ asset, contentHtml })
  }

  await fs.mkdir(generatedRoot, { recursive: true })
  await fs.writeFile(
    path.join(generatedRoot, 'public-link-assets.json'),
    `${JSON.stringify(rows)}\n`,
    'utf-8'
  )
}

export async function compileLinkAssetMarkdownToHtml(source) {
  const compiled = await compileMDX({
    source,
    components: LINK_ASSET_MDX_COMPONENTS,
    options: { parseFrontmatter: true, blockJS: false },
  })
  return addProgressiveAttrsToHtml(renderToStaticMarkup(compiled.content))
}

async function buildPostSnapshotForLocale(locale) {
  const dir = path.join(CONTENT_ROOT, locale, 'posts')
  const files = (await readDirSafe(dir)).filter((file) => file.endsWith('.mdx')).sort()
  const rows = []

  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '')
    if (!raw) continue

    const parsed = matter(raw)
    const frontmatter = normalizePostFrontmatter(parsed.data, locale)
    if (!frontmatter.title || !frontmatter.slug || frontmatter.status === 'draft') continue

    const compiled = await compileMDX({
      source: raw,
      options: { parseFrontmatter: true },
    })

    const contentHtml = addProgressiveAttrsToHtml(renderToStaticMarkup(compiled.content))
    rows.push({ frontmatter, contentHtml })
  }

  await writeJson(`public-posts-${locale}.json`, rows)
}

async function main() {
  await ensureGeneratedDir()
  await buildAnimeSnapshot()
  await buildLinkAssetSnapshot()
  for (const locale of POST_LOCALES) {
    await buildPostSnapshotForLocale(locale)
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((error) => {
    console.error('[generate-public-content-snapshots] failed', error)
    process.exitCode = 1
  })
}
