"use client"
import React from 'react'
import SpotList from '@/components/content/SpotList'
import Callout from '@/components/content/Callout'

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

export const mdxComponents = {
  SpotList,
  Callout,
  a: MdxLink,
}

export type MDXComponents = typeof mdxComponents
