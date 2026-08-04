# AdSense 就绪度修复 — 执行交接文档

**交接给：** Codex（执行方）
**交接自：** Claude Code（诊断与规划方）
**日期：** 2026-08-04
**仓库：** `/Users/mac/Desktop/seichigo`，分支 `main`

---

## 0. 一分钟摘要

seichigo.com 要申请 Google AdSense。已完成线上审计与只读诊断，识别出 3 个 Blocker、4 个 High、3 个 Medium 问题。**代码一行未改**，全部改动待你执行。

详细任务分解在 **[`docs/superpowers/plans/2026-08-04-adsense-readiness-fixes.md`](../superpowers/plans/2026-08-04-adsense-readiness-fixes.md)**（下称"计划文档"），共 19 个 Task，含完整代码与三语文案，可直接抄用。

**本文档是你的执行入口**：读完本文档再打开计划文档。本文档包含计划文档里没有的东西——仓库约定、已核实的接口签名、对计划文档的 3 处修正、以及你不能做的事。

**当前阻塞：** 有 2 个决策点需要人工回答才能开工（见 §7）。其中"规范域选择"只阻塞 Phase 2 Task 9，Phase 1 可以先做。

---

## 1. 硬性禁止事项

以下是你**绝对不能**做的，每一条都有具体原因：

| 禁止 | 原因 |
|---|---|
| **不要碰 Cloudflare 控制台** | Task 9 需要改一条 Cloudflare Redirect Rule，那是人工操作。配错会导致全站不可达。你只负责代码侧，控制台部分交回给站主。 |
| **不要执行 `npm run cf:deploy` 或任何部署命令** | 本仓库有 `seichigo-predeploy-guard` 约定：部署前必须跑五项检查，且禁止部署未推送到 origin 的代码。部署由站主决定时机。你完成代码后停下并汇报。 |
| **不要 `git push`** | 本仓库约定"从不自动推送，始终询问"。你只在本地提交，推送由站主确认。 |
| **不要重构 root layout（`app/layout.tsx`）** | 计划文档 Task 15 详细论证过：多 root layout 重构的回归风险大于收益，已明确决定**暂不做**。不要"顺手优化"它。 |
| **不要把 `<html lang>` 改成读 `headers()`** | 会让整棵路由树变 dynamic，`force-static` 全部失效。当前 TTFB 已经 2.8–6s，不能再退化。 |
| **不要用 `as any` 或 `@ts-ignore`** | 仓库当前只有 2 处经过论证的例外，不要增加。 |
| **不要删除页脚的"帮助中心""系统状态"条目** | 站主明确要求**恢复策略**——建真实页面，不是删链接。 |
| **不要给 `/status` 页做实时探针或自动健康检查** | 这是有意的设计决策，理由见 §4.3。 |

---

## 2. 环境与命令

```bash
# 开工前（本仓库约定：新会话第一个实际动作）
git fetch origin && git rebase origin/main    # 或用仓库封装的 git sync

# 类型检查（分 app/tests 两套 tsconfig，两个都要过）
npm run typecheck:app
npm run typecheck:tests

# 测试（注意：会先跑行数预算检查，预算不过测试根本不会启动）
npm test

# 单文件测试
npx vitest run tests/legal/privacy-advertising.test.ts

# 构建（会先跑 prisma migrate + generate）
npm run build

# 数据库迁移（仅 Phase 4 Task 13 需要）
npm run db:migrate:dev -- --name comment_moderation

# 术语表（写日文内容前跑，保证术语一致）
npm run glossary:build
```

**部署链路（供你理解，不要执行）：** 生产是 **Cloudflare Workers**（`@opennextjs/cloudflare`，`npm run cf:deploy`）。仓库里残留的 `vercel.json` 与 `@vercel/speed-insights` 是历史遗留，**不代表生产环境**。

---

## 3. 仓库约定（必须遵守）

来自 `AGENTS.md` 与实际配置核实：

