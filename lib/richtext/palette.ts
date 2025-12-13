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
] as const

export type RichTextAllowedColor = (typeof RICH_TEXT_ALLOWED_COLORS)[number]

