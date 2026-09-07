# Creem 订阅接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 标准档（$9.9/月）可通过 Creem 订阅购买；订阅生命周期由 webhook 驱动用户档位与周期；账户页可查看订阅与进入客户门户；预览环境用 Creem 测试模式跑通。

**Architecture:** `lib/billing/creem/` 下放 Creem 客户端（原生 fetch）、验签（WebCrypto HMAC-SHA256）、仓储接口（memory + prisma）与 webhook 状态机（纯函数）。四个 API 路由只做鉴权、读原始 body 与调用。前端定价页与账户页调这些接口。

**Tech Stack:** TypeScript、Next.js App Router（nodejs runtime）、Prisma、vitest。

**对应设计：** `docs/superpowers/specs/2026-09-06-creem-subscription-payment-design.md`。

**Creem 事实（2026-09-06 按 docs.creem.io/code/webhooks 与 API 参考核对）：**
- 结账：`POST {base}/v1/checkouts`，header `x-api-key`，body `{ product_id, request_id?, success_url?, customer?: { email }, metadata? }`，响应 `{ id, checkout_url, status, request_id, metadata }`。测试基址 `https://test-api.creem.io`，生产 `https://api.creem.io`。
- 门户：`POST {base}/v1/customers/billing`，body `{ customer_id }`，响应含门户链接字段（按实际响应取 `customer_portal_link`，若无则取第一个以 `http` 开头的字符串字段）。
- Webhook 请求体：`{ id: "evt_…", eventType: "subscription.paid", created_at: 1728734327355, object: {…} }`。`object` 对订阅事件含 `id (sub_…)`、`status`、`product: { id, name, price }`、`customer: { id, email }`、`current_period_start_date` / `current_period_end_date`（部分事件只有 `last_transaction_date` / `next_transaction_date`）、`canceled_at`、`metadata`；对 `checkout.completed` 含 `id (ch_…)`、`order`、`product`、`customer`、`subscription`、`request_id`、`metadata`。
- 签名：header `creem-signature`，值为 `HMAC-SHA256(secret, rawBody)` 的**十六进制**字符串。应答 200 表示收到；同一事件可能重复投递，最多 5 次重试。

## 分工与约束