- **路径别名是规范写法**：`@/lib/*`、`@/components/*`、`@/*`。不要写相对路径 `../../lib`。
- **行数预算 750 行**（`line-budget.allowlist.json` 中 `"lineBudget": 750`）。
  ⚠️ **`AGENTS.md` 里写的 800 是过时的，以 JSON 为准。**
  超限必须加进 `line-budget.allowlist.json`，且该文件要保持单调（只增不减条目）。
- **Vitest 项目按扩展名分流**：`.test.ts` → node 环境；`.test.tsx` → jsdom 环境。**放错扩展名会导致测试跑在错误环境**。
- **Lint 是建议性的**（`eslint ... || true`），不要把 lint 通过当作验收标准。
- **API 路由是薄包装**，业务逻辑放 `lib/*/handlers/`。Phase 4 Task 13 加举报接口时必须遵守这个模式：`app/api/**/route.ts` → `lib/comment/api.ts` → `lib/comment/handlers/*.ts`。
- **Prisma 只用单例** `@/lib/db/prisma`，不要新建客户端。
- **提交粒度**：一个 Task 一次提交，提交信息用 conventional commits（`feat(scope):` / `fix(scope):`）。计划文档每个 Task 末尾都给了提交命令。

---

## 4. 诊断证据（自包含，不要重新推导）

这一节是我实测得出的结论。**你不需要重新验证**，但如果执行中观察到与此矛盾的现象，请停下汇报，不要自行修改结论。

### 4.1 生产环境事实

| 项 | 值 |
|---|---|
| 托管 | Cloudflare Workers（OpenNext 适配器） |
| 规范域现状 | `seichigo.com` **308 →** `www.seichigo.com`（Cloudflare Redirect Rule，**不在代码仓库内**） |
| 代码里的规范域 | `lib/seo/site.ts:1` → `PROD_SITE_URL = 'https://seichigo.com'`（apex） |
| 后果 | sitemap 的 229 条 URL、所有 canonical/hreflang 都指向 apex，而 apex 会跳转 → **每条都是重定向链** |

### 4.2 实测：重定向链有两层

```
https://seichigo.com/en/anime
  → 308  (Cloudflare Redirect Rule；响应头 server: cloudflare，无 Worker 参与)
    https://www.seichigo.com/en/anime
      → 307  (middleware.ts:134)
        /ja/anime
```

第二跳的根因在 `middleware.ts:127-132`：

```ts
if (currentLocale === 'zh') {
  url.pathname = `/${targetLocale}${pathname}`
} else {
  const pathWithoutLocale = pathname.replace(/^\/(en|ja)/, '') || '/'
  url.pathname = `/${targetLocale}${pathWithoutLocale}`   // ← 这里
}
```

`else` 分支意味着：明确请求 `/en/anime` 的用户或爬虫，仍会按 IP 被改写成 `/ja/anime`。同一 URL 对不同 IP 返回不同终点。

### 4.3 实测：AdSense 爬虫被重定向（这一条是关键，原审计报告漏了）

`middleware.ts:11` 的 `BOT_PATTERN = /bot|crawler|spider|crawling|slurp|externalhit/i` **匹配不到 `Mediapartners-Google`**（该 UA 字符串里没有 bot / crawler / spider 这些子串）。实测结果：

| User-Agent | `www.seichigo.com/en/anime` 响应 |
|---|---|
| `Mediapartners-Google` | **307 → /ja/anime** ❌ |
| `Mozilla/5.0 (compatible; Googlebot/2.1; ...)` | 200 ✅（含 "bot"，命中 pattern） |
| `Mozilla/5.0 (compatible; AdsBot-Google; ...)` | 200 ✅（含 "bot"） |
| `Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)` | **307 → /ja/anime** ❌ |

`Mediapartners-Google` 正是 AdSense 用来读取页面内容以匹配广告的爬虫；`Google-InspectionTool` 是 Search Console 实时测试工具。这两个被重定向会直接影响审核。修复在计划文档 Task 8。

