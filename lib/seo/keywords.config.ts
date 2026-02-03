export interface KeywordConfig {
  keyword: string
  language: 'zh' | 'en' | 'ja'
  category: 'short-tail' | 'long-tail'
  priority: number
}

export const TARGET_KEYWORDS: KeywordConfig[] = [
  // 短尾词（长期目标）
  { keyword: '圣地巡礼', language: 'zh', category: 'short-tail', priority: 10 },
  { keyword: '聖地巡礼', language: 'ja', category: 'short-tail', priority: 10 },
  { keyword: 'anime pilgrimage', language: 'en', category: 'short-tail', priority: 10 },
  
  // 长尾词 - 你的名字
  { keyword: '你的名字 圣地巡礼', language: 'zh', category: 'long-tail', priority: 9 },
  { keyword: '你的名字 取景地', language: 'zh', category: 'long-tail', priority: 8 },
  { keyword: '君の名は 聖地', language: 'ja', category: 'long-tail', priority: 9 },
  { keyword: 'your name pilgrimage spots', language: 'en', category: 'long-tail', priority: 8 },
  
  // 长尾词 - 孤独摇滚
  { keyword: '孤独摇滚 圣地巡礼', language: 'zh', category: 'long-tail', priority: 9 },
  { keyword: 'ぼっち・ざ・ろっく 聖地', language: 'ja', category: 'long-tail', priority: 9 },
  { keyword: 'bocchi the rock locations', language: 'en', category: 'long-tail', priority: 8 },
  
  // 长尾词 - 城市相关
  { keyword: '东京 动漫取景地', language: 'zh', category: 'long-tail', priority: 7 },
  { keyword: '京都 动漫圣地', language: 'zh', category: 'long-tail', priority: 7 },
  { keyword: '東京 アニメ聖地', language: 'ja', category: 'long-tail', priority: 7 },
  { keyword: 'tokyo anime locations', language: 'en', category: 'long-tail', priority: 7 },
]
