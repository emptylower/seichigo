/** 括号式前缀：`『X』点位名`、`《X》点位名`… */
const BRACKETS: ReadonlyArray<readonly [string, string]> = [
  ['『', '』'],
  ['《', '》'],
  ['「', '」'],
  ['【', '】'],
]

/** 分隔符式前缀：折叠之后全角空格→空格、全角冒号→冒号，只剩这两种 */
const SEPARATORS: readonly string[] = [' ', ':']

/**
 * 长度保持的折叠 + 小写（全角 ASCII + 表意空格折叠，不含半角片假名）。
 * 刻意不用 NFKC：NFKC 会改变字符串长度（如 ㍿ → 株式会社），
 * 而这里折叠后的下标要拿去 slice 原串，必须逐字符 1:1 映射。
 * 小写也因此逐字符做：`İ`.toLowerCase() 会展开成两个码位（i + 组合上点），
 * 长度一变就放弃折叠该字符，保住下标对应关系。
 */
export function foldTitleText(value: string): string {
  let out = ''
  for (const ch of String(value || '')) {
    let folded = ch
    const code = ch.codePointAt(0)!
    if (code >= 0xff01 && code <= 0xff5e) folded = String.fromCharCode(code - 0xfee0)
    else if (code === 0x3000) folded = ' '
    const lowered = folded.toLowerCase()
    out += lowered.length === folded.length ? lowered : folded
  }
  return out
}

/**
 * 把点位名开头的作品名前缀去掉。candidates 传作品的全部标题变体
 * （当前语言的 AnitabiBangumiI18n.title、titleZh、titleJaRaw、titleOriginal…）。
 * 去掉后为空则保留原名。
 */
export function stripAnimeTitlePrefix(pointName: string, candidates: readonly string[]): string {
  const name = String(pointName || '').trim()
  if (!name) return ''
  const foldedName = foldTitleText(name)

  for (const raw of candidates) {
    const title = String(raw || '').trim()
    if (!title) continue
    const foldedTitle = foldTitleText(title)
    if (!foldedTitle) continue

    for (const [open, close] of BRACKETS) {
      const prefix = `${foldTitleText(open)}${foldedTitle}${foldTitleText(close)}`
      if (!foldedName.startsWith(prefix)) continue
      const rest = name.slice(prefix.length).trim()
      if (rest) return rest
    }

    for (const separator of SEPARATORS) {
      const prefix = `${foldedTitle}${separator}`
      if (!foldedName.startsWith(prefix)) continue
      const rest = name.slice(prefix.length).trim()
      if (rest) return rest
    }
  }

  return name
}
