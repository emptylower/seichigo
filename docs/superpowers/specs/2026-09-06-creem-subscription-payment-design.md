# Creem 订阅支付接入（设计）

日期：2026-09-06　状态：草案，待用户确认 §9 的开放问题

上游设计：`2026-09-06-plan-agent-billing-tiers-design.md`（三档、月度预算、账本）。本文只负责“用户如何付费成为标准档、以及订阅生命周期如何驱动档位与周期”，不改预算与计量逻辑。

## 1. 目标与非目标

目标：

1. 标准档（$9.9/月）通过 Creem 订阅购买。Creem 作为 Merchant of Record 处理税费、发票与支付方式。
2. 订阅生命周期（开通、续费、取消、逾期、过期）由 Creem webhook 驱动，服务端据此改写 `User.tier / periodAnchor / periodStart / periodEnd`，现有 `getAccount` 的周期滚动与整月 grant 逻辑不变。
3. 用户在账户页看到订阅状态、下次续费日，并能进入 Creem 客户门户管理付款方式与取消。
4. 全链路可在预览环境用 Creem 测试模式跑通。

非目标：年付与折扣码（Creem 侧配置即可，代码不特殊处理）；高级档购买（占位不变）；退款流程自动化（收到 `refund.created` 只记录并告警，人工处理）；发票页面（Creem 门户已提供）。

## 2. Creem 接口口径（2026-09-06 按官方文档核对）

- 创建结账：`POST {base}/v1/checkouts`，header `x-api-key`。请求 `product_id`（必填）、`request_id`、`success_url`、`customer: { email }`、`metadata`。响应含 `id`、`checkout_url`、`status`、`request_id`、`metadata`。
- 基地址：生产 `https://api.creem.io`，测试 `https://test-api.creem.io`。
- Webhook：header `creem-signature`，HMAC-SHA256，密钥为控制台的 webhook secret，签名内容为原始请求体。事件类型：`checkout.completed`、`subscription.active`、`subscription.paid`、`subscription.canceled`、`subscription.scheduled_cancel`、`subscription.past_due`、`subscription.expired`、`subscription.trialing`、`subscription.paused`、`subscription.update`、`refund.created`、`dispute.created`。
- 订阅对象：`status`（active / trialing / paused / past_due / expired / canceled / scheduled_cancel）、`current_period_start_date`、`current_period_end_date`、`canceled_at`、`product`、`customer`、`metadata`、`request_id`。
- 客户门户：`POST {base}/v1/customers/billing`，传 customer id，返回门户链接。

`success_url` 重定向会带查询参数，本设计**不信任**这些参数，只用它们展示“处理中”，真值一律来自 webhook。

## 3. 数据模型

新表 `BillingSubscription`（一个用户同一时间最多一条活跃订阅）：

```
id                  String   @id @default(cuid())
userId              String
provider            String   @default("creem")
creemCustomerId     String
creemSubscriptionId String   @unique
creemProductId      String
tier                String                 // 该订阅对应档位，首期恒 standard
status              String                 // 原样存 Creem status
currentPeriodStart  DateTime
currentPeriodEnd    DateTime
cancelAtPeriodEnd   Boolean  @default(false)
canceledAt          DateTime?
lastEventAt         DateTime
createdAt / updatedAt
@@index([userId])
```

新表 `BillingWebhookEvent`（幂等与审计）：

```
id          String   @id                   // Creem 事件 id
type        String
receivedAt  DateTime @default(now())
processedAt DateTime?
error       String?
payload     Json
```

User 不加字段。`User.tier / periodAnchor / periodStart / periodEnd` 由本设计的状态机改写。

## 4. 状态机：webhook → 用户档位与周期

处理顺序：验签 → 按事件 id 幂等落 `BillingWebhookEvent` → 解析 `metadata.userId`（创建结账时写入，Creem 会透传到 checkout 与 subscription 事件；缺失时按 `request_id` 前缀 `userId:` 回退；再缺失按 `customer.email` 匹配 User，仍找不到则记录 error 并返回 200）→ 按类型处理 → 写 `processedAt`。

| 事件 | 动作 |
|---|---|
| `checkout.completed` | 只记录。档位变化等 `subscription.active`。 |
| `subscription.active`、`subscription.trialing` | upsert BillingSubscription；`User.tier = standard`，`periodAnchor = current_period_start_date`，`periodStart / periodEnd = current_period_*`。`getAccount` 下次调用发现新周期无账目 → 自动 grant 标准档整月预算。免费档剩余余量作废。 |
| `subscription.paid` | 续费：更新 BillingSubscription 周期字段与 User 的 `periodStart / periodEnd`（`periodAnchor` 不动）。新周期由 `getAccount` 自动 grant。 |
| `subscription.update` | 同步 status、周期、`cancelAtPeriodEnd`；不改档位。 |
| `subscription.scheduled_cancel` | `cancelAtPeriodEnd = true`；档位与周期不变，到期后由 `expired` 处理。 |
| `subscription.past_due` | 记 status；档位不变（宽限到 Creem 判定过期为止）。 |
| `subscription.paused` | 记 status；`User.tier = free`，`periodAnchor = now`，周期按免费档重算。 |
| `subscription.canceled`、`subscription.expired` | 记 status 与 `canceledAt`；若 `current_period_end_date` 已过或事件为立即取消：`User.tier = free`，`periodAnchor = 事件时间`，周期按免费档重算；否则只标记，到期由后续 `expired` 处理。 |
| `refund.created`、`dispute.created` | 记录并 `console.error` 告警，不自动改档位（人工处理）。 |

