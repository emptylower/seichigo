export type KeywordLanguage = 'zh' | 'en' | 'ja'
export type KeywordCategory = 'short-tail' | 'long-tail'

function hasJapaneseKana(text: string) {
  // Hiragana + Katakana (includes prolonged sound mark in Katakana block)
  return /[\u3040-\u30ff]/.test(text)
}

function hasLatinLetters(text: string) {
  return /[A-Za-z]/.test(text)
}

export function inferKeywordLanguage(keyword: string): KeywordLanguage {
  if (hasJapaneseKana(keyword)) return 'ja'
  if (hasLatinLetters(keyword)) return 'en'
  return 'zh'
}

export function inferKeywordCategory(keyword: string, language?: KeywordLanguage): KeywordCategory {
  const lang = language ?? inferKeywordLanguage(keyword)

  if (lang === 'en') {
    const words = keyword.trim().split(/\s+/).filter(Boolean)
    return words.length <= 2 ? 'short-tail' : 'long-tail'
  }

  const chars = keyword.replace(/\s+/g, '').length
  return chars <= 4 ? 'short-tail' : 'long-tail'
}

