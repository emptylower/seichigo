# Creem 接入评审修复

对提交 66ae347 / 5efc6d3 的安全评审结论：3 blocker、8 should-fix。逐条修复，先写失败测试再改。不要 git commit / git stash / migrate（如需改 schema 只手写迁移文件并 `npx prisma generate`）。允许改动：`lib/billing/**`、`app/api/**`、`prisma/**`、`docs/deployment.md`、`docs/api.md`、`tests/billing/**`、`tests/api/**`，以及 F7 点名的两个前端组件。完成后跑 `npm run typecheck`、`node scripts/check-line-budget.mjs`、`npx vitest run tests/billing tests/api tests/planAgent`。

## F1（blocker）日期字段兼容 ISO 字符串，且兜底可观测

`lib/billing/creem/webhookHandler.ts` 的 `toDate`：同时接受有限 number（epoch ms；若小于 1e12 视为秒 ×1000）与可被 `new Date()` 解析的非空字符串；其它返回 null。`periodOf` 落到“兜底 now”分支时调用 `log('warn', 'creem period fields missing, using fallback', { eventId, keys: Object.keys(obj) })`。`client.ts` 里订阅对象的日期字段类型改为 `string | number`。测试：ISO 字符串、毫秒、秒三种输入都解析正确；缺失时 warn 被调用。

## F2（blocker）未到期的取消/过期要有降档路径

两处都做：
1. `lib/billing/service.ts` 的 `getAccount` 读时兜底：deps 增加可选 `subscriptions?: { findActiveByUser(userId): Promise<{ currentPeriodEnd: Date } | null> }`；当 `user.tier !== 'free'` 且 `!user.isAdmin` 且没有活跃订阅（状态 active/trialing/past_due/scheduled_cancel 之外都算无）且 `user.periodEnd` 已过 → 调 `users.setTier`（`BillingUserRepo` 新增 `setTier(userId, tier, periodAnchor, periodStart, periodEnd)`）降为 free，锚点为 now，然后按 free 继续。`lib/billing/serverDeps.ts` 注入 prisma 的订阅仓储。
2. `lib/billing/creem/reconcile.ts`：新增候选集 `subs.listExpiredPendingDowngrade(now)`（status 为 canceled/expired/scheduled_cancel 且 `currentPeriodEnd <= now` 且对应用户 tier 仍不是 free），对每条执行降档（复用 handler 的 `downgradeToFree` 逻辑，抽成导出函数）。`BillingSubscriptionRepo` 接口与 memory/prisma 实现同步。

测试：service 层“tier=standard、无活跃订阅、periodEnd 已过 → getAccount 返回 free 且 users 已被写回”；handler 层 `expired` 未到期只标记，对账到期后降档。

## F3（blocker）处理失败的事件可重放

- `BillingWebhookEvent` 增加列 `attempts Int @default(0)`；`markProcessed(id, error?)`：成功写 `processedAt`；失败**不写 `processedAt`**，写 `error` 与 `attempts + 1`。手写迁移 `prisma/migrations/20260906130000_billing_webhook_attempts/migration.sql`。
- `BillingWebhookEventRepo` 新增 `listUnprocessed(limit): Promise<Array<{ id; type; payload }>>`（`processedAt` 为 null 且 `attempts < 5`）。
- `reconcile.ts` 增加“重放未处理事件”步骤：逐条 `parseCreemEvent(payload)` → `handleCreemEvent` → `markProcessed`。
- webhook 路由：仍返回 200（幂等 claim 已占位，重放靠对账）。
- 测试：路由处理抛错后 `processedAt` 为 null、`attempts` 为 1；对账重放后 `processedAt` 有值。

## F4（should-fix）用户解析优先级与降档事件禁用 email 回退

