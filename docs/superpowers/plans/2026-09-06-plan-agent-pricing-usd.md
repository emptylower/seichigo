# 标准档定价 $9.9/月，价格表改为美元计价（后端小改）

不要 git commit。只改 `lib/billing/priceTable.ts`、`lib/billing/budget.ts`、`tests/billing/budget.test.ts`，其它文件不碰。先改测试再改实现。

1. `priceTable.ts`：删除 `CNY_PER_USD` 与 `TIER_MONTHLY_PRICE_CNY`，改为 `export const TIER_MONTHLY_PRICE_USD: Record<Tier, number> = { free: 0, standard: 9.9, pro: 29.9 }`。注释：标准档由产品拍板（2026-09-06）；高级档首期不可购买，数值只用于内测账号预算。
2. `budget.ts`：`monthlyBudgetMicros(tier)` 付费档 = `Math.round(TIER_MONTHLY_PRICE_USD[tier] * COST_SHARE * 1_000_000)`（标准档应为 4_455_000）。
3. `tests/billing/budget.test.ts`：更新引用；追加断言 `monthlyBudgetMicros('standard') === 4_455_000`；保留“runCap ≥ 预扣、月预算 ≥ 2×预扣”不变式。
4. 全仓 grep `CNY_PER_USD|TIER_MONTHLY_PRICE_CNY`，确认没有其它引用（若有，只在 `lib/billing/**` 与 `tests/billing/**` 内修）。

完成后跑 `npx vitest run tests/billing` 与 `npm run typecheck`，简短中文汇报。
