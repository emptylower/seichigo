export type FirstViewCanarySlot = {
  slotKey: string
  slotType: 'cover-avatar' | 'point-thumbnail'
  sourceUrl: string
  expectedTier: string
}

export const FIRST_VIEW_CANARY_ROUTES = ['/map', '/ja/map'] as const

export const FIRST_VIEW_DESKTOP_CANARY_SLOTS: FirstViewCanarySlot[] = [
  { slotKey: 'cover-513345', slotType: 'cover-avatar', sourceUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', expectedTier: 'bgm cover must downshift from /l/ to /m/' },
  { slotKey: 'cover-100001', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100001_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'cover-100002', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100002_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'cover-100003', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100003_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'cover-100004', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100004_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'cover-100005', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100005_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'thumb-100001:p001', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/a.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100001:p002', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/b.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100002:p003', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/c.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100002:p004', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/d.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100003:p005', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/e.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100003:p006', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/f.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100004:p007', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/g.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100004:p008', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/h.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100005:p009', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-01.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100005:p010', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-02.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100006:p011', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-03.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100006:p012', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-04.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100007:p013', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-05.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100007:p014', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-06.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
]

export const FIRST_VIEW_MOBILE_CANARY_SLOTS: FirstViewCanarySlot[] = [
  { slotKey: 'cover-513345', slotType: 'cover-avatar', sourceUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', expectedTier: 'bgm cover must downshift from /l/ to /m/' },
  { slotKey: 'cover-100001', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100001_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'cover-100002', slotType: 'cover-avatar', sourceUrl: 'https://bgm.tv/pic/cover/l/00/00/100002_test.jpg', expectedTier: 'bgm cover must not stay oversized' },
  { slotKey: 'thumb-100001:p001', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/a.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100001:p002', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/b.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100002:p003', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/c.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100002:p004', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/d.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100003:p005', slotType: 'point-thumbnail', sourceUrl: 'https://www.anitabi.cn/images/user/0/e.jpg', expectedTier: 'direct image.anitabi.cn with plan=h160' },
  { slotKey: 'thumb-100004:p006', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-01.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100004:p007', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-02.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100005:p008', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-03.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
  { slotKey: 'thumb-100005:p009', slotType: 'point-thumbnail', sourceUrl: 'https://cdn.example.com/point-04.jpg', expectedTier: 'render proxy, no direct same-origin rewrite' },
]

function renderSlotTable(slots: readonly FirstViewCanarySlot[]): string {
  const lines = [
    '| Slot Key | Slot Type | Source URL | Expected Tier |',
    '| --- | --- | --- | --- |',
  ]
  for (const slot of slots) {
    lines.push(`| \`${slot.slotKey}\` | \`${slot.slotType}\` | \`${slot.sourceUrl}\` | ${slot.expectedTier} |`)
  }
  return lines.join('\n')
}

export function renderFirstViewCanaryMarkdown(): string {
  return `# Canary: Map First-View Slots

Generated from \`features/map/anitabi/firstViewCanary.ts\`.

Source of truth for phase 3 automated and manual first-view checks.

## Baseline

- Routes:
  - \`${FIRST_VIEW_CANARY_ROUTES[0]}\`
  - \`${FIRST_VIEW_CANARY_ROUTES[1]}\`
- Viewports:
  - desktop \`1440x900\`
  - mobile \`390x844\`
- First-view only:
  - automatically visible slots
  - no deep-interaction-only images

## Desktop Slots (\`${FIRST_VIEW_DESKTOP_CANARY_SLOTS.length}\`)

${renderSlotTable(FIRST_VIEW_DESKTOP_CANARY_SLOTS)}

## Mobile Slots (\`${FIRST_VIEW_MOBILE_CANARY_SLOTS.length}\`)

${renderSlotTable(FIRST_VIEW_MOBILE_CANARY_SLOTS)}

## Notes

- \`cdn.example.com\` entries are fixed synthetic regression fixtures for route/tier verification.
- The canary artifact is frozen for phase 3; do not swap samples casually during implementation or rollout verification.
`
}
