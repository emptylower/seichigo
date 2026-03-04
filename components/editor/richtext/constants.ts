export type TextColorOption = {
  label: string
  value: string | null
  swatch: string
}

export type BackgroundColorOption = {
  label: string
  value: string | null
  swatch?: string
}

export const TEXT_COLORS: TextColorOption[] = [
  { label: '默认', value: null, swatch: '#111827' },
  { label: '灰', value: '#9ca3af', swatch: '#9ca3af' },
  { label: '红', value: '#ef4444', swatch: '#ef4444' },
  { label: '橙', value: '#f97316', swatch: '#f97316' },
  { label: '黄', value: '#f59e0b', swatch: '#f59e0b' },
  { label: '绿', value: '#22c55e', swatch: '#22c55e' },
  { label: '蓝', value: '#3b82f6', swatch: '#3b82f6' },
  { label: '紫', value: '#8b5cf6', swatch: '#8b5cf6' },
]

export const BG_COLORS: BackgroundColorOption[] = [
  { label: '无', value: null },
  { label: '白', value: '#ffffff', swatch: '#ffffff' },
  { label: '浅红', value: '#fecaca', swatch: '#fecaca' },
  { label: '浅橙', value: '#fed7aa', swatch: '#fed7aa' },
  { label: '浅黄', value: '#fef9c3', swatch: '#fef9c3' },
  { label: '浅绿', value: '#bbf7d0', swatch: '#bbf7d0' },
  { label: '浅蓝', value: '#bfdbfe', swatch: '#bfdbfe' },
  { label: '浅紫', value: '#e9d5ff', swatch: '#e9d5ff' },
  { label: '浅灰', value: '#e5e7eb', swatch: '#e5e7eb' },
  { label: '灰', value: '#9ca3af', swatch: '#9ca3af' },
  { label: '红', value: '#f87171', swatch: '#f87171' },
  { label: '橙', value: '#fb923c', swatch: '#fb923c' },
  { label: '黄', value: '#facc15', swatch: '#facc15' },
  { label: '绿', value: '#4ade80', swatch: '#4ade80' },
  { label: '蓝', value: '#60a5fa', swatch: '#60a5fa' },
  { label: '紫', value: '#c4b5fd', swatch: '#c4b5fd' },
]
