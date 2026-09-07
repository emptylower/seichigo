# 修复：Creem 首个事件是 subscription.paid（没有 subscription.active）时要按开通处理

真实测试载荷（2026-09-07，生产事件表）：一次新订阅 Creem 只发了 `subscription.paid`（object.status=active）与 `checkout.completed`，**没有** `subscription.active`。现有 `webhookHandler.ts` 的 paid 分支只推进周期并“纠正 tier”，不写 `periodAnchor`，导致用户 `periodAnchor` 仍是旧值（观察到 08-11 而订阅周期是 09-07 → 10-07）。

只改 `lib/billing/creem/webhookHandler.ts` 与 `tests/billing/creem/webhookHandler.test.ts`。不要 git commit / stash。

1. `subscription.paid`（以及 `subscription.update` 且 status=active）分支：若 `existing` 为空（该订阅首次出现）或用户当前 tier ≠ 订阅 tier，则按“开通”处理：`applyTier({ userId, tier, periodAnchor: period.start, periodStart: period.start, periodEnd: period.end })`；否则保持现有“只推进周期、不动锚点”。
2. `checkout.completed` 仍只记录。
3. 测试：用真实载荷形状（ISO 日期字符串、object.metadata.userId、无 active 事件）跑“首个事件是 paid → tier=standard、periodAnchor=periodStart=current_period_start_date、periodEnd=current_period_end_date”；以及“已有记录后再来 paid → 锚点不变、周期推进”。
4. 跑 `npx vitest run tests/billing` 与 `npm run typecheck`，简短中文汇报。
