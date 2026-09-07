# 套餐标识：账户页与头像框体现套餐等级（前端）

不要 git commit / git stash / 启动 dev server。只改 `components/**`、`app/(authed)/me/**`、`lib/i18n/locales/*.json`、`hooks/**`、`tests/billing/**`、`tests/components/**`、`tests/i18n/**`。不要碰 `lib/billing/**`、`app/api/**`、`prisma/**`。先写失败测试再实现。

数据来源：已有 `hooks/useUsage.ts`（`GET /api/me/usage` → `{ tier: 'free'|'standard'|'pro', remainingPercent, resetsAt, hints, nearlyEmpty }`，未登录/失败 status 为 `unavailable`）。档位名从字典 `billing.tier.{free,standard,pro}` 取（已存在）。

## 1. 头像框体现套餐等级

- `components/shared/Avatar.tsx` 加可选 prop `tier?: 'free' | 'standard' | 'pro'`：
  - free / 未传：现状不变。
  - standard：头像外加一圈品牌色渐变环（`ring-2` 风格，brand-400 → pink-400），右下角一个极小圆形徽标（brand-600 底、白色文字 “S”），`title` 为档位名。
  - pro：金色渐变环（amber-400 → yellow-300）与 “P” 徽标。
  - 尺寸随 Avatar 现有 size 缩放，不改变外层布局尺寸（环用 `ring` 或 `outline`，不加 padding）。
- `components/layout/HeaderAuthControls.client.tsx`：调用 `useUsage()`，把 `usage?.tier` 传给 Avatar；`unavailable` 时不传。头像旁的下拉/名字区若有空间，在名字下方加一行极小的档位文字（standard/pro 才显示）。
- `components/layout/HeaderMobileDrawer.client.tsx` 的头像同样传 tier。
- `app/(authed)/plan/[id]/components/PlanSidebar.tsx` 底部已有用量表徽标，不动。

## 2. 账户页套餐标识

- `app/(authed)/me/page.tsx` 标题“我的”下方新增 `components/billing/ProfileTierHeader.tsx`（客户端）：左侧 Avatar（带 tier 环），右侧两行：用户名或邮箱；档位名 chip（free 灰、standard 品牌色、pro 金色）+ standard/pro 时“管理订阅”链接（带语言前缀的 `/me`，其实就在本页，改为链接到订阅区块锚点 `#subscription`，给 `SubscriptionCard` 外层加 `id="subscription"`）。
- 用量表与订阅卡片保持现状。页面标题“我的”与三个区块标题若仍是硬编码中文，顺手改为字典（`pages.me.title` 等；若字典里已有则复用）。

## 3. 三语

新增键放 `billing.tierBadge.*`（如 `standardShort: "标准"/"STD"/"標準"` 之类如需）与 `pages.me.*`。日文敬体，英文自然。

## 4. 验收

`npm run typecheck`（tests 侧只允许 `tests/lib/prisma-client-lifecycle.test.ts` 的 3 条既有错误）、`node scripts/check-line-budget.mjs`、`npx vitest run tests/billing tests/components tests/i18n tests/layout`。新增测试：Avatar 三种 tier 的渲染（环与徽标存在/不存在）、HeaderAuthControls 在 usage 为 standard 时给 Avatar 传 tier、ProfileTierHeader 三档渲染。页面不得出现 credit / token / 成本 / 调用次数字样。
