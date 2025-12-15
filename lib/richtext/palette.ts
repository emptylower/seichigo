export const RICH_TEXT_ALLOWED_COLORS = [
  // Gray (Tailwind)
  '#111827', // gray-900
  '#374151', // gray-700
  '#4b5563', // gray-600
  '#6b7280', // gray-500
  '#9ca3af', // gray-400
  '#d1d5db', // gray-300
  '#e5e7eb', // gray-200
  '#f3f4f6', // gray-100

  // Brand (Tailwind config: brand)
  '#ec4899', // brand-500
  '#db2777', // brand-600
  '#be185d', // brand-700
  '#9d174d', // brand-800
  '#831843', // brand-900

  // Feishu-like palette (approx)
  '#ffffff',
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#fecaca', // red-200
  '#fed7aa', // orange-200
  '#fef9c3', // yellow-100
  '#bbf7d0', // green-200
  '#bfdbfe', // blue-200
  '#e9d5ff', // purple-200
  '#f87171', // red-400
  '#fb923c', // orange-400
  '#facc15', // yellow-400
  '#4ade80', // green-400
  '#60a5fa', // blue-400
  '#c4b5fd', // purple-300
] as const

export type RichTextAllowedColor = (typeof RICH_TEXT_ALLOWED_COLORS)[number]

export const RICH_TEXT_FEISHU_TEXT_COLORS = [
  '#111827',
  '#9ca3af',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
] as const

export const RICH_TEXT_FEISHU_BG_COLORS = [
  '#ffffff',
  '#fecaca',
  '#fed7aa',
  '#fef9c3',
  '#bbf7d0',
  '#bfdbfe',
  '#e9d5ff',
  '#e5e7eb',
  '#9ca3af',
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#60a5fa',
  '#c4b5fd',
] as const
