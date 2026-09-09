import { describe, expect, it } from 'vitest'
import {
  CARD_METRICS,
  buildAnimeMetaLine,
  buildCardHtml,
  escapeHtml,
  formatSceneTime,
  type CardHtmlInput,
  type CardMetrics,
} from '@/lib/share/cardHtml'
import { SHARE_CARD_SIZES } from '@/lib/share/types'

describe('formatSceneTime', () => {
  it('纯数字秒数格式化成 mm:ss / h:mm:ss', () => {
    expect(formatSceneTime('1194')).toBe('19:54')
    expect(formatSceneTime('65')).toBe('1:05')
    expect(formatSceneTime('3725')).toBe('1:02:05')
  })

  it('非纯数字原样返回', () => {
    expect(formatSceneTime('第3話 冒頭')).toBe('第3話 冒頭')
  })
})

describe('escapeHtml', () => {
  it('转义会破坏结构的五个字符', () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;',
    )
  })

  it('null / undefined 转成空串', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('buildAnimeMetaLine', () => {
  it('zh 用书名号、en 裸标题、ja 用双重角括号', () => {
    const base = { animeTitle: '你的名字。', episode: '1', scene: '1194' } as const
    expect(buildAnimeMetaLine({ ...base, locale: 'zh' })).toBe('《你的名字。》 · 第 1 集 · 19:54')
    expect(buildAnimeMetaLine({ ...base, locale: 'en' })).toBe('你的名字。 · EP 1 · 19:54')
    expect(buildAnimeMetaLine({ ...base, locale: 'ja' })).toBe('『你的名字。』 · 第1話 · 19:54')
  })

  it('缺段就少段，全缺返回空串', () => {
    expect(buildAnimeMetaLine({ locale: 'zh', animeTitle: '孤独摇滚', episode: null, scene: null })).toBe(
      '《孤独摇滚》',
    )
    expect(buildAnimeMetaLine({ locale: 'zh', animeTitle: '', episode: null, scene: null })).toBe('')
  })
})

describe('CARD_METRICS', () => {
  it('画布尺寸与 SHARE_CARD_SIZES 一致', () => {
    expect(CARD_METRICS.portrait.width).toBe(SHARE_CARD_SIZES.portrait.width)
    expect(CARD_METRICS.portrait.height).toBe(SHARE_CARD_SIZES.portrait.height)
    expect(CARD_METRICS.landscape.width).toBe(SHARE_CARD_SIZES.landscape.width)
    expect(CARD_METRICS.landscape.height).toBe(SHARE_CARD_SIZES.landscape.height)
  })

  it('沿用线上导航胶囊版的关键数值', () => {
    expect(CARD_METRICS.landscape.visual).toBe(640)
    expect(CARD_METRICS.landscape.columnLeft).toBe(32)
    expect(CARD_METRICS.landscape.outlineSize).toBe(100)
    expect(CARD_METRICS.landscape.qrSize).toBe(100)
    expect(CARD_METRICS.portrait.visual).toBe(640)
    expect(CARD_METRICS.portrait.padding).toBe(64)
    expect(CARD_METRICS.portrait.outlineSize).toBe(180)
    expect(CARD_METRICS.portrait.nameSize).toBe(60)
    expect(CARD_METRICS.portrait.nameLines).toBe(2)
    expect(CARD_METRICS.landscape.nameLines).toBe(1)
  })
})

const BASE: CardHtmlInput = {
  layout: 'landscape',
  locale: 'zh',
  displayName: '须贺神社',
  animeTitle: '你的名字。',
  episode: '1',
  scene: '19:54',
  address: '東京都 新宿区 须贺町',
  note: '男女主角重逢的阶梯',
  geo: [35.6895, 139.7],
  inJapan: true,
  animeImageDataUri: 'data:image/webp;base64,QUJD',
  photoDataUri: null,
  qrTargetUrl: 'https://seichigo.com/map?b=101&p=101%3Asuga',
  text: { qrTitle: '扫码获取点位导航', qrSub: '地图 · 交通 · 周边点位', tagline: '5 万+ 动画取景地' },
}

describe('buildCardHtml', () => {
  it('输出完整 HTML 文档，body 固定为该版式尺寸', () => {
    const html = buildCardHtml(BASE)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).toContain('width:1200px')
    expect(html).toContain('height:630px')
    expect(html).toContain('margin:0')
    expect(html).toContain('overflow:hidden')
  })

  it('竖版换成 1080×1440', () => {
    const html = buildCardHtml({ ...BASE, layout: 'portrait' })
    expect(html).toContain('width:1080px')
    expect(html).toContain('height:1440px')
  })

  it('用 Browser Run 自带的 CJK 字体栈', () => {
    expect(buildCardHtml(BASE)).toContain(
      '"Noto Sans CJK SC","Noto Sans CJK JP",system-ui,sans-serif',
    )
  })

  it('断行交给浏览器：点位名与说明用 -webkit-line-clamp', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('-webkit-line-clamp:1')
    expect(html).toContain('-webkit-line-clamp:2')
    const portrait = buildCardHtml({ ...BASE, layout: 'portrait' })
    expect(portrait).toContain('-webkit-line-clamp:2')
  })

  it('line-clamp 失效时靠 max-height 保险，不会顶出画布被静默裁掉', () => {
    const html = buildCardHtml(BASE)
    // landscape：nameLines=1 → 1.25em
    expect(html).toContain('max-height:1.25em')
    expect(html).toContain('max-height:1.3em')
    expect(html).toContain('max-height:2.7em')
    const portrait = buildCardHtml({ ...BASE, layout: 'portrait' })
    // portrait：nameLines=2 → 2.50em
    expect(portrait).toContain('max-height:2.50em')
  })

  it('文字全部转义，不留未替换占位符', () => {
    const html = buildCardHtml({ ...BASE, displayName: '<script>x</script>' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x</script>')
    expect(html).not.toMatch(/\{\{|\}\}|__[A-Z_]+__/)
  })

  it('有动画截图时内联 base64，没有时用粉色渐变兜底', () => {
    expect(buildCardHtml(BASE)).toContain('src="data:image/webp;base64,QUJD"')
    const noImage = buildCardHtml({ ...BASE, animeImageDataUri: null })
    expect(noImage).not.toContain('data:image')
    expect(noImage).toContain('linear-gradient(135deg,#fce7f3,#fdf2f8)')
  })

  it('img src 过 escapeHtml，data URI 携带引号时逃不出属性', () => {
    const html = buildCardHtml({ ...BASE, animeImageDataUri: 'data:image/jpeg;base64,ab"c' })
    expect(html).toContain('src="data:image/jpeg;base64,ab&quot;c"')
    expect(html).not.toContain('ab"c')
  })

  it('有实拍时切对比布局（两张图都出现）', () => {
    const html = buildCardHtml({ ...BASE, photoDataUri: 'data:image/jpeg;base64,WFla' })
    expect(html).toContain('data:image/webp;base64,QUJD')
    expect(html).toContain('data:image/jpeg;base64,WFla')
    expect(html).toContain('class="visual compare"')
  })

  it('无地址 / 无说明时对应的行整体不渲染', () => {
    const html = buildCardHtml({ ...BASE, address: null, note: null })
    expect(html).not.toContain('class="row address"')
    expect(html).not.toContain('class="row note"')
    expect(html).toContain('class="row name"')
  })

  it('inJapan 为 false 时不渲染轮廓', () => {
    const html = buildCardHtml({ ...BASE, inJapan: false, geo: [1.35, 103.8] })
    expect(html).not.toContain('class="locator"')
  })

  it('无坐标时不渲染坐标行，胶囊只剩两行', () => {
    const html = buildCardHtml({ ...BASE, geo: null, inJapan: false })
    expect(html).not.toContain('class="cap-coord"')
    expect(html).toContain('class="cap-title')
    expect(html).toContain('class="cap-sub')
  })

  it('有坐标时坐标行保留 4 位小数并用等宽字体', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('35.6895, 139.7000')
    expect(html).toContain('ui-monospace')
  })

  it('二维码内联成 SVG，且编码的是稳定深链而不是短链', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(html).not.toContain('/s/')
  })

  it('三语 × 两版式都能出图且都带页脚站点名', () => {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      for (const layout of ['portrait', 'landscape'] as const) {
        const html = buildCardHtml({ ...BASE, locale, layout })
        expect(html, `${locale}/${layout}`).toContain('seichigo.com')
        expect(html, `${locale}/${layout}`).toContain('5 万+ 动画取景地')
      }
    }
  })

  it('页脚站点名前是矢量小鸟居，不用 emoji', () => {
    const html = buildCardHtml(BASE)
    expect(html).toContain('class="torii"')
    expect(html).not.toContain('⛩')
  })

  it('scene 传原始秒数，mm:ss 在 cardHtml 内部格式化', () => {
    const html = buildCardHtml({ ...BASE, scene: '1194' })
    expect(html).toContain('19:54')
  })
})

