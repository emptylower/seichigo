export type EnvDiagnosticRow = {
  /** 稳定 key，用来拼 data-testid（diag-<key>） */
  key: string
  label: string
  value: string
}

function safe(fn: () => string | number | null | undefined): string {
  try {
    const value = fn()
    if (value === null || value === undefined) return '—'
    const text = String(value)
    return text.length === 0 ? '(空)' : text
  } catch {
    return '(读取失败)'
  }
}

function countOf(selector: string): string {
  return safe(() => document.querySelectorAll(selector).length)
}

/**
 * 采集与「浏览器改了 DOM」相关的环境快照。
 *
 * 目标是定位只在 iPhone Chrome 上出现的 `insertBefore NotFoundError`：
 * 谷歌翻译会给 <html> 加 `translated-ltr` 并往文本里插 <font>，
 * iOS 数据探测器会把电话号码替换成 <a href="tel:">，
 * 这两类改动都会让 React 手里的 DOM 引用和真实 DOM 对不上。
 *
 * 只能在浏览器里调用（组件的 useEffect 内），SSR 阶段返回空数组。
 */
export function collectEnvDiagnostics(): EnvDiagnosticRow[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return []

  return [
    { key: 'href', label: 'location.href', value: safe(() => window.location.href) },
    { key: 'ua', label: 'navigator.userAgent', value: safe(() => window.navigator.userAgent) },
    { key: 'language', label: 'navigator.language', value: safe(() => window.navigator.language) },
    { key: 'html-lang', label: 'html[lang]', value: safe(() => document.documentElement.lang) },
    { key: 'html-class', label: 'html.className', value: safe(() => document.documentElement.className) },
    { key: 'font-count', label: '<font> 数量（谷歌翻译）', value: countOf('font') },
    {
      key: 'data-detector-count',
      label: 'tel: / 数据探测器数量',
      value: countOf('a[href^="tel:"], a[x-apple-data-detectors]'),
    },
    {
      key: 'format-detection',
      label: 'meta[format-detection]',
      value: safe(() => document.querySelector('meta[name="format-detection"]')?.getAttribute('content')),
    },
    { key: 'hero-node-count', label: '[data-hero-phone] 子节点数', value: countOf('[data-hero-phone] *') },
    { key: 'section-node-count', label: 'section 子节点数', value: countOf('section *') },
  ]
}
