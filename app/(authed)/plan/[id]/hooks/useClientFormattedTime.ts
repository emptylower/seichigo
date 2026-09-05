'use client'

import { useEffect, useState } from 'react'

/**
 * 水合安全的时间文本（React #418）：服务端（Cloudflare，UTC）与浏览器
 * 本地时区对同一时刻的格式化结果不同，渲染期直接算会产生文本水合
 * 不一致。统一模式：首帧返回空值（服务端渲染与客户端首次渲染一致），
 * useEffect 后再填本地时区文本；点击态取值发生在挂载后，天然是本地格式。
 */

const pad2 = (n: number) => String(n).padStart(2, '0')

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 快照时间戳文本：本地时区 MM-DD HH:mm；无法解析返回空串 */
export function formatSnapshotTimestamp(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 首帧 ''，effect 后返回本地时区 MM-DD HH:mm（daymap 快照「已保存」标签） */
export function useClientFormattedTime(iso: string | null | undefined): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    setLabel(iso ? formatSnapshotTimestamp(iso) : '')
  }, [iso])
  return label
}

/**
 * 同模式通用版：渲染期依赖本地时区/当前时刻的文本（如「今天/昨天/M月D日」），
 * 首帧 ''，effect 后填充 compute(key)；key 变化（如列表刷新拿到新 updatedAt）重算。
 * compute 需传模块级稳定引用（如顶层函数），避免每次渲染重算。
 */
export function useClientText(key: string, compute: (key: string) => string): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    setLabel(key ? compute(key) : '')
  }, [key, compute])
  return label
}

/** 首帧 null，effect 后返回本地「今天」0 点（日历/月份 chips 等渲染期文本依赖它） */
export function useClientToday(): Date | null {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => {
    setToday(startOfLocalDay(new Date()))
  }, [])
  return today
}
