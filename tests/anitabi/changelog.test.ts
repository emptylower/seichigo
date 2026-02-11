import { describe, expect, it } from 'vitest'
import { parseChangelogMarkdown } from '@/lib/anitabi/source/parseChangelog'

describe('anitabi changelog parser', () => {
  it('parses heading blocks and links', () => {
    const markdown = `## ✨ 地图更新 2025-10-27\n- 修复性能问题\n- 详情见 [issues](https://example.com/issues)\n\n## ✨ 地图更新 2025-10-20\n- 新增筛选项`
    const rows = parseChangelogMarkdown(markdown)

    expect(rows).toHaveLength(2)
    expect(rows[0]?.date).toBe('2025-10-27')
    expect(rows[0]?.links[0]?.url).toBe('https://example.com/issues')
    expect(rows[1]?.title).toContain('地图更新')
  })
})