**复现命令**（你可以自己跑一遍确认）：

```bash
for ua in "Mediapartners-Google" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)"; do printf '%-30s ' "${ua:0:28}"; curl -sI -A "$ua" https://www.seichigo.com/en/anime | head -1; done
```

### 4.4 待复核的两个抓取异常

审计取证阶段观察到 `/posts` 列表页 404、`/city` 返回 200 但 body 0 字节。**这是你的第一个任务**（计划文档 Task 0）：

```bash
for p in /posts /city /en/city /ja/city /en/posts; do printf '%-14s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' -A "Mozilla/5.0" "https://www.seichigo.com$p"; done
```

- `/posts` 404 **很可能是设计如此**——`app/(site)/` 下只有 `posts/[slug]/`，没有 `posts/page.tsx`，文章列表在首页 `/`。确认后检查是否有页面链向 `/posts`，有则修，无则记录"非缺陷"继续。
- `/city` 若仍返回 0 字节，**这是真实缺陷，停止本计划先修它**，修完再回来做 Task 1。

---

## 5. 已核实的接口签名（直接用，不要猜）

写代码时会用到的现有 API，我已逐个核实：

```ts
// lib/seo/alternates.ts —— 三个 locale 各用各的，签名不同，注意参数名
buildZhAlternates({ path: '/help' })
buildEnAlternates({ zhPath: '/help' })        // 参数是 zhPath，不是 path
buildJaAlternates({ zhPath: '/help' })        // 参数是 zhPath，不是 path

// lib/legal/content.ts
export type LegalLocale = 'zh' | 'en' | 'ja'
export type LegalDocumentType = 'privacy' | 'terms'
export type LegalSection = { heading: string; paragraphs?: string[]; bullets?: string[] }
export type LegalDocument = {
  title: string; summary: string
  effectiveDateLabel: string; updatedDateLabel: string; contactLabel: string
  effectiveDate: string; updatedDate: string; contactEmail: string
  sections: LegalSection[]; closingNote?: string
}
getLegalDocument(type: LegalDocumentType, locale: LegalLocale): LegalDocument

// components/legal/LegalDocument.tsx —— 通用文档渲染器，props 就一个
<LegalDocument document={doc} />

// components/layout/SiteShell.tsx
export type SiteLocale = 'zh' | 'en' | 'ja'

// components/layout/prefixPath.ts
prefixPath(path: string, locale: SiteLocale): string
// zh 返回原路径；en/ja 加前缀；/auth /submit /admin /me /api /assets 不加前缀
```

**页面模板参照 `app/en/privacy/page.tsx`**（已核实的真实写法）：

```tsx
import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildEnAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('privacy', 'en')

export const metadata: Metadata = { /* ... */ alternates: buildEnAlternates({ zhPath: '/privacy' }), /* ... */ }
export const revalidate = 86400
export const dynamic = 'force-static'

export default function PrivacyPage() {
  return <LegalDocument document={document} />
}
```

**i18n 现状**：`lib/i18n/locales/{zh,en,ja}.json` 中 `footer.help` 与 `footer.status` 的三语文案**已存在**（「帮助中心」/`Help Center`/「ヘルプセンター」等）。Task 4 恢复死链时**不需要新增 i18n 键**。

**测试库**：`@testing-library/react` ^16.3.0 与 `@testing-library/jest-dom` ^6.8.0 已安装，`tests/setup.ts` 已配置。

---

## 6. 对计划文档的 3 处修正（以本节为准）

计划文档写在核实这些细节之前，以下三处需要覆盖：

### 6.1 测试文件扩展名

计划文档 Task 3 让你建 `tests/pages/help-status-pages.test.tsx`。但该测试**不渲染 React**（只断言数据结构和读文件），应该是 `.test.ts`：

