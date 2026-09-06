'use client'

import { useCallback, useEffect, useState } from 'react'
import { toIntlLocale } from '@/lib/i18n/intlLocale'
import type { SupportedLocale } from '@/lib/i18n/types'

/**
 * 水合安全的时间文本（React #418）：服务端（Cloudflare，UTC）与浏览器
 * 本地时区对同一时刻的格式化结果不同，渲染期直接算会产生文本水合
 * 不一致。统一模式：首帧返回空值（服务端渲染与客户端首次渲染一致），
 * useEffect 后再填本地时区文本；点击态取值发生在挂载后，天然是本地格式。
 */

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 快照时间戳文本：本地时区 MM/DD HH:mm（按站点语言格式化）；无法解析返回空串 */
export function formatSnapshotTimestamp(iso: string, locale: SupportedLocale = 'zh'): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms)
  const intl = toIntlLocale(locale)
  const date = new Intl.DateTimeFormat(intl, { month: '2-digit', day: '2-digit' }).format(d)
  const time = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${date} ${time}`
}

/** 首帧 ''，effect 后返回本地时区 MM/DD HH:mm（daymap 快照「已保存」标签） */
export function useClientFormattedTime(iso: string | null | undefined, locale: SupportedLocale = 'zh'): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    setLabel(iso ? formatSnapshotTimestamp(iso, locale) : '')
  }, [iso, locale])
  return label
}

/**
 * 同模式通用版：渲染期依赖本地时区/当前时刻的文本（如「今天/昨天/M月D日」），
 * 首帧 ''，effect 后填充 compute(key)；key 变化（如列表刷新拿到新 updatedAt）重算。
 * compute 需传稳定引用（模块级函数或 useCallback），避免每次渲染重算。
 */
export function useClientText(key: string, compute: (key: string) => string): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    setLabel(key ? compute(key) : '')
  }, [key, compute])
  return label
}

/** useClientText 的 locale 版：把 compute 与 locale 绑成稳定引用 */
export function useClientLocaleText(
  key: string,
  compute: (key: string, locale: SupportedLocale) => string,
  locale: SupportedLocale,
): string {
  const bound = useCallback((value: string) => compute(value, locale), [compute, locale])
  return useClientText(key, bound)
}

/** 首帧 null，effect 后返回本地「今天」0 点（日历/月份 chips 等渲染期文本依赖它） */
export function useClientToday(): Date | null {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => {
    setToday(startOfLocalDay(new Date()))
  }, [])
  return today
}
