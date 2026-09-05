import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderFirstViewCanaryMarkdown } from '@/features/map/anitabi/firstViewCanary'

const CANARY_ARTIFACT_PATH = '.omx/specs/canary-map-first-view-slots.md'

// .omx 是 gitignored 的本地产物：文件不存在时跳过而不是失败（低-9）
const canaryArtifactExists = existsSync(CANARY_ARTIFACT_PATH)
if (!canaryArtifactExists) {
  console.warn(
    `[first-view-canary] ${CANARY_ARTIFACT_PATH} not found (gitignored local artifact); skipping sync check`
  )
}

describe('first-view canary artifact', () => {
  it.skipIf(!canaryArtifactExists)(
    'keeps the markdown artifact in sync with the canonical canary source',
    () => {
      const actual = readFileSync(CANARY_ARTIFACT_PATH, 'utf8')
      expect(actual).toBe(renderFirstViewCanaryMarkdown())
    }
  )
})