- ✅ `tests/pages/help-status-pages.test.ts`（node 环境，纯数据断言 + 读 Footer 源码）
- ✅ `tests/legal/privacy-advertising.test.ts`（node 环境，目录需新建）
- ✅ `tests/components/copyright-notice.test.tsx`（jsdom 环境，**这个确实渲染 React，保持 .tsx**）

### 6.2 行数预算是 750 不是 800

计划文档 §风险登记第 4 条提到行数预算，`AGENTS.md` 说 800，**实际是 750**。相关影响：

- `lib/legal/content.ts` 当前 **576 行**，且**不在 allowlist 中**。Task 5 + Task 6 预计增加约 85 行 → 约 661 行。**在预算内但余量不大**。
- 若后续再改这个文件触发超限，**优先把 `terms` 拆到 `lib/legal/terms.ts`**，而不是加 allowlist。拆分要单独一次提交，不要混进 Task 5/6。
- `lib/help/content.ts`（新建）预计约 380–420 行，安全。

### 6.3 Task 6 的章节编号

计划文档 Task 6 用了 `N.` 占位。这是因为我没有读 `lib/legal/content.ts` 中 `terms` 的完整章节结构。**开工前先跑**：

```bash
grep -n "heading: '" lib/legal/content.ts
```

确定三语 terms 各自的章节数与编号，把新章节插入"知识产权"相关章节之后（若无此节，插到倒数第二节之前），并顺延其后所有编号。计划文档 Task 6 Step 5 的编号连续性测试会验证你改对了。

---

## 7. 阻塞决策点（需要人工回答）

### 决策 A：规范域选 apex 还是 www？【阻塞 Phase 2 Task 9，不阻塞 Phase 1】

| 选项 | 操作 | 代码改动 |
|---|---|---|
| **A. apex 为规范（Claude 推荐）** | 人工在 Cloudflare 控制台**反转**规则：`www → apex` | **零改动**（`PROD_SITE_URL` 已是 apex） |
| **B. www 为规范** | 保留现有规则 | `lib/seo/site.ts:1` 改为 `'https://www.seichigo.com'` |

推荐 A 的理由：代码、sitemap、JSON-LD、hreflang 全部已经写死 apex，选 A 改动面最小、回归风险最低，Cloudflare 侧只改一条规则。

**Codex 的动作：** 未得到答复前，跳过 Task 9 的代码部分，继续做其他 Task。得到 "A" 则 Task 9 无代码改动（只需在 §11 汇报里提醒站主去控制台操作）；得到 "B" 则改那一行并提交。

### 决策 B：Task 0 的两个抓取异常复核结果

跑完 §4.4 的命令后：
- 若 `/city` 正常 → 直接继续 Task 1。
- 若 `/city` 仍空 → **停止，汇报，等指示**。这是独立缺陷，不在本计划范围内。

---

## 8. 执行顺序与验收门

**必须按顺序执行。** 每个 Phase 结束跑一次全量 `npm test` + `npm run typecheck:app` + `npm run typecheck:tests`，全绿才进下一个 Phase。

### Phase 1 — Blocker（申请前必做，1–1.5 天）

| Task | 内容 | 主要文件 |
|---|---|---|
| **0** | 复核 `/posts`、`/city` 抓取异常 | 无（只读） |
| **1** | 帮助中心三语内容源 | 新建 `lib/help/content.ts` |
| **2** | 系统状态三语内容源 | 追加到 `lib/help/content.ts` |
| **3** | `/help` `/status` 六个路由页 | 新建 `app/{(site),en,ja}/{help,status}/page.tsx` |
| **4** | 页脚死链恢复 + 加入 sitemap | `components/layout/Footer.tsx:41-44,96-104`、`app/sitemap.ts` |
| **5** | 隐私政策补广告披露 | `lib/legal/content.ts` 三语 privacy |
| **6** | 用户协议补版权下架条款 | `lib/legal/content.ts` 三语 terms |
| **7** | 文章页挂载版权声明区块 | 新建 `components/legal/CopyrightNotice.tsx` + 挂载点 |

