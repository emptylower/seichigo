#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compileMDX } from 'next-mdx-remote/rsc'

const ROOT = process.cwd()
const CONTENT_ROOT = path.join(ROOT, 'content')
const GENERATED_ROOT = path.join(CONTENT_ROOT, 'generated')
const POST_LOCALES = ['zh', 'en', 'ja']

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

async function buildLinkAssetSnapshot() {
  const dir = path.join(CONTENT_ROOT, 'link-assets')
  const files = await readDirSafe(dir)
  const jsonFiles = files.filter((file) => file.endsWith('.json')).sort()
  const rows = []

  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '')
    if (!raw) continue

    try {
      const asset = JSON.parse(raw)
      const id = normalizeString(asset?.id)
      if (!id) continue

      const contentFile = normalizeString(asset?.contentFile)
      const markdownPath = contentFile
        ? path.join(ROOT, contentFile.replace(/^\/+/, ''))
        : null
      const markdown = markdownPath
        ? await fs.readFile(markdownPath, 'utf-8').catch(() => null)
        : null

      rows.push({ asset, markdown })
    } catch {
      // Ignore malformed source files; runtime uses the generated snapshot.
    }
  }

  await writeJson('public-link-assets.json', rows)
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

main().catch((error) => {
  console.error('[generate-public-content-snapshots] failed', error)
  process.exitCode = 1
})
