import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLinkAssetSnapshot,
  compileLinkAssetMarkdownToHtml,
} from '../../scripts/generate-public-content-snapshots.mjs'

async function createLinkAssetFixture(markdown?: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seichigo-link-asset-'))
  const assetDir = path.join(root, 'content', 'link-assets')
  await fs.mkdir(assetDir, { recursive: true })
  await fs.writeFile(
    path.join(assetDir, 'fixture.json'),
    JSON.stringify({
      id: 'fixture',
      type: 'guide',
      title_zh: 'Fixture',
      contentFile: '/content/link-assets/fixture.md',
    }),
    'utf-8'
  )
  if (markdown !== undefined) {
    await fs.writeFile(path.join(assetDir, 'fixture.md'), markdown, 'utf-8')
  }
  return root
}

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

  it('fails the build when a declared link asset content file is missing', async () => {
    const root = await createLinkAssetFixture()

    try {
      await expect(buildLinkAssetSnapshot({ root })).rejects.toThrow(
        '[link-asset:fixture] cannot read declared contentFile'
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('fails the build when compiled link asset content is too short', async () => {
    const root = await createLinkAssetFixture('# Placeholder')

    try {
      await expect(buildLinkAssetSnapshot({ root })).rejects.toThrow(
        'compiled content is too short: 11 visible characters (minimum 120)'
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
