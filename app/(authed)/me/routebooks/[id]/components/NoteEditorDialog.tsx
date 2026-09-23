'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bookmark,
  Camera,
  Clock,
  Info,
  Loader2,
  ShoppingBag,
  Star,
  StickyNote,
  Ticket,
  TrainFront,
  Utensils,
  X,
} from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../../i18n'

export type NoteIcon = 'info' | 'clock' | 'train' | 'utensils' | 'ticket' | 'camera' | 'shopping-bag' | 'alert' | 'star' | 'bookmark'
export type NoteColor = 'gray' | 'pink' | 'amber' | 'green' | 'sky' | 'violet'

export type NoteEditorSubmit = {
  title: string
  note: string | null
  icon: NoteIcon
  color: NoteColor
  timeStart: string | null
}

const NOTE_ICONS: { key: NoteIcon; Icon: typeof Info }[] = [
  { key: 'info', Icon: Info },
  { key: 'clock', Icon: Clock },
  { key: 'train', Icon: TrainFront },
  { key: 'utensils', Icon: Utensils },
  { key: 'ticket', Icon: Ticket },
  { key: 'camera', Icon: Camera },
  { key: 'shopping-bag', Icon: ShoppingBag },
  { key: 'alert', Icon: AlertTriangle },
  { key: 'star', Icon: Star },
  { key: 'bookmark', Icon: Bookmark },
]

const NOTE_COLORS: { key: NoteColor; swatch: string }[] = [
  { key: 'gray', swatch: 'bg-slate-300' },
  { key: 'pink', swatch: 'bg-pink-400' },
  { key: 'amber', swatch: 'bg-amber-400' },
  { key: 'green', swatch: 'bg-emerald-400' },
  { key: 'sky', swatch: 'bg-sky-400' },
  { key: 'violet', swatch: 'bg-violet-400' },
]

type Props = {
  open: boolean
  /** 标题栏显示目标天（如「Day 2」） */
  dayLabelText?: string
  onSubmit: (input: NoteEditorSubmit) => Promise<boolean | void> | boolean | void
  onClose: () => void
  locale?: SupportedLocale
}

/** 备注条目编辑：标题、详情、图标、颜色、可选时间 */
export function NoteEditorDialog({ open, dayLabelText, onSubmit, onClose, locale = 'zh' }: Props) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [icon, setIcon] = useState<NoteIcon>('info')
  const [color, setColor] = useState<NoteColor>('gray')
  const [timeStart, setTimeStart] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNote('')
    setIcon('info')
    setColor('gray')
    setTimeStart('')
    setSubmitting(false)
  }, [open])

  if (!open) return null

  const valid = title.trim().length > 0

  const handleSubmit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    const outcome = await onSubmit({
      title: title.trim(),
      note: note.trim() || null,
      icon,
      color,
      timeStart: timeStart || null,
    })
    setSubmitting(false)
    if (outcome !== false) onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label={tr('routebook.common.close', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-pink-100 bg-white p-5 shadow-2xl sm:rounded-[28px]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <StickyNote className="h-4 w-4 text-brand-500" />
            {tr('routebook.note.dialogTitle', locale)}
            {dayLabelText ? <span className="text-xs font-normal text-slate-400">{dayLabelText}</span> : null}
          </h3>
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.note.titleLabel', locale)}</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={tr('routebook.note.titlePlaceholder', locale)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.note.detailLabel', locale)}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
            />
          </label>

          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-500">{tr('routebook.note.iconLabel', locale)}</div>
            <div className="grid grid-cols-5 gap-1.5">
              {NOTE_ICONS.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={tr(`routebook.note.icon.${key}`, locale)}
                  aria-pressed={icon === key}
                  className={`inline-flex h-10 items-center justify-center rounded-xl border transition ${
                    icon === key
                      ? 'border-brand-500 bg-brand-50 text-brand-600'
                      : 'border-slate-200 bg-white text-slate-400 hover:bg-pink-50'
                  }`}
                  onClick={() => setIcon(key)}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-500">{tr('routebook.note.colorLabel', locale)}</div>
            <div className="flex gap-2">
              {NOTE_COLORS.map(({ key, swatch }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={tr(`routebook.note.color.${key}`, locale)}
                  aria-pressed={color === key}
                  className={`h-8 w-8 rounded-full ${swatch} transition ${
                    color === key ? 'ring-2 ring-brand-500 ring-offset-2' : 'opacity-60 hover:opacity-100'
                  }`}
                  onClick={() => setColor(key)}
                />
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.note.timeLabel', locale)}</span>
            <input
              type="time"
              value={timeStart}
              onChange={(event) => setTimeStart(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
            />
          </label>

          <button
            type="button"
            disabled={!valid || submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[20px] bg-brand-500 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {tr('routebook.note.submit', locale)}
          </button>
        </div>
      </div>
    </div>
  )
}
