import { describe, expect, it } from 'vitest'
import { renderSeichiRouteEmbedHtml } from '@/lib/route/render'

describe('route render', () => {
  it('falls back to svg when no google static maps key is set', () => {
    const html = renderSeichiRouteEmbedHtml({ version: 1, spots: [{ name_zh: 'A' }, { name_zh: 'B' }] })
    expect(html).toContain('<svg')
    expect(html).toContain('<table')
  })

  it('renders a google static map card when coords and key are present', () => {
    const prev = process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY = 'k'

    try {
      const html = renderSeichiRouteEmbedHtml({
        version: 1,
        spots: [
          { name_zh: 'A', lat: 35.1, lng: 139.2 },
          { name_zh: 'B', lat: 35.2, lng: 139.3 },
        ],
      })
      expect(html).toContain('seichi-route__map-card')
      expect(html).toContain('<img')
      expect(html).toContain('maps.googleapis.com/maps/api/staticmap')
      expect(html).toContain('seichi-route__map-primary')
      expect(html).toContain('www.google.com/maps/dir/')
    } finally {
      if (prev === undefined) {
        delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY
      } else {
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY = prev
      }
    }
  })
})


describe('route render 表格列（§0.7 空列不渲染 + 窄屏卡片标签）', () => {
  /** 取 <tbody> 里第一行的所有 <td ...> 开标签 */
  function firstRowCells(html: string): string[] {
    const body = html.slice(html.indexOf('<tbody>'))
    const row = body.slice(0, body.indexOf('</tr>'))
    return row.match(/<td[^>]*>/g) ?? []
  }

  it('最近站/机位建议/时间戳三列全空时不渲染表头与单元格', () => {
    const html = renderSeichiRouteEmbedHtml({
      version: 1,
      spots: [
        { name_zh: '宇治桥', googleMapsUrl: 'https://maps.google.com/?q=1' },
        { name_zh: '大吉山', googleMapsUrl: 'https://maps.google.com/?q=2' },
      ],
    })
    expect(html).toContain('>顺序<')
    expect(html).toContain('>地点<')
    expect(html).toContain('>导航<')
    expect(html).not.toContain('>最近站<')
    expect(html).not.toContain('>机位建议<')
    expect(html).not.toContain('>时间戳<')
    // 顺序 + 地点 + 导航
    expect(firstRowCells(html)).toHaveLength(3)
  })

  it('任一 spot 有 photoTip 时该列出现，另外两列仍不渲染', () => {
    const html = renderSeichiRouteEmbedHtml({
      version: 1,
      spots: [{ name_zh: '宇治桥' }, { name_zh: '大吉山', photoTip: '傍晚逆光最好' }],
    })
    expect(html).toContain('>机位建议<')
    expect(html).toContain('傍晚逆光最好')
    expect(html).not.toContain('>最近站<')
    expect(html).not.toContain('>时间戳<')
    // 顺序 + 地点 + 机位建议（无合法 URL → 无导航列）
    expect(firstRowCells(html)).toHaveLength(3)
  })

  it('没有任何合法导航 URL 时不渲染导航列', () => {
    const html = renderSeichiRouteEmbedHtml({
      version: 1,
      spots: [{ name_zh: '宇治桥', googleMapsUrl: 'javascript:alert(1)' }, { name_zh: '大吉山' }],
    })
    expect(html).not.toContain('>导航<')
    expect(html).not.toContain('>打开<')
    expect(firstRowCells(html)).toHaveLength(2)
  })

  it('每个 td 都带 data-col 与 data-label（窄屏卡片用 ::before 显示列名）', () => {
    const html = renderSeichiRouteEmbedHtml({
      version: 1,
      spots: [
        {
          name_zh: '宇治桥',
          nearestStation_zh: '宇治站',
          photoTip: '桥中央',
          animeScene: 'S1E3 12:20',
          googleMapsUrl: 'https://maps.google.com/?q=1',
        },
      ],
    })
    const cells = firstRowCells(html)
    expect(cells).toHaveLength(6)
    for (const cell of cells) {
      expect(cell).toMatch(/data-col="[a-zA-Z]+"/)
      expect(cell).toMatch(/data-label="[^"]+"/)
    }
    expect(cells[0]).toContain('data-col="order"')
    expect(cells[1]).toContain('data-col="location"')
    expect(cells[1]).toContain('data-label="地点"')
    expect(cells[5]).toContain('data-col="navigation"')
  })

  it('单元格文本仍做 HTML 转义', () => {
    const html = renderSeichiRouteEmbedHtml({
      version: 1,
      spots: [{ name_zh: '<script>x</script>', photoTip: 'a & b' }],
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
  })
})
