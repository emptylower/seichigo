import { describe, expect, it } from 'vitest'
import { buildPageCardHtml } from '@/lib/og/pageCardHtml'

const BASE = {
  kind: 'post' as const,
  locale: 'zh' as const,
  title: '《孤独摇滚》下北泽巡礼路线',
  subtitle: '孤独摇滚 · 东京',
  coverDataUri: 'data:image/jpeg;base64,AAECAw==',
}

describe('buildPageCardHtml', () => {
  it('标题与副标题全部 HTML 转义', () => {
    const html = buildPageCardHtml({
      ...BASE,
      title: '<script>alert("x")</script>',
      subtitle: `a'b"c & <img src=x>`,
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;')
    expect(html).toContain('&#39;')
    expect(html).toContain('&amp;')
  })

  it('无封面时渲染品牌渐变块，不输出 img', () => {
    const html = buildPageCardHtml({ ...BASE, coverDataUri: null })
    expect(html).toContain('<div class="brand">SeichiGo</div>')
    expect(html).not.toContain('<img')
  })

  it('有封面时内联 data URI，不留外链', () => {
    const html = buildPageCardHtml(BASE)
    expect(html).toContain('src="data:image/jpeg;base64,AAECAw=="')
    expect(html).not.toContain('src="http')
  })

  it('三语 kind 标签与 tagline', () => {
    const zh = buildPageCardHtml({ ...BASE, locale: 'zh' })
    expect(zh).toContain('>文章</span>')
    expect(zh).toContain('5 万+ 动画取景地')
    const en = buildPageCardHtml({ ...BASE, kind: 'anime', locale: 'en' })
    expect(en).toContain('>Anime</span>')
    const ja = buildPageCardHtml({ ...BASE, kind: 'city', locale: 'ja' })
    expect(ja).toContain('>都市</span>')
    expect(ja).toContain('アニメ聖地')
  })

  it('lang 属性随 locale 变化（CJK 字形关键）', () => {
    expect(buildPageCardHtml({ ...BASE, locale: 'zh' })).toContain('lang="zh-CN"')
    expect(buildPageCardHtml({ ...BASE, locale: 'ja' })).toContain('lang="ja"')
    expect(buildPageCardHtml({ ...BASE, locale: 'en' })).toContain('lang="en"')
  })
})
