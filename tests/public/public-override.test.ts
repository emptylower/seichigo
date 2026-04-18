import { describe, expect, it } from 'vitest'
import { pickBestOverride, validatePublicOverrideInput, type PublicOverrideRecord } from '@/lib/publicOverride/service'

function makeRecord(overrides: Partial<PublicOverrideRecord> = {}): PublicOverrideRecord {
  return {
    id: 'ovr-1',
    targetType: 'post',
    targetKey: 'test-post',
    locale: null,
    action: 'hide',
    redirectUrl: null,
    title: null,
    bodyText: null,
    ctaLabel: null,
    ctaHref: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    rollbackSnapshotVersion: 'snapshot-1',
    note: null,
    createdById: null,
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('public override service', () => {
  it('prefers locale-specific override over global fallback', () => {
    const picked = pickBestOverride(
      [
        makeRecord({ id: 'global', locale: null, updatedAt: '2099-01-01T00:00:00.000Z' }),
        makeRecord({ id: 'en', locale: 'en', updatedAt: '2099-01-02T00:00:00.000Z' }),
      ],
      ['en', 'zh']
    )

    expect(picked?.id).toBe('en')
  })

  it('validates replace-with-emergency-copy payload shape', () => {
    const normalized = validatePublicOverrideInput({
      targetType: 'post',
      targetKey: 'my-post',
      locale: 'zh',
      action: 'replace-with-emergency-copy',
      title: '紧急说明',
      bodyText: '内容临时替换为公告。',
      ctaLabel: '查看说明',
      ctaHref: '/notice',
      expiresAt: '2099-01-01T00:00:00.000Z',
      rollbackSnapshotVersion: 'snapshot-1',
    })

    expect(normalized.targetKey).toBe('my-post')
    expect(normalized.ctaHref).toBe('/notice')
  })

  it('rejects html in emergency copy fields', () => {
    expect(() =>
      validatePublicOverrideInput({
        targetType: 'post',
        targetKey: 'my-post',
        action: 'replace-with-emergency-copy',
        title: '<b>bad</b>',
        bodyText: 'safe',
        expiresAt: '2099-01-01T00:00:00.000Z',
        rollbackSnapshotVersion: 'snapshot-1',
      })
    ).toThrow(/HTML/)
  })
})
