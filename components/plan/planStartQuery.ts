/** searchParams 里的参数统一取第一项（`?draft=a&draft=b` 用 a）；三语起始页共用 */
export function firstQueryValue(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0] ?? ''
  return ''
}
