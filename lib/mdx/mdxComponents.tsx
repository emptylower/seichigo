"use client"
import React from 'react'
import SpotList from '@/components/content/SpotList'
import Callout from '@/components/content/Callout'

function rewriteAssetImageSrc(src: unknown): null | { full: string; placeholder: string; sd: string; hd: string } {
  if (typeof src !== 'string') return null
  const trimmed = src.trim()
  if (!/^\/assets\/[a-zA-Z0-9_-]+$/.test(trimmed)) return null
  const full = trimmed
  return {
    full,
    placeholder: `${full}?w=32&q=20`,
    sd: `${full}?w=854&q=70`,
    hd: `${full}?w=1280&q=80`,
  }
}

function shouldOpenInNewTab(href: unknown): boolean {
  if (typeof href !== 'string') return false
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return false
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')
}

function MdxLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { children, ...rest } = props
  if (!shouldOpenInNewTab(rest.href)) {
    return <a {...rest}>{children}</a>
  }
  return (
    <a {...rest} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

function MdxImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { src, ...rest } = props
  const rewritten = rewriteAssetImageSrc(src)
  if (!rewritten) return <img src={typeof src === 'string' ? src : undefined} {...rest} />
  return (
    <img
      {...rest}
      src={rewritten.placeholder}
      data-seichi-full={rewritten.full}
      data-seichi-sd={rewritten.sd}
      data-seichi-hd={rewritten.hd}
      data-seichi-blur="true"
      loading="lazy"
      decoding="async"
    />
  )
}

export const mdxComponents = {
  SpotList,
  Callout,
  a: MdxLink,
  img: MdxImg,
}

export type MDXComponents = typeof mdxComponents
