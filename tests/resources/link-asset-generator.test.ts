import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLinkAssetSnapshot,
  compileLinkAssetMarkdownToHtml,
  normalizeContentPath as normalizeBuildTimeContentPath,
} from '../../scripts/generate-public-content-snapshots.mjs'
import { normalizeContentPath } from '@/lib/linkAsset/content'

const VALID_MARKDOWN = `# Valid fixture\n\n${'Build-time content. '.repeat(12)}`

async function createLinkAssetFixture(
  markdown?: string,
  contentFile = '/content/link-assets/fixture.md'
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seichigo-link-asset-'))
  const assetDir = path.join(root, 'content', 'link-assets')
  await fs.mkdir(assetDir, { recursive: true })
  await fs.writeFile(
    path.join(assetDir, 'fixture.json'),
    JSON.stringify({
      id: 'fixture',
      type: 'guide',
      title_zh: 'Fixture',
      contentFile,
    }),
    'utf-8'
  )
  if (markdown !== undefined) {
    const markdownPath = path.join(root, contentFile.replace(/^\/+/, ''))
    await fs.mkdir(path.dirname(markdownPath), { recursive: true })
    await fs.writeFile(markdownPath, markdown, 'utf-8')
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

  it.each(['content/x.md', '/docs/x.md'])(
    'fails the build when contentFile has a runtime-incompatible shape: %s',
    async (contentFile) => {
      const root = await createLinkAssetFixture(VALID_MARKDOWN, contentFile)

      try {
        await expect(buildLinkAssetSnapshot({ root })).rejects.toThrow(
          'expected a path starting with "/content/" and containing no ".."'
        )
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    }
  )

  it.each([
    '/content/link-assets/x.md',
    ' /content/link-assets/x.md ',
    'content/x.md',
    '/docs/x.md',
    '/content/../docs/x.md',
    '',
  ])('uses the same contentFile normalization at build time and runtime: %j', (contentFile) => {
    expect(normalizeBuildTimeContentPath).toBe(normalizeContentPath)
    expect(normalizeBuildTimeContentPath(contentFile)).toBe(normalizeContentPath(contentFile))
  })
})
