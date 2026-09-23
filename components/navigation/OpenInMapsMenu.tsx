'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigation, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { NavProvider, NavTarget } from '@/lib/route/navigationTargets'
import { launchAppWithFallback, useOrderedNavTargets } from './navLaunch'

function tx(key: string, locale: SupportedLocale, vars?: Record<string, string | number>): string {
  let out = t(`routebook.nav.${key}`, locale)
  for (const [name, value] of Object.entries(vars ?? {})) out = out.split(`{${name}}`).join(String(value))
  return out
}

const PROVIDER_LABEL_KEY: Record<NavProvider, string> = {
  google: 'google',
  apple: 'apple',
  amap: 'amap',
}

const PROVIDER_DOT: Record<NavProvider, string> = {
  google: 'bg-sky-500',
  apple: 'bg-slate-800',
  amap: 'bg-blue-500',
}

type OptionRow = {
  key: string
  provider: NavProvider
  label: string
  note: string | null
  url: string
  appUrl?: string
}

/** 一个 target 可能展开多行：Google 整天超过 waypoints 上限时每段一行 */
function toRows(targets: NavTarget[], locale: SupportedLocale): OptionRow[] {
  const rows: OptionRow[] = []
  for (const target of targets) {
    const label = tx(PROVIDER_LABEL_KEY[target.provider], locale)
    const note =
      target.note === 'endpointsOnly'
        ? tx('endpointsOnly', locale)
        : target.note === 'viaTruncated'
          ? tx('viaTruncated', locale)
          : null
    const segments = target.urls && target.urls.length > 1 ? target.urls : null
    if (segments) {
      segments.forEach((url, index) => {
        rows.push({
          key: `${target.provider}:${index}`,
          provider: target.provider,
          label: `${label} · ${tx('segment', locale, { n: index + 1, total: segments.length })}`,
          note,
          url,
        })
      })
      continue
    }
    rows.push({ key: target.provider, provider: target.provider, label, note, url: target.url, appUrl: target.appUrl })
  }
  return rows
}

type OptionsProps = {
  targets: NavTarget[]
  locale: SupportedLocale
  /** 点了某一项之后（关闭外层菜单/sheet） */
  onPicked?: () => void
  /** dropdown 用 menuitem 语义；sheet 内是普通链接列表 */
  asMenu?: boolean
}

/** 三家地图选项列表（已按平台/语言排序）；高德有 appUrl 时先唤起 app、超时回退网页 */
export function OpenInMapsOptions({ targets, locale, onPicked, asMenu = false }: OptionsProps) {
  const ordered = useOrderedNavTargets(targets, locale)
  const rows = toRows(ordered, locale)

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <a
          key={row.key}
          href={row.url}
          target="_blank"
          rel="noreferrer"
          role={asMenu ? 'menuitem' : undefined}
          data-provider={row.provider}
          className="flex w-full items-center gap-3 rounded-2xl border border-pink-100/80 bg-white px-3.5 py-2.5 text-left no-underline transition hover:border-brand-200 hover:bg-pink-50/60"
          onClick={(event) => {
            if (row.appUrl) {
              event.preventDefault()
              launchAppWithFallback(row.appUrl, row.url)
            }
            onPicked?.()
          }}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PROVIDER_DOT[row.provider]}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{row.label}</span>
          {row.note ? (
            <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {row.note}
            </span>
          ) : null}
        </a>
      ))}
    </div>
  )
}

type MenuProps = {
  targets: NavTarget[]
  locale: SupportedLocale
  /** dropdown：桌面下拉；sheet：移动端底部 action sheet */
  presentation?: 'dropdown' | 'sheet'
  /** 触发按钮文案，缺省「打开导航」 */
  label?: string
  triggerClassName?: string
  icon?: ReactNode
}

const DEFAULT_TRIGGER =
  'inline-flex min-h-8 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-pink-100/60 disabled:cursor-not-allowed disabled:opacity-40'

const MENU_WIDTH = 256
const MENU_EST_HEIGHT = 220

type MenuPos = { left: number; top?: number; bottom?: number }

/** 下拉挂到 body 上（fixed 定位），不被侧栏/浮卡的 overflow 裁掉；下方放不下时向上展开 */
function computeMenuPos(trigger: HTMLElement): MenuPos {
  const rect = trigger.getBoundingClientRect()
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8))
  if (rect.bottom + MENU_EST_HEIGHT > window.innerHeight && rect.top > MENU_EST_HEIGHT) {
    return { left, bottom: window.innerHeight - rect.top + 6 }
  }
  return { left, top: rect.bottom + 6 }
}

/** 「打开导航」按钮 + 地图应用选择（Google / Apple 地图 / 高德地图） */
export function OpenInMapsMenu({
  targets,
  locale,
  presentation = 'dropdown',
  label,
  triggerClassName = DEFAULT_TRIGGER,
  icon,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || presentation !== 'dropdown') return
    const close = () => setOpen(false)
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, presentation])

  const text = label ?? tx('open', locale)
  const disabled = targets.length === 0

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup={presentation === 'dropdown' ? 'menu' : 'dialog'}
        aria-expanded={open}
        className={triggerClassName}
        onClick={(event) => {
          event.stopPropagation()
          if (!open && presentation === 'dropdown' && triggerRef.current) setPos(computeMenuPos(triggerRef.current))
          setOpen((prev) => !prev)
        }}
      >
        {icon ?? <Navigation className="h-3.5 w-3.5 text-brand-500" />}
        {text}
      </button>

      {open && presentation === 'dropdown' && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={tx('menuLabel', locale)}
              style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_WIDTH }}
              className="z-[130] rounded-2xl border border-pink-100 bg-white p-2 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]"
              onClick={(event) => event.stopPropagation()}
            >
              <OpenInMapsOptions targets={targets} locale={locale} asMenu onPicked={() => setOpen(false)} />
            </div>,
            document.body
          )
        : null}

      {open && presentation === 'sheet' ? (
        <OpenInMapsSheet targets={targets} locale={locale} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

/** 移动端 action sheet（底部抽屉） */
export function OpenInMapsSheet({
  targets,
  locale,
  onClose,
  children,
}: {
  targets: NavTarget[]
  locale: SupportedLocale
  onClose: () => void
  /** 列表上方的附加内容（如当天交通方式切换） */
  children?: ReactNode
}) {
  // 挂到 body：祖先的 backdrop-filter / overflow 会让 fixed 失效或被裁
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={t('routebook.common.close', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={tx('sheetTitle', locale)}
        className="relative mb-0 w-full max-w-md rounded-t-[28px] border border-pink-100 bg-white p-4 shadow-[0_-18px_44px_-24px_rgba(15,23,42,0.45)]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-base font-semibold text-slate-900">{tx('sheetTitle', locale)}</h3>
          <button
            type="button"
            aria-label={t('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        <OpenInMapsOptions targets={targets} locale={locale} onPicked={onClose} />
      </div>
    </div>,
    document.body
  )
}
