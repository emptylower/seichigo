export const RICH_TEXT_ALLOWED_FONT_FAMILIES = [
  // Generic families
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',

  // Common web/system fonts
  '-apple-system',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'inter',

  // Common CJK fonts (best-effort)
  'pingfang sc',
  'hiragino sans gb',
  'microsoft yahei',
  'noto sans sc',
  'noto serif sc',
  'source han sans sc',
  'source han serif sc',
  'simhei',
  'simsun',
] as const

export type RichTextAllowedFontFamily = (typeof RICH_TEXT_ALLOWED_FONT_FAMILIES)[number]