`webhookHandler.ts`：`candidateUserId = existing?.userId ?? resolved`；`resolveUserId` 增加参数 `allowEmailFallback`，只有 active/trialing/paid 三类事件允许 email 回退；email 回退命中时 `log('warn', 'resolved by email fallback', { eventId, subId })`。`repoPrisma.ts` 的 `findUserIdByEmail` 用 `mode: 'insensitive'`，memory 实现 toLowerCase 比较。测试：canceled 事件 metadata 缺失且 email 匹配他人 → handled false、不改任何人；已有记录时以记录 userId 为准。

## F5（should-fix）success_url 用站点权威地址

`app/api/me/billing/checkout/route.ts`：`successUrl` 用 `getSiteUrl()`（`lib/seo/site.ts`）拼接，不再取 `req.url` 的 origin。测试断言 successUrl 以站点地址开头。

## F6（should-fix）门户链接只认白名单字段与 https

`client.ts` 的 `extractPortalUrl`：只看 `customer_portal_link`、`portal_url`、`url` 三个键，且必须以 `https://` 开头；都没有则抛 `CreemApiError`。测试：含无关 `http://` 字段的响应不被误选。

## F7（should-fix）前端跳转协议校验

`components/billing/CheckoutButton.tsx` 与 `components/billing/SubscriptionCard.tsx`：`window.location.assign` 之前校验 URL 以 `https://` 开头，否则按“支付暂不可用”/“门户不可用”处理。各加一条测试。只改这两个文件。

## F8（should-fix）past_due 与对账降档判定

`reconcile.ts`：远端订阅 status 不在 active/trialing/scheduled_cancel 之内（含 past_due、canceled、expired、paused、unpaid）且 `current_period_end_date` 已过 → 直接降档，不再绕合成事件类型；否则按现有逻辑同步周期。

## F9（should-fix）Creem 404 熔断

`reconcile.ts`：本轮因 404 触发的降档数量若超过 `max(3, ceil(候选数 × 0.2))`，中止本轮所有 404 降档并 `console.error('[billing/reconcile] circuit breaker tripped', …)`；返回值带 `breakerTripped: true`。测试覆盖。

## F10（should-fix）事件乱序保护

`webhookHandler.ts`：`existing` 存在且 `event.created_at < existing.lastEventAt.getTime()` → `{ handled: false, note: 'stale event' }`；`lastEventAt` 改写为 `new Date(event.created_at)`。对账合成事件的 `created_at` 用 now。测试：晚到的旧 expired 不覆盖新 active。

## F11（should-fix）并发结账去重与旧订阅告警

- `checkout/route.ts`：结账前用 `BillingWebhookEventRepo` 之外的一个小机制去重：在 `UsageLedgerRepo` 同款 advisory lock 下，检查 `BillingPendingCheckout`？——不新增表，改为：`BillingSubscriptionRepo` 新增 `findRecentCheckoutRequest(userId, withinMs)` 不可行（没有记录）。**采用最简方案**：`checkout` 路由把 `requestId` 与 `userId` 写进 `BillingWebhookEvent`（`id = checkout_request:<uuid>`，`type = 'checkout.requested'`，`processedAt = now`，payload `{ userId }`），并在创建前查最近 60 秒内同 userId 的 `checkout.requested` 记录，存在则 429 `{ code: 'checkout_in_progress' }`。`BillingWebhookEventRepo` 新增 `findRecentByType(type, userId, withinMs)`（payload 里的 userId 用 JSON 路径查询；memory 实现直接过滤）。
- `subscription.active` 发现同用户已有另一条活跃订阅：`log('error', 'duplicate active subscription', { userId, old, new })`。

## F12（should-fix）对账 cron 接上调度并落审计

- `docs/deployment.md` 与 `docs/api.md` 的 cron 表加一行 `/api/cron/billing/reconcile`（每日一次，header `x-ops-cron-secret`）。
- 对账合成事件也 `events.claim` 落一条记录（`type` 前缀 `reconcile.`）。

## nit（顺手）

- `serverDeps.ts` 不缓存 null 配置。
- `checkout/route.ts` 的 409 只对 active/trialing 生效。
- `subscription.canceled` 事件缺 `canceled_at` 时用 `created_at` 写 `canceledAt`。
