import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { extractSummaryFromZipBuffer } from '@/lib/seo/spokeFactory/artifact'

describe('seo spoke factory artifact parsing', () => {
  it('extracts summary from artifact zip buffer', async () => {
    const zip = new JSZip()
    zip.file(
      'seo-spoke-factory-summary/summary.json',
      JSON.stringify({
        mode: 'preview',
        selectedTopics: 3,
        generatedFiles: 0,
        skippedExisting: 1,
        skippedLowConfidence: 2,
        skipped: [{ reason: 'low-confidence', value: 'x' }],
        errors: [],
        topics: [],
        files: [],
        prUrl: null,
      })
    )

    const zipBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
    const parsed = await extractSummaryFromZipBuffer(zipBuffer)

    expect(parsed).not.toBeNull()
    expect(parsed?.mode).toBe('preview')
    expect(parsed?.selectedTopics).toBe(3)
    expect(parsed?.skippedExisting).toBe(1)
  })

  it('returns null for invalid zip payload', async () => {
    const parsed = await extractSummaryFromZipBuffer(Buffer.from('not-a-zip'))
    expect(parsed).toBeNull()
  })
})
