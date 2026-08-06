import { describe, expect, it } from 'vitest'
import { compileLinkAssetMarkdownToHtml } from '../../scripts/generate-public-content-snapshots.mjs'

describe('link asset snapshot generator', () => {
  it('renders the supported link asset MDX at build time', async () => {
    const html = await compileLinkAssetMarkdownToHtml(`
<Callout type="warn">callout body</Callout>

[internal link](/resources)

![asset image](/assets/example)
`)

    expect(html).toContain('callout body')
    expect(html).toContain('bg-amber-50 border-amber-200 text-amber-900')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('data-seichi-full="/assets/example"')
  })

  it('fails when link asset MDX uses an unmapped component', async () => {
    await expect(compileLinkAssetMarkdownToHtml('<SpotList spots={[]} />')).rejects.toThrow(
      'Expected component `SpotList` to be defined'
    )
  })
})