describe('卡片说明行几何', () => {
  /** 胶囊高度：上下内边距 + 三列（轮廓 / 二维码 / 中间文字列）取最高；中间列行高按 CSS 的 1.2 */
  function capsuleHeight(m: CardMetrics): number {
    const middle =
      m.titleSize * 1.2 + (m.coordSize * 1.2 + m.titleGap) + (m.subSize * 1.2 + m.subGap)
    return m.capsulePadV * 2 + Math.max(m.outlineSize, m.qrSize, middle)
  }

  /** 说明取满 noteLines 行时右列整栈的高度：行高统一按 fontSize * 1.35 保守计，行间距用 metrics 的 gap 常量 */
  function columnStackHeight(m: CardMetrics): number {
    const rows =
      m.nameLines * m.nameSize * 1.35 +
      m.nameGap +
      m.animeSize * 1.35 +
      m.animeGap +
      m.addressSize * 1.35 +
      m.addressGap +
      m.noteLines * m.noteSize * 1.35
    return (
      m.columnTop +
      rows +
      m.capsuleTopGap +
      capsuleHeight(m) +
      m.footerGap +
      m.footerSize +
      m.columnBottom
    )
  }

  it('两种版式取满 noteLines 行仍不超过画布高度', () => {
    for (const layout of ['portrait', 'landscape'] as const) {
      const m = CARD_METRICS[layout]
      expect(columnStackHeight(m), layout).toBeLessThanOrEqual(m.height)
    }
  })

  it('noteLines 下限：横版 >= 6、竖版 >= 4，防止被误改回 2', () => {
    expect(CARD_METRICS.landscape.noteLines).toBeGreaterThanOrEqual(6)
    expect(CARD_METRICS.portrait.noteLines).toBeGreaterThanOrEqual(4)
  })

  it('说明行的 class 与 clamp CSS 由 metrics.noteLines 生成', () => {
    for (const layout of ['portrait', 'landscape'] as const) {
      const m = CARD_METRICS[layout]
      const html = buildCardHtml({ ...BASE, layout })
      expect(html, layout).toContain(`class="row note clamp${m.noteLines}"`)
      expect(html, layout).toContain(
        `.clamp${m.noteLines}{-webkit-line-clamp:${m.noteLines};max-height:${(m.noteLines * 1.35).toFixed(2)}em}`,
      )
    }
  })
})
