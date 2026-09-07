# 订阅开关与付费意向记录

背景：Creem 商店审核中，生产先不开放订阅。用户点“开通标准版”时后台记录一次点击意向（含未登录），前端弹“暂未开放”。开关打开后同一入口直接走结账，意向照记，用于漏斗观察。

两部分并行：Part F 后端（opencode glm），Part G 前端（opencode k3）。都不要 git commit / git stash / 启动 dev server / 对数据库 migrate（迁移手写，只 `npx prisma generate`）。Part F 只改 `lib/billing/**`、`app/api/**`、`prisma/**`、`wrangler.jsonc`、`tests/billing/**`、`tests/api/**`；Part G 只改 `components/**`、`app/(authed)/admin/billing/**`、`lib/i18n/locales/*.json`、`tests/billing/**`、`tests/components/**`、`tests/i18n/**`。

## Part F 后端

### F1 数据模型
```prisma
/// 付费意向：每次点击“开通”都记一条（含未登录）。用于观察付费意愿。
model BillingCheckoutIntent {
  id        String   @id @default(cuid())
  userId    String?
  tier      String
  source    String
  locale    String?
  gated     Boolean                      // true = 当时订阅未开放
  createdAt DateTime @default(now())
  @@index([createdAt])
  @@index([userId])
}
```
手写迁移 `prisma/migrations/20260907000000_billing_checkout_intent/migration.sql`。

### F2 开关与记录
- `lib/billing/checkoutGate.ts`：`export function isCheckoutEnabled(env = process.env): boolean`（`BILLING_CHECKOUT_ENABLED === '1'`）；`export const INTENT_SOURCES = ['pricing', 'profile', 'hint', 'usage', 'unknown'] as const`；`normalizeIntentSource(v: unknown)`。
- `lib/billing/creem/repo.ts` 加 `BillingCheckoutIntentRepo { record(input: { userId: string | null; tier: string; source: string; locale: string | null; gated: boolean }): Promise<void>; stats(now: Date): Promise<{ total: number; last24h: number; last7d: number; uniqueUsers: number; anonymous: number; byDay: Array<{ day: string; count: number }> }> }`（byDay 最近 14 天，day 为 `YYYY-MM-DD` UTC）。memory + prisma 实现（prisma 的 byDay 用 `$queryRaw` 按 `date_trunc('day', "createdAt")` 分组）。`getCreemRepos()` 暴露 `intents`。
- `wrangler.jsonc` vars 加 `"BILLING_CHECKOUT_ENABLED": "0"`（注释：Creem 审核通过并配置好生产 product id 与 secrets 后改 "1"；预览用 `--var` 覆盖）。

### F3 结账路由改造
`app/api/me/billing/checkout/route.ts`：
1. 解析 body `{ source?: string }`（可选，非法 JSON 视为空），`source = normalizeIntentSource(body.source)`；`locale = handlerLocale(...)`（与现有 agent 路由同样取法）。
2. 先取 session（可为空），**再**判断开关：
   - 关闭：`intents.record({ userId: session?.user?.id ?? null, tier: 'standard', source, locale, gated: true })`，返回 403 `{ code: 'checkout_disabled' }`。未登录同样记录并 403（不再先 401）。
   - 开启：未登录 401；否则先 `intents.record({ ..., gated: false })`，再走现有 409 / 60 秒去重 / 创建结账逻辑。
3. 记录失败只 `console.warn`，不影响主流程。

### F4 管理接口
`app/api/admin/billing/intents/route.ts` GET：需要 `session.user.isAdmin`（取法参照 `app/api/admin/llm/providers/route.ts`），否则 403；返回 `intents.stats(new Date())` 与 `{ checkoutEnabled: isCheckoutEnabled() }`。

### F5 测试
`tests/api/billingCheckout.test.ts` 追加：开关关闭时未登录/已登录都 403 且各记一条 `gated: true`；开关开启时记录 `gated: false` 后照常创建结账。`tests/billing/checkoutGate.test.ts`：开关解析与 source 归一化。memory repo 的 `stats` 单测（total / last24h / byDay）。验收：`npm run typecheck`、`node scripts/check-line-budget.mjs`、`npx vitest run tests/billing tests/api`。

## Part G 前端

### G1 “暂未开放”弹窗
- 新建 `components/billing/CheckoutUnavailableDialog.tsx`：无依赖的可访问对话框（`role="dialog"`、`aria-modal`、Esc 与遮罩关闭、焦点落在关闭按钮）。内容三语：标题“订阅暂未开放”，正文“标准版正在准备中，很快开放订阅。我们已记录你的关注，开放后会在站内提示。”，按钮“知道了”。
- `components/billing/CheckoutButton.tsx`：新增 prop `source: 'pricing' | 'profile' | 'hint' | 'usage'`，请求体带 `{ source }`；收到 403 且 `code === 'checkout_disabled'` 时打开弹窗（不跳登录、不提示错误）。其它分支不变。调用方：`PricingTemplate` 传 `pricing`，`SubscriptionCard` 传 `profile`。
- 现有升级提示（TierHint、DaysLimitHint、UsageMeter 链接、PlanComposer 402 的“升级”）继续跳定价页，不改。

### G2 管理页
- 新建 `app/(authed)/admin/billing/page.tsx`（服务端判 isAdmin，参照 `app/(authed)/admin/llm/page.tsx`）+ 客户端 `ui.tsx`：请求 `GET /api/admin/billing/intents`，显示开关状态、总点击、24 小时、7 天、去重用户数、未登录点击数，以及最近 14 天每日柱状（纯 CSS 高度条即可，不引图表库）。中文即可（管理面板不三语）。
- 在管理面板导航（`/admin/panel` 或现有 admin 侧栏）加入口“订阅意向”。

### G3 测试与验收
`tests/billing/checkoutButton.test.tsx` 追加：403 `checkout_disabled` → 弹窗出现、可关闭、不跳转；请求体含 `source`。字典键放 `billing.checkout.unavailable.*`，`tests/i18n` 对齐测试同步。验收：`npm run typecheck`、`node scripts/check-line-budget.mjs`、`npx vitest run tests/billing tests/components tests/i18n`。页面不得出现 credit / token / 成本 / 调用次数字样。