**Phase 1 验收：**
```bash
npm test && npm run typecheck:app && npm run typecheck:tests && npm run build
```
构建输出的路由清单中必须出现 `/help`、`/en/help`、`/ja/help`、`/status`、`/en/status`、`/ja/status` 且标记为静态。

### Phase 2 — URL 稳定性（申请前必做，0.5–1 天）

| Task | 内容 | 主要文件 |
|---|---|---|
| **8** | 中间件三处修复 | `middleware.ts:11,101-135` + `tests/middleware/i18n-redirect.test.ts` |
| **9** | 统一规范域 | 取决于决策 A；Cloudflare 部分**不是你的** |
| **10** | 上线与线上复验 | **不执行，交回站主** |

Task 8 的三条改动（计划文档有完整代码）：
1. `BOT_PATTERN` 增加 `mediapartners|adsbot|google-inspectiontool|google-extended|chrome-lighthouse`
2. 显式语言前缀（`currentLocale !== 'zh'`）直接 `next()`，不再按 IP 改写
3. 地域跳转收窄到首页 `/`，深层路径一律稳定

⚠️ **注意**：`tests/middleware/i18n-redirect.test.ts` 里可能有旧用例断言"深层路径按国家跳转"。那是被本任务**有意改掉**的行为——更新旧用例的断言，并在提交信息里说明。**不要为了让旧用例通过而放宽新用例。**

**Phase 2 验收：**
```bash
npx vitest run tests/middleware/i18n-redirect.test.ts && npm test
```

### Phase 3 — 提交申请

**全部是站主的动作**（账户核对、添加站点、部署验证代码、提交审核）。你不参与，只在 Phase 2 完成后汇报。

### Phase 4 — 审核等待期并行（不阻塞申请，2–3 天）

| Task | 内容 | 备注 |
|---|---|---|
| **13** | 评论审核与举报机制 | 需改 Prisma schema + 迁移；严格遵守 `api.ts → handlers/*.ts → repo*.ts` 模式 |
| **14** | ja/en 页面残留中文串补齐 | 用户可见价值最高的一项 |
| **15** | SSR `<html lang>` | **已决定不做**，只是记录论证过程 |

**Task 13 的范围是最小可行，不要扩大：** `Comment` 加 `status`（默认 `visible`）+ `hiddenAt`/`hiddenBy`；新增 `CommentReport`（含 `@@unique([commentId, reporterId])` 防重复举报）；`list` 过滤隐藏项；举报 API；复用已有 `/admin` 加评论管理页。**不要**做先审后发——评论量小且需登录，事后审核足够，先审后发会压死社区活跃度。

### Phase 5 — 获批之后

Task 16（ads.txt）、17（CMP）、18（广告位规范）、19（截图运营规范）。**全部等 AdSense 批准后再做**，现在不要动。特别是 `public/ads.txt` 在拿到 pub-id 之前不要创建空文件或占位内容。

---

## 9. 关键设计决策与理由（不要推翻）

这些是已经论证过的决定。如果你觉得有更好的做法，**先汇报再改**，不要单方面调整：

