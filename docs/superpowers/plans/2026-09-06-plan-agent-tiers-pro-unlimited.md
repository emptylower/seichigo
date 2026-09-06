# 高级档全解锁与天数不限（后端小改）

不要 git commit。只改 `lib/billing/tiers.ts` 与 `tests/billing/tiers.test.ts`，其它文件不碰。先改测试再改实现。

1. `TIER_ENTITLEMENTS.pro.maxDays` 改为 30（代码里 save_plan_days 的硬上限就是 30，用户侧展示为“不限”）。
2. `tierPromptNote`：当 `e.maxDays >= 30` 时不再输出“本档位单个行程最多 N 天”那一行；若三行都没有则返回 null。
3. 新增导出 `export const UNLIMITED_DAYS = 30`，供前端与 usageView 判断“不限”。`lib/billing/usageView.ts` 不改（hints.maxDays 仍给 30，前端按 >= 30 显示不限）。
4. 测试：`tierPromptNote(TIER_ENTITLEMENTS.pro)` 为 null；`pro.maxDays === UNLIMITED_DAYS`；标准档断言不变。

完成后跑 `npx vitest run tests/billing tests/planAgent` 与 `npm run typecheck`，简短中文汇报。