所有对 User 的改写都在一个事务里，并取 `pg_advisory_xact_lock(hashtext(userId))`（与账本、beginAgentRun 同一把锁）。

## 5. 接口

- `POST /api/me/billing/checkout`：登录用户；已是有效标准档则 409。调用 Creem 创建结账：`product_id = CREEM_PRODUCT_STANDARD_ID`，`request_id = "<userId>:<uuid>"`，`customer.email = user.email`，`metadata = { userId, tier: 'standard' }`，`success_url = <站点>/me?billing=success`。返回 `{ checkoutUrl }`。
- `POST /api/billing/creem/webhook`：Node runtime；读原始 body；验 `creem-signature`（WebCrypto HMAC-SHA256，常量时间比较）；失败 401；成功先落事件表再处理；处理异常也返回 200 并记 `error`（避免 Creem 无限重试打爆），由 §7 的对账兜底。
- `POST /api/me/billing/portal`：登录用户且有 BillingSubscription；调用 Creem 客户门户接口返回 `{ portalUrl }`。
- `GET /api/me/billing`：返回 `{ tier, status, currentPeriodEnd, cancelAtPeriodEnd, hasSubscription }` 供账户页渲染。

Creem 调用封装在 `lib/billing/creem/client.ts`（原生 fetch，不引入 SDK，避免 Workers 兼容问题），验签在 `lib/billing/creem/signature.ts`，状态机在 `lib/billing/creem/webhookHandler.ts`（纯函数 + 注入的仓储，可用 memory 仓储单测）。

## 6. 配置与环境

Wrangler secrets：`CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`。vars：`CREEM_API_BASE`（生产 `https://api.creem.io`，预览用 `--var` 覆盖为 `https://test-api.creem.io`）、`CREEM_PRODUCT_STANDARD_ID`（生产与测试模式各一个 product id，预览同样用 `--var` 覆盖）。本地 `.env.local` 同名变量。

Creem 控制台需要：一个 $9.9/月 的订阅产品（生产模式与测试模式各建一次）、webhook 指向 `https://seichigo.com/api/billing/creem/webhook`（测试模式指向预览域名）。

## 7. 对账与边界

- **事件乱序/丢失**：每次 `getAccount` 不做远端调用；另加每日 cron（现有 cron 机制）拉取所有 status 为 active/trialing/past_due 的 BillingSubscription，对 `currentPeriodEnd` 已过 48 小时仍未收到续费事件的，调用 Creem 查询订阅并按 §4 修正。
- **重复事件**：以 Creem 事件 id 为主键幂等。
- **同一用户重复购买**：checkout 前 409；webhook 收到第二条 active 时以新订阅为准并记 warn。
- **邮箱不匹配**：结账时 `customer.email` 固定为账号邮箱；Creem 侧改邮箱不影响，因为映射靠 `metadata.userId`。
- **升级时免费档余量**：作废，不折算。
- **降级后账本**：旧周期账目保留，新免费周期从 grant 重新起算。

## 8. 用户侧

- 定价页“开通标准版”与所有升级提示 → 调 `/api/me/billing/checkout` 后跳转 `checkoutUrl`；未登录先登录再回到定价页。
- 账户页新增“订阅”区块：当前档位、下次续费或到期日、`cancelAtPeriodEnd` 时显示“将于 x 月 x 日到期”、按钮“管理订阅”（门户）。
- 从 Creem 返回 `/me?billing=success` 时显示“正在开通，通常几秒内生效”，前端轮询 `/api/me/billing` 最多 30 秒。
- 三语文案沿用本轮建立的字典。

## 9. 开放问题（需要用户确认）

1. Creem 账号与产品是否已建好？需要提供测试模式与生产模式各一个 product id，以及 API key 与 webhook secret（通过 `wrangler secret put` 写入，不进仓库）。
2. 高级档的 Creem 产品是否现在一并建好（只建不上架）？
3. 是否需要年付：Creem 侧加一个年付产品即可，代码按 `metadata.tier` 与周期字段处理，不需要额外分支；确认后在定价页加“年付”切换。

## 10. 分期

1. 数据模型、验签、状态机与单测（memory 仓储）。
2. 三个接口与 Creem 客户端；预览环境接测试模式跑通开通、续费（Creem 测试时钟或人工触发）、取消。
3. 前端：定价页与升级提示接结账，账户页订阅区块，三语。
4. 每日对账 cron。
5. 生产上线：写入 secrets、控制台配置 webhook、合并部署、真实付款验证一次。