| 决策 | 理由 |
|---|---|
| 死链**恢复**而非删除 | 站主明确要求。且 `/help` 一次投入同时满足三项要求：ADS-UX-03 死链、ADS-UX-05 支持页、ADS-PUB-02 版权下架通道 |
| `/status` 手工维护 + 明确标注，**不做实时探针** | 永远显示"全部正常"的假仪表盘本身构成误导性内容，是政策风险而非加分项。页面必须保留"本页由人工维护，不是实时监控面板"这句话 |
| CMP 放到 Phase 5，**不阻塞申请** | Google 认证 CMP 必须在 AdSense 后台开启，申请前没有账户根本启不了；且审核期站点零广告代码、零第三方广告 Cookie。Phase 1 的隐私政策已预先写明同意机制来覆盖披露要求 |
| 新建的三语页面全部复用 `LegalDocument` 渲染器 | 零新组件、零新样式，天然与 `/privacy` `/terms` 视觉一致 |
| 地域跳转收窄到首页 | 深链稳定是 AdSense 硬要求。首页分流保留首访体验，`NEXT_LOCALE` Cookie 与语言切换器不受影响 |
| `<html lang>` 暂不重构 | 三个方案都算过：读 `headers()` 会让全站变 dynamic；多 root layout 要迁移整个 `app/en`/`app/ja` 目录。而它对审核是弱信号（内容语言与 hreflang 才是主信号，本站两者都正确） |
| 评论事后审核而非先审后发 | 见 §8 Phase 4 |

---

## 10. 三语内容的质量要求

计划文档里的中文、英文、日文文案是**完整可用的**，直接抄。若需要自己补写（Task 2 的 en/ja 状态页正文、Task 6 的 en/ja 条款）：

- **必须是逐节完整对照翻译，不是摘要。** 章节数、要点条数要与中文版一一对应。
- **写日文前先跑 `npm run glossary:build`**，参考 `lib/i18n/glossary.json`，保证「聖地巡礼」「作品」「都市」等术语与站内其他页面一致。
- **状态页的关键句必须保留**（这是政策合规的核心，不是可选的修辞）：
  - en：`This page is maintained manually and is not a real-time monitoring dashboard — see the "last verified" timestamp above.`
  - ja：`本ページは人手で更新しており、リアルタイム監視ダッシュボードではありません。最終確認日時はページ上部をご覧ください。`
- **隐私政策的三个链接一字不能错**（测试会断言）：`https://myadcenter.google.com`、`https://www.aboutads.info/choices`、`https://optout.networkadvertising.org`

---

## 11. 完成后需要汇报的内容

做完 Phase 1 + Phase 2 后停下，向站主汇报以下清单：

**代码侧自检（全部要有实际命令输出，不要凭印象声称）：**
- [ ] `npm test` 输出（含行数预算检查结果）
- [ ] `npm run typecheck:app` 与 `npm run typecheck:tests` 输出
- [ ] `npm run build` 的路由清单，确认 6 个新页面存在且为静态
- [ ] 每个 Task 的提交 hash 与提交信息
- [ ] 有没有更新 `line-budget.allowlist.json`，更新了哪些条目

**遗留给站主的人工动作（明确列出，不要假设站主记得）：**
- [ ] **Cloudflare 控制台**：按决策 A 反转 `apex ↔ www` 重定向规则（改动前截图存档）
- [ ] **部署**：按 `seichigo-predeploy-guard` 跑部署前检查 → `npm run cf:deploy` → 按 `seichigo-deploy-ledger` 打 `deploy/<ISO>` 标签
- [ ] **推送**：本地提交需要 `git push`（你不要自己推）
- [ ] **AdSense 账户侧**：计划文档 Task 11 的 7 项 Unknown 核对，其中最关键的两条 ——「若已有旧 AdSense 账户必须在旧账户内添加站点，重复开户会导致封禁」「开户表单不要勾选『面向儿童』」

**部署后的线上复验命令**（给站主，部署完成后跑）：