- **Part D（后端）交 opencode**：只改 `lib/billing/creem/**`、`lib/billing/serverDeps.ts`（如需）、`app/api/me/billing/**`、`app/api/billing/**`、`app/api/cron/billing/**`、`prisma/**`、`wrangler.jsonc` 的 vars、`tests/billing/creem/**`、`tests/api/billing*.test.ts`。**不要碰** `lib/legal/**`、`components/**`、`hooks/**`、`app/(authed)/**`、`app/(site)/**`、`app/en/**`、`app/ja/**`、`lib/i18n/**`。
- **Part E（前端）交 Opus 子 agent**：只改上面 Part D 禁止的那些目录，外加 `tests/billing/*.test.tsx`、`tests/components/**`、`tests/plan/**`、`tests/i18n/**`。
- 两边都不要 `git commit`，不要 `git stash`，不要对任何数据库跑 migrate（迁移 SQL 手写，只跑 `npx prisma generate`），不要启动 dev server。
- 环境变量名（本地 `.env.local` 已有测试值）：`CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`CREEM_API_BASE`、`CREEM_PRODUCT_STANDARD_ID`。`.env.local` 里目前是 `CREEM_TEST_*` 前缀，Part D 的 D7 负责改成正式名。

---

## Part D：后端

### D1 数据模型与迁移

- `prisma/schema.prisma` 新增：

```prisma
/// Creem 订阅（设计 2026-09-06 §3）：一个用户同一时间最多一条活跃订阅
model BillingSubscription {
  id                  String    @id @default(cuid())
  userId              String
  provider            String    @default("creem")
  creemCustomerId     String
  creemSubscriptionId String    @unique
  creemProductId      String
  tier                String
  status              String
  currentPeriodStart  DateTime
  currentPeriodEnd    DateTime
  cancelAtPeriodEnd   Boolean   @default(false)
  canceledAt          DateTime?
  lastEventAt         DateTime
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// Creem webhook 事件（幂等与审计）
model BillingWebhookEvent {
  id          String    @id
  type        String
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  error       String?
  payload     Json
}
```

User 关系列表加 `billingSubscriptions BillingSubscription[]`。

- 手写 `prisma/migrations/20260906120000_add_billing_subscription/migration.sql`（列、索引、外键与 schema 逐字段一致，参考上一条迁移的写法），跑 `npx prisma generate`。

### D2 验签 `lib/billing/creem/signature.ts`

```ts
export async function hmacSha256Hex(secret: string, body: string): Promise<string>   // WebCrypto subtle.importKey('raw') + sign，输出小写 hex
export async function verifyCreemSignature(rawBody: string, header: string | null, secret: string): Promise<boolean>
```
- 比较用常量时间（长度不等直接 false；逐字节异或累加）。
- 测试 `tests/billing/creem/signature.test.ts`：固定 secret 与 body，断言 hex 与 Node `crypto.createHmac('sha256', secret).update(body).digest('hex')` 一致；大小写不同的 header 也通过（比较前 toLowerCase）；错误签名/空 header → false。

### D3 客户端 `lib/billing/creem/client.ts`

```ts
export type CreemConfig = { apiKey: string; apiBase: string; productStandardId: string; webhookSecret: string }
export function readCreemConfig(env = process.env): CreemConfig | null   // 四项齐全才返回，否则 null（路由据此 503）
export function createCreemClient(config: CreemConfig, fetchImpl: typeof fetch = fetch): {
  createCheckout(input: { productId: string; requestId: string; successUrl: string; customerEmail: string; metadata: Record<string, string> }): Promise<{ id: string; checkoutUrl: string }>
  createBillingPortal(customerId: string): Promise<{ portalUrl: string }>
  getSubscription(subscriptionId: string): Promise<CreemSubscriptionObject | null>   // GET {base}/v1/subscriptions/{id}，404 → null
}
```
- 非 2xx 抛 `CreemApiError(status, bodyText)`。
- 测试 `tests/billing/creem/client.test.ts`（mock fetch）：请求 URL/header/body 字段名正确；`checkout_url` 映射；门户链接字段兜底；错误抛出。

### D4 仓储 `lib/billing/creem/repo.ts` + `repoMemory.ts` + `repoPrisma.ts`

```ts
export type SubscriptionRecord = { … 与 schema 同形，日期为 Date }
export interface BillingSubscriptionRepo {
  findByCreemId(id: string): Promise<SubscriptionRecord | null>
  findActiveByUser(userId: string): Promise<SubscriptionRecord | null>   // status in active/trialing/past_due/scheduled_cancel
  listNeedingReconcile(olderThan: Date): Promise<SubscriptionRecord[]>  // status 活跃且 currentPeriodEnd < olderThan
  upsert(record: Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SubscriptionRecord>
}
export interface BillingWebhookEventRepo {
  claim(event: { id: string; type: string; payload: unknown }): Promise<'new' | 'duplicate'>   // prisma: create 捕获 P2002 → duplicate
  markProcessed(id: string, error?: string): Promise<void>
}
export interface UserTierRepo {
  findUserIdByEmail(email: string): Promise<string | null>
  applyTier(input: { userId: string; tier: Tier; periodAnchor: Date; periodStart: Date; periodEnd: Date }): Promise<void>  // 事务 + pg_advisory_xact_lock(hashtext(userId))
}
```
- memory 实现供测试；prisma 实现只保证 typecheck。

### D5 状态机 `lib/billing/creem/webhookHandler.ts`

```ts
export type CreemEvent = { id: string; eventType: string; created_at: number; object: Record<string, unknown> }
export function parseCreemEvent(raw: unknown): CreemEvent | null
export function resolveUserId(event: CreemEvent, users: UserTierRepo): Promise<string | null>
  // 顺序：object.metadata.userId → object.request_id 以 "<userId>:" 开头 → object.customer.email 查库
export function periodOf(obj: Record<string, unknown>, fallbackNow: Date): { start: Date; end: Date }
  // start = current_period_start_date ?? last_transaction_date ?? fallbackNow；end = current_period_end_date ?? next_transaction_date ?? addMonthsClamped(start, 1)
export async function handleCreemEvent(event: CreemEvent, deps: { subs: BillingSubscriptionRepo; users: UserTierRepo; now?: () => Date; log?: (level: 'warn' | 'error', msg: string, extra?: unknown) => void }): Promise<{ handled: boolean; note?: string }>
```
按设计 §4 的表逐类型实现；未知类型 `handled: false`。`subscription.canceled` / `expired`：若 `end <= now` 或 `status === 'canceled'` 且 `canceled_at` 存在且 `end <= now` → 降免费（`periodAnchor = now`，周期用 `computePeriod(now, now)`），否则只更新记录。`paused` → 立即降免费。`active` / `trialing` → 升标准（tier 取 `metadata.tier`，缺省 standard）。`paid` → 只推进周期（若用户当前 tier 不是该订阅 tier，也一并纠正）。

- 测试 `tests/billing/creem/webhookHandler.test.ts`（memory 仓储，覆盖）：active 升档并设周期；paid 推进周期但锚点不变；scheduled_cancel 只标记；expired 到期降档；expired 未到期不降；paused 立即降；metadata 缺失时按 request_id 回退，再按 email 回退，都没有 → handled false 且 log error；重复事件由路由层的 claim 挡住（在 D6 测）。

### D6 路由

- `app/api/billing/creem/webhook/route.ts`（`runtime = 'nodejs'`）：`const raw = await req.text()`；`readCreemConfig()` 为 null → 503；验签失败 → 401；`parseCreemEvent` 失败 → 400；`claim` 为 duplicate → 200 `{ duplicate: true }`；`handleCreemEvent` 包在 try 里，异常 → `markProcessed(id, message)` 并 `console.error`，仍返回 200；成功 → `markProcessed(id)`，200。
- `app/api/me/billing/checkout/route.ts` POST：未登录 401；配置缺失 503；`findActiveByUser` 有效 → 409 `{ code: 'already_subscribed' }`；`createCheckout({ productId: config.productStandardId, requestId: \`${userId}:${crypto.randomUUID()}\`, successUrl: \`${origin}/me?billing=success\`, customerEmail, metadata: { userId, tier: 'standard' } })` → 200 `{ checkoutUrl }`。`origin` 取请求 URL 的 origin。
- `app/api/me/billing/portal/route.ts` POST：未登录 401；无订阅 404；`createBillingPortal(creemCustomerId)` → `{ portalUrl }`。
- `app/api/me/billing/route.ts` GET：`{ tier, hasSubscription, status, currentPeriodEnd, cancelAtPeriodEnd }`（tier 来自 billing service 的 getAccount，其余来自订阅记录；无记录时 status null）。
- `app/api/cron/billing/reconcile/route.ts` GET：与 `app/api/cron/ops/daily/route.ts` 同样的 `x-ops-cron-secret` 校验；对 `listNeedingReconcile(now − 48h)` 逐条 `getSubscription`，把返回对象包装成合成事件 `{ id: \`reconcile_${sub.id}_${Date.now()}\`, eventType: status 映射（active→subscription.paid，canceled/expired→subscription.expired，paused→subscription.paused，其它→subscription.update） }` 交给 `handleCreemEvent`；返回处理计数。
- 生产装配 `lib/billing/creem/serverDeps.ts`：`getCreemDeps()` 返回 `{ config, client, subs, events, users }`（prisma 实现），缓存单例。
- 测试 `tests/api/billingWebhook.test.ts`：用 memory 仓储 mock `getCreemDeps`，覆盖 401/400/duplicate/200 与“处理抛错仍 200 且 error 落库”。

### D7 配置

- `wrangler.jsonc` vars 加 `CREEM_API_BASE: "https://api.creem.io"` 与 `CREEM_PRODUCT_STANDARD_ID: ""`（生产值待填），注释说明预览用 `--var` 覆盖为测试模式。`CREEM_API_KEY` 与 `CREEM_WEBHOOK_SECRET` 走 secret，不进 vars。
- `.env.local`：把 `CREEM_TEST_API_KEY / CREEM_TEST_API_BASE / CREEM_TEST_WEBHOOK_SECRET / CREEM_TEST_PRODUCT_STANDARD_ID` 四行改名为正式名（值不变）。
- `worker-configuration.d.ts` 若由 `wrangler types` 生成则重跑 `npm run cf:typegen`。

### D8 验收

`npm run typecheck`（只允许 `tests/lib/prisma-client-lifecycle.test.ts` 的 3 条既有错误）；`node scripts/check-line-budget.mjs`；`npx vitest run tests/billing tests/api tests/planAgent`。

---

## Part E：前端

### E1 定价页与升级入口接结账

- `components/pricing/PricingTemplate.tsx`：标准档按钮改为客户端组件 `components/billing/CheckoutButton.tsx`：点击 → `POST /api/me/billing/checkout` → 200 跳转 `checkoutUrl`；401 → 跳登录并带 `callbackUrl` 回定价页（按站内登录跳转的现有方式）；409 → 提示“你已是标准档”并链接 `/me`；503/其它 → 提示“支付暂不可用，请稍后再试”。按钮 loading 态。三语文案进字典。
- `TierHint`、`DaysLimitHint`、`UsageMeter` 的升级链接、`PlanComposer` 402 提示条的“升级”按钮保持指向定价页不变。

### E2 账户页订阅区块

- `components/billing/SubscriptionCard.tsx`（客户端）：`GET /api/me/billing`；免费档显示“当前：免费”与“升级到标准版”按钮（复用 CheckoutButton）；标准档显示“当前：标准 · 下次续费 x 月 x 日”或“将于 x 月 x 日到期”（`cancelAtPeriodEnd`），按钮“管理订阅”→ `POST /api/me/billing/portal` → 跳转 `portalUrl`。
- `app/(authed)/me/page.tsx` 在用量表下方渲染它；URL 带 `?billing=success` 时显示“正在开通，通常几秒内生效”，并每 3 秒重拉 `/api/me/billing` 与触发 `notifyUsageChanged()`，最多 30 秒，tier 变为 standard 后改为“开通成功”。
- 三语文案进 `lib/i18n/locales/*.json` 的 `billing.subscription.*`。

### E3 条款补“付费订阅”

- `lib/legal/content.ts` 的用户协议三语各加一节“付费订阅 / Paid subscriptions / 有料サブスクリプション”：按月自动续费；可随时在账户页取消，当期结束生效；当期费用不退；因服务故障导致无法使用可在 7 天内联系 contact@seichigo.com 申请退款；价格以定价页为准，调价提前通知。放在现有条款合适的位置（服务内容之后、免责之前）。
- `tests/legal/**` 若有内容测试则同步。

### E4 验收

`npm run typecheck`；`node scripts/check-line-budget.mjs`；`npx vitest run tests/billing tests/components tests/plan tests/i18n tests/legal`；页面无 credit / token / 成本 / 调用次数字样。
