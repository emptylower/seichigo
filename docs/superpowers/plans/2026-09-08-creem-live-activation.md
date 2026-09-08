# Creem 生产上线：配置接入、对账 cron 补齐、定价页税费标注

Creem 账户已通过审核，生产模式的 product / API key / webhook secret 都已就绪。
本次只做**第一步部署**所需的改动：让计费模块的配置齐全（webhook 能验签），
但**支付开关仍然保持关闭**，第二步再单独翻开关。

## 硬约束

- **不要 `git commit`、不要 `git stash`、不要 `git push`**。改完留在工作区即可。
- **不要**碰 `lib/billing/**` 下的任何逻辑代码（状态机、验签、client 都已验证过，不动）。
- **不要**部署、不要跑 `wrangler deploy` / `npm run cf:deploy` / `wrangler secret put`。
- **不要**把 `BILLING_CHECKOUT_ENABLED` 改成 `"1"`——本轮它必须保持 `"0"`。
- 不要新增依赖。

## A. wrangler.jsonc：填入生产 product id

文件 `wrangler.jsonc` 的 `vars` 段，把空的 product id 填上：

```jsonc
"CREEM_PRODUCT_STANDARD_ID": "prod_vM2g6cj87WpCDCWJuRdDd",
```

`CREEM_API_BASE` 保持 `https://api.creem.io`（已经是生产地址）。
`BILLING_CHECKOUT_ENABLED` 保持 `"0"` 不动。

顺手把 `CREEM_PRODUCT_STANDARD_ID` 上方那条注释更新一下，说明这是 2026-09-08
填入的生产模式 product（$9.90/月，recurring，tax_mode=exclusive），预览环境仍可用
`--var` 覆盖为测试模式 product id。注释用中文，风格对齐文件里已有的注释。

## B. 补上从未被调度的计费对账 cron

`app/api/cron/billing/reconcile/route.ts` 早就写好了（漏 webhook 事件的兜底：
拉 Creem 查订阅真实状态并修正用户档位），但**没有任何地方在触发它**。
主站 worker 走 OpenNext、不导出 `scheduled`，所有定时任务都挂在
`workers/anitabi-mirror/src/index.ts` 的 `scheduled` 里转发给主站。

改 `workers/anitabi-mirror/src/index.ts`：在 `controller.cron === '15 3 * * *'`
分支里，**追加一条**转发（和已有的 `/api/cron/ops/daily` 并列）：

```ts
ctx.waitUntil(triggerMainSiteCron(env, '/api/cron/billing/reconcile', 'x-ops-cron-secret', env.OPS_CRON_SECRET))
```

- 该路由的鉴权与 ops daily 完全相同（`x-ops-cron-secret` / `OPS_CRON_SECRET`），
  两个 secret 在这个 worker 上都已配好，**不需要**改 `workers/anitabi-mirror/wrangler.jsonc`。
- **不要**新增 cron trigger（不要动 `triggers.crons` 数组），复用现有的 `15 3 * * *` tick。
- 在该分支已有的注释里补一句，说明 billing reconcile 也并入这个 tick。

同步修文档里的错误调度时间：`docs/deployment.md` 和 `docs/api.md` 里
`/api/cron/billing/reconcile` 那一行现在写的是 `40 3 * * *`，实际改为
`15 3 * * *`（与 anitabi translate / ops daily 同 tick）。只改这一行的时间，
表格其它内容不动。

## C. 定价页标注「不含税」

Creem 生产产品的 `tax_mode` 是 `exclusive`——$9.90 不含税，结账时按用户所在地
再加税。定价页现在只写「$9.9 /月」，用户会在结账最后一步才发现落差。

在**价格旁边**标注（不是只加页脚小字）。改动范围：

1. `lib/i18n/locales/{zh,en,ja}.json` 的 `pages.pricing` 下**新增一个 key**
   `taxNote`，三语文案：
   - zh: `不含税`
   - en: `excl. tax`
   - ja: `税別`
2. `components/pricing/PricingTemplate.tsx`：在标准档价格与 `/月` 后面渲染这个
   标注。要求：
   - 只在**有价格且价格非 $0** 的档位显示（免费档 `$0` 不显示，高级档没有价格也不显示）。
   - 视觉上是次要信息——比 period 更小/更淡（例如 `text-xs text-gray-400`），
     不要抢价格的视觉重心，不要换行破坏卡片排版。
   - 沿用文件里已有的 `tx(locale, key)` 取文案方式，不要另起一套。

三语 JSON 的 key 顺序保持与现有结构一致（放在 `standardPeriod` 附近），
不要重排其它 key、不要改动缩进风格。

## 完成标准

依次跑通并在汇报里贴结果：

```
npx vitest run tests/billing
npm run typecheck
npx vitest run workers/anitabi-mirror/src/__tests__
```

如果 `workers/anitabi-mirror` 那条命令路径不对，用仓库里实际可用的方式跑该 worker 的测试。

最后用**简短中文**汇报：改了哪些文件、每个文件改了什么、三条命令的结果。