```bash
BASE=https://seichigo.com   # 若决策 B 则改成 www 域
echo "--- 新页面（应全部 200 且非空）---"
for p in /help /en/help /ja/help /status /en/status /ja/status; do printf '%-14s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' -A "Mozilla/5.0" "$BASE$p"; done
echo "--- URL 稳定性（同一 URL 三种 UA 应同为 200）---"
for ua in "Mozilla/5.0" "Mediapartners-Google" "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)"; do printf '%-30s ' "${ua:0:28}"; curl -s -o /dev/null -w '%{http_code}\n' -A "$ua" "$BASE/en/anime"; done
echo "--- 隐私政策广告条款（三行都应 >= 1）---"
for p in /privacy /en/privacy /ja/privacy; do printf '%-14s ' "$p"; curl -s -A "Mozilla/5.0" "$BASE$p" | grep -c "myadcenter.google.com"; done
echo "--- sitemap 抽样 20 条（Googlebot UA 下应全部直接 200，无 3xx）---"
GBOT="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
curl --retry 3 --retry-delay 1 --retry-connrefused -s "$BASE/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' | head -20 | while read -r u; do printf '%-58s ' "${u:0:56}"; curl --retry 3 --retry-delay 1 --retry-connrefused -s -o /dev/null -w '%{http_code}\n' -A "$GBOT" "$u"; done
echo "--- 页脚链接（Googlebot href 取证）---"
for base in "" /en /ja; do
  echo "--- 语言前缀: ${base:-/(zh)} ---"
  curl --retry 3 --retry-delay 1 --retry-connrefused -s -A "$GBOT" "https://seichigo.com${base:-/}" | grep -oE 'href="[^"]*(help|status)[^"]*"' | sort -u
done
echo "--- 确认全站无占位链接 ---"
for base in "" /en /ja; do printf '%-6s href="#" 出现次数: ' "${base:-/}"; curl --retry 3 --retry-delay 1 --retry-connrefused -s -A "$GBOT" "https://seichigo.com${base:-/}" | grep -c 'href="#"'; done
```

---

## 12. 可以提交 AdSense 申请的判定条件

全部为真才算就绪：

- [ ] `/help`、`/status` 三语共 6 个页面线上返回 200 且内容非空
- [ ] 页脚取证命令在 Googlebot UA 下分别输出三语对应前缀的 `/help`、`/status` href，且 `href="#"` 计数三行均为 `0`；以该可复现输出作为六个链接可达的验收合同，替代逐个浏览器点击
- [ ] 三语隐私政策含 AdSense、Cookie/网络信标、`myadcenter.google.com` 退出链接、CMP 说明
- [ ] 三语用户协议含版权引用与下架申请章节
- [ ] 文章页底部显示版权声明区块
- [ ] `https://seichigo.com/en/anime` 在普通 UA、`Mediapartners-Google`、`Google-InspectionTool` 三种 UA 下均返回 200
- [ ] sitemap 抽样结果为 20/20 条 URL 在 Googlebot UA 下直接 200，无 3xx。（根 URL `/` 对普通浏览器 UA 返回 307 → 语言首页，属首页地域分流的预期行为，不是缺陷——所有 Google 爬虫 UA 均直接 200。）
- [ ] `npm test`、`npm run typecheck:app`、`npm run typecheck:tests` 全绿
- [ ] 计划文档 Task 11 的 7 项站主确认全部完成

---

## 13. 相关文档索引

| 文档 | 内容 |
|---|---|
| [`docs/superpowers/plans/2026-08-04-adsense-readiness-fixes.md`](../superpowers/plans/2026-08-04-adsense-readiness-fixes.md) | **主计划**：19 个 Task 的完整分解，含可直接抄用的代码与三语文案 |
| `AGENTS.md`（仓库根） | 项目知识库：架构、约定、反模式、命令矩阵 |
| `tests/AGENTS.md` | 测试拆分、setup shims、执行模式 |
| `lib/comment/AGENTS.md` | 评论域的 repo 模式（Phase 4 Task 13 必读） |
| `lib/seo/AGENTS.md` | JSON-LD 与 spoke-factory 边界 |
| `line-budget.allowlist.json` | 行数预算 750 与豁免清单 |

**待创建（Phase 5）：** `docs/adsense/ad-placement.md`（广告位规范）、`docs/adsense/content-policy.md`（截图使用运营规范）、以及规范域决策的记录文件（Cloudflare 规则不在版本控制内，没有文档就没人知道它存在）。
