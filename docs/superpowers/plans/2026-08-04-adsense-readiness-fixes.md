# SeichiGo AdSense 申请就绪度修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。所有步骤使用 `- [ ]` 复选框语法追踪。
> **本文档为策略与规划，不含任何已执行的代码改动。**

**Goal:** 消除 2026-08-04 AdSense 审计报告中的 3 个 Blocker 与 4 个 High 风险项，使 seichigo.com 达到可提交 AdSense 申请的状态，并把 Medium 项安排到审核等待期并行完成。

**Architecture:** 分五个阶段推进。Phase 0 是只读诊断（已完成，结论见下）；Phase 1–2 是申请前必须落地的代码与内容改动；Phase 3 是申请提交动作；Phase 4 在审核等待期并行；Phase 5 在获批后执行。死链一律采取**恢复策略**——新建真实的 `/help` 与 `/status` 页面，而非删除页脚条目。

**Tech Stack:** Next.js 15 App Router（三套硬编码语言目录 `app/(site)` / `app/en` / `app/ja`）、TypeScript、Vitest、Prisma + PostgreSQL、Cloudflare Workers（OpenNext 适配器，`npm run cf:deploy`）、Cloudflare DNS/Rules。

---

## Phase 0：诊断结论（已完成，只读实测）

这一节记录实测证据，后续任务的定位全部基于它。**不要跳过阅读——其中两条修正了原审计报告的判断。**

### 0.1 生产托管是 Cloudflare Workers，不是 Vercel

`package.json` 有 `cf:build` / `cf:deploy`（`@opennextjs/cloudflare`），`wrangler.jsonc` 与 `open-next.config.ts` 均在。仓库里残留的 `vercel.json`（crons）与 `@vercel/speed-insights` 是历史遗留。`middleware.ts:110` 读的是 `x-vercel-ip-country`，OpenNext 的 Cloudflare 适配器会填充该兼容头，所以中间件**确实在生产生效**（下面 0.3 有实测）。

### 0.2 重定向链有两层，第一层不在代码仓库里

```
https://seichigo.com/en/anime
  → 308 (Cloudflare Redirect Rule, server: cloudflare, 无 Worker 参与)
    https://www.seichigo.com/en/anime
      → 307 (middleware.ts:134)
        /ja/anime
```

- **第一跳 308** 由 Cloudflare 控制台的 Redirect Rule（或 Bulk Redirect）产生，仓库中 `next.config.ts`、`vercel.json`、`public/_headers`、`wrangler.jsonc` 均无对应配置。**必须去 Cloudflare 控制台处理，不能靠改代码解决。**
- `lib/seo/site.ts:1` 的 `PROD_SITE_URL = 'https://seichigo.com'` 是 apex，而 apex 会 308 到 www。因此 `app/sitemap.ts` 输出的 229 条 URL、以及所有 canonical / hreflang，**每一条都指向一个会被重定向的地址**。这是 ADS-CRAWL-04 的第一个根因。

### 0.3 第二个根因：显式语言前缀仍被地域改写（middleware.ts:127-132）

```ts
// middleware.ts:127-132 —— 当前逻辑
if (currentLocale === 'zh') {
  url.pathname = `/${targetLocale}${pathname}`
} else {
  const pathWithoutLocale = pathname.replace(/^\/(en|ja)/, '') || '/'
  url.pathname = `/${targetLocale}${pathWithoutLocale}`   // ← 问题在这里
}
```

`else` 分支意味着：用户/爬虫明确请求 `/en/anime`，仍会按访客 IP 被改写成 `/ja/anime`。同一个 URL 对不同 IP 返回不同终点 —— 这正是 AdSense 与 Search Console 都不接受的"URL 不稳定"。同时它也破坏了分享链接（把 `/en/...` 发给日本的朋友，对方看到日文）。

### 0.4 【新发现，原审计未覆盖】Mediapartners-Google 在生产被 307 重定向

`middleware.ts:11` 的 `BOT_PATTERN = /bot|crawler|spider|crawling|slurp|externalhit/i` **不匹配 `Mediapartners-Google`**（该 UA 字符串中没有 bot / crawler / spider）。实测：

| User-Agent | `www.seichigo.com/en/anime` 响应 |
|---|---|
| `Mediapartners-Google` | **307 → /ja/anime** ❌ |
| `Googlebot/2.1` | 200 ✅（含 "bot"，命中 pattern） |
| `AdsBot-Google` | 200 ✅（含 "bot"） |
| `Google-InspectionTool/1.0` | **307 → /ja/anime** ❌ |

`Mediapartners-Google` 正是 **AdSense 用来读取页面内容以匹配广告的爬虫**，`Google-InspectionTool` 是 Search Console 实时测试工具。原审计报告中"Mediapartners-Google 实测 200"的结论应当来自 apex 域或地域匹配的路径，在 www + 跨地域场景下不成立。**这一项从 Pass 修正为需要修复，并入 Phase 2。**

### 0.5 待人工复核的两个抓取异常

审计取证阶段观察到 `/posts` 列表页 404、`/city` 返回 200 但 body 0 字节。这两项未进入最终报告表格，需要在 Phase 1 开始前复核确认是瞬时故障还是真实缺陷（见 Task 0）。

### 0.6 现有代码资产（后续任务复用）

| 资产 | 路径 | 用途 |
|---|---|---|
| 法务文档数据源 | `lib/legal/content.ts`（576 行，`Record<locale, Record<'privacy'\|'terms', LegalDocument>>`） | 隐私政策改文案的唯一落点 |
| 通用文档渲染器 | `components/legal/LegalDocument.tsx` | `/help`、`/status` 直接复用，零新组件 |
| 页脚 | `components/layout/Footer.tsx:42-43` | 两个 `href="#"` 死链 |
| 页脚文案 | `lib/i18n/locales/{zh,en,ja}.json` 的 `footer.help` / `footer.status`（键已存在，三语已有译文） | 恢复死链时无需新增 i18n 键 |
| 中间件测试 | `tests/middleware/i18n-redirect.test.ts`（已有 `createRequest` 工具函数） | Phase 2 的测试直接扩展 |
| 规范域来源 | `lib/seo/site.ts:1` | 统一 canonical 的单点 |
| 评论数据模型 | `prisma/schema.prisma:367` `model Comment`（无 status 字段） | Phase 4 审核机制 |

### 0.7 执行前置

- 本仓库有 `seichigo-git-sync-spush` 约定：动手改代码前先跑 `git sync`（fetch + rebase on origin/main）。
- 本仓库有 `seichigo-predeploy-guard` 约定：**任何 `cf:deploy` 之前必须先跑部署前检查**，禁止部署未推送到 origin 的代码。
- 有 `npm run check:line-budget`（`npm test` 会先跑它），新增文件注意行数预算，必要时更新 `line-budget.allowlist.json`。

---

## File Structure

新建与修改的文件全表。每个文件一个明确职责。

**新建**

| 文件 | 职责 |
|---|---|
| `lib/help/content.ts` | 帮助中心与系统状态两份文档的三语数据源，复用 `LegalDocument` 类型 |
| `app/(site)/help/page.tsx` | 中文帮助中心路由 |
| `app/en/help/page.tsx` | 英文帮助中心路由 |
| `app/ja/help/page.tsx` | 日文帮助中心路由 |
| `app/(site)/status/page.tsx` | 中文系统状态路由 |
| `app/en/status/page.tsx` | 英文系统状态路由 |
| `app/ja/status/page.tsx` | 日文系统状态路由 |
| `components/legal/CopyrightNotice.tsx` | 文章底部的图片版权与引用声明区块 |
| `tests/pages/help-status-pages.test.tsx` | 新页面可渲染、含关键内容、无 `href="#"` |
| `tests/legal/privacy-advertising.test.ts` | 三语隐私政策必须含广告披露与退出链接 |
| `public/ads.txt` | Phase 5，拿到 pub-id 后创建 |
| `docs/adsense/content-policy.md` | 截图使用比例与版权运营规范（非代码） |

**修改**

| 文件 | 改动 |
|---|---|
| `lib/legal/content.ts` | 三语 privacy 插入"第三方广告与同意管理"章节并顺延编号；三语 terms 插入版权与下架申请章节；更新 `updatedDate` |
| `components/layout/Footer.tsx:41-44` | `#` 死链改为真实 `/help`、`/status` 内链；移除 `href === '#'` 的特判分支 |
| `middleware.ts:11,127-132` | 扩充 `BOT_PATTERN`；显式语言前缀不再地域改写；地域跳转收窄到首页 |
| `tests/middleware/i18n-redirect.test.ts` | 新增前缀稳定性与 AdSense 爬虫 UA 用例 |
| `lib/seo/site.ts:1` | `PROD_SITE_URL` 与最终宿主对齐（取决于 Task 5 的域名决策） |
| `app/sitemap.ts` | 新增 `/help`、`/status` 三语条目 |
| `components/.../PostArticle`（Task 7 中定位） | 挂载 `CopyrightNotice` |
| `prisma/schema.prisma:367` | Phase 4：`Comment` 加 `status`，新增 `CommentReport` |
| `lib/comment/handlers/comments.ts` | Phase 4：list 过滤隐藏评论，新增 report handler |

---

## 策略总览

| 阶段 | 内容 | 阻塞申请？ | 预估 |
|---|---|---|---|
| **Phase 0** | 只读诊断 | — | ✅ 已完成 |
| **Phase 1** | 死链恢复（/help、/status）、隐私政策广告条款、版权声明 | **是** | 1–1.5 天 |
| **Phase 2** | URL 稳定性：中间件 + 规范域 + 爬虫 UA | **是** | 0.5–1 天 |
| **Phase 3** | 提交申请：7 个 Unknown 核对 + 站点验证 | — | 0.5 天 |
| **Phase 4** | 审核等待期并行：评论审核、`<html lang>`、ja/en 翻译补齐 | 否 | 2–3 天 |
| **Phase 5** | 获批后：ads.txt、CMP、广告位规范 | 否 | 0.5 天 |

**关键时序判断（与原审计不同的一处）：** 原审计把 CMP（ADS-PRIV-04）列为申请前 High。实际上申请审核阶段站点**没有任何广告代码、没有第三方广告 Cookie**，仅有 GA 与语言 Cookie，此时缺 CMP 不是审核失败项。而 Google 官方的 CMP（Privacy & messaging / Funding Choices）**必须在 AdSense 后台开启，需要先有账户**——申请前根本无法启用。因此本计划把 CMP 移到 Phase 5，作为**广告代码上线的前置门禁**而非申请前置。Phase 1 会在隐私政策里预先写明同意机制，覆盖审核期的披露要求。

---

## Phase 1：Blocker 修复（申请前必做）

### Task 0：复核 Phase 0.5 的两个抓取异常

**Files:** 无（只读验证）

- [ ] **Step 1: 复核 /posts 与 /city**

```bash
for p in /posts /city /en/city /ja/city /en/posts; do printf '%-14s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' -A "Mozilla/5.0" "https://www.seichigo.com$p"; done
```

预期：全部 `200` 且 `size_download` 明显大于 0。

- [ ] **Step 2: 分流**

若 `/posts` 仍 404 —— 确认这是设计如此（文章列表就在首页 `/`，`app/(site)` 下无 `posts/page.tsx` 只有 `posts/[slug]`）。若是设计如此，检查是否有任何页面链向 `/posts`，有则一并修正；无则记录"非缺陷"并继续。
若 `/city` 仍返回 0 字节 —— 这是真实缺陷，停止本计划，先按 `superpowers:systematic-debugging` 定位，修复后再回到 Task 1。

---

### Task 1：新建帮助中心内容源

**Files:**
- Create: `lib/help/content.ts`

**设计：** 完全复用 `lib/legal/content.ts` 已验证的 `LegalDocument` / `LegalSection` 类型，不引入新组件、新渲染逻辑。这样 `/help` 与 `/status` 天然与 `/privacy`、`/terms` 视觉一致。

- [ ] **Step 1: 创建文件骨架与类型复用**

```ts
// lib/help/content.ts
import type { LegalDocument, LegalLocale } from '@/lib/legal/content'

export type InfoDocumentType = 'help' | 'status'

const CONTACT_EMAIL = 'ljj231428@gmail.com'
const UPDATED = '2026-08-04'
```

- [ ] **Step 2: 写入中文帮助中心内容**

```ts
const zhHelp: LegalDocument = {
  title: '帮助中心',
  summary:
    'SeichiGo 是一个动漫圣地巡礼攻略站。这里汇总了最常见的使用问题：怎么找到想去的地点、路线信息从哪来、如何投稿与纠错、以及图片版权与下架申请的处理方式。',
  effectiveDateLabel: '首次发布',
  updatedDateLabel: '最近更新',
  contactLabel: '联系我们',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. 快速上手：三种找地点的方式',
      bullets: [
        '按作品找：进入「作品」页，选择动画后可以看到该作品已收录的全部巡礼地点与对应攻略长文。',
        '按城市找：进入「城市」页，适合已经确定旅行目的地、想知道当地有哪些作品取景的场景。',
        '按地图找：进入「地图」页，可以在地图上直接浏览地点分布，适合规划一天之内的连续行程。',
      ],
    },
    {
      heading: '2. 攻略里的路线信息怎么读',
      bullets: [
        '每篇攻略的地点表包含「顺序 / 地点 / 最近车站 / 建议用时」四列，顺序是按实际步行与换乘效率排过的。',
        '「最近车站」指的是从该站步行可达的距离，具体步行时间以站内标注为准。',
        '导航按钮会打开 Google 地图，你可以在页面内直接切换步行、公共交通或驾车模式。',
        '建议用时只包含在该地点停留与拍摄的时间，不含点与点之间的移动时间。',
      ],
    },
    {
      heading: '3. 投稿、纠错与账号',
      bullets: [
        '投稿需要先登录。登录支持邮箱验证码与密码两种方式。',
        '所有投稿都会进入人工审核队列，审核通过后才会公开显示。',
        '发现地点信息过时（店铺关闭、车站改名、场景已拆除）时，请通过页面底部的联系邮箱告诉我们，注明文章链接与具体段落。',
        '昵称、头像、个人简介与社交链接可以在「我的设置」中修改。',
        '当前版本没有站内一键注销功能，需要注销账号请发邮件申请。',
      ],
    },
    {
      heading: '4. 图片版权与下架申请',
      paragraphs: [
        '巡礼类内容需要把动画画面与实景照片并列对照，这是本站攻略的核心表达方式。站内出现的动画截图版权归各自的著作权人所有，我们仅在场景对照与评论说明的必要范围内引用，不用于独立售卖或再分发。',
      ],
      bullets: [
        '实景照片由站方或投稿者拍摄，版权归拍摄者所有。',
        '若你是动画画面或照片的著作权人（或其授权代理人），认为站内某处引用超出了合理范围，请发送邮件至上方联系邮箱。',
        '为便于快速处理，请在邮件中提供：作品名称与具体画面、涉及的页面链接、你的权利证明或授权关系说明、以及你希望的处理方式（署名补充 / 替换 / 下架）。',
        '我们会在收到完整信息后 7 个工作日内回复并处理，处理期间可先行隐藏争议内容。',
      ],
    },
    {
      heading: '5. 巡礼礼仪',
      paragraphs: [
        '大量取景地是私人住宅、在营业的商铺或学校。请在到访前阅读「圣地巡礼礼仪」页，遵守当地规则，不打扰居民与经营者。这是这份爱好能长期存在的前提。',
      ],
    },
    {
      heading: '6. 没找到答案？',
      paragraphs: [
        '以上没有覆盖到的问题，欢迎直接发邮件。我们会把高频问题补充进这一页。',
      ],
    },
  ],
  closingNote: '本页内容随功能变化更新，更新日期见页首。',
}
```

- [ ] **Step 3: 写入英文帮助中心内容**

英文版是上面中文版的**完整对照翻译**，不是摘要。逐节对应，标题与要点数量一一对齐：

```ts
const enHelp: LegalDocument = {
  title: 'Help Center',
  summary:
    'SeichiGo is a guide site for anime pilgrimage (seichi junrei). This page collects the most common questions: how to find the locations you want to visit, where the route information comes from, how to submit or correct content, and how image copyright and takedown requests are handled.',
  effectiveDateLabel: 'First published',
  updatedDateLabel: 'Last updated',
  contactLabel: 'Contact us',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. Getting started: three ways to find locations',
      bullets: [
        'By anime: open the Anime page, pick a title, and you will see every pilgrimage location we have catalogued for it along with the full guide articles.',
        'By city: open the Cities page. This works best when you already know your destination and want to know which anime were filmed there.',
        'By map: open the Map page to browse locations geographically — useful for planning a continuous one-day route.',
      ],
    },
    {
      heading: '2. How to read the route information in a guide',
      bullets: [
        'Each guide has a location table with four columns: order, location, nearest station, and suggested time. The order is sequenced for walking and transfer efficiency.',
        '"Nearest station" means the station from which the location is reachable on foot; refer to the note in the article for the actual walking time.',
        'The navigation button opens Google Maps, and you can switch between walking, transit and driving modes directly on the page.',
        'Suggested time covers only time spent at the location itself, not travel between locations.',
      ],
    },
    {
      heading: '3. Submissions, corrections and accounts',
      bullets: [
        'You need to sign in before submitting. Both email verification codes and passwords are supported.',
        'Every submission enters a human review queue and is published only after approval.',
        'If you find outdated information (a shop has closed, a station was renamed, a location no longer exists), email us using the address above and include the article link and the specific passage.',
        'Display name, avatar, bio and social links can be edited under My Settings.',
        'This version has no self-service account deletion; email us to request account closure.',
      ],
    },
    {
      heading: '4. Image copyright and takedown requests',
      paragraphs: [
        'Pilgrimage content requires placing anime frames next to real-world photographs — that side-by-side comparison is the core form of our guides. Anime frames appearing on this site remain the property of their respective copyright holders, and we quote them only to the extent necessary for scene comparison and commentary. We do not sell or redistribute them independently.',
      ],
      bullets: [
        'Real-world photographs are taken by the site or by contributors and remain the property of the photographer.',
        'If you are the copyright holder (or an authorised agent) of an anime frame or photograph and believe a use on this site exceeds fair quotation, please email the address above.',
        'To help us act quickly, please include: the title and the specific frame, the page URL concerned, evidence of your rights or authorisation, and your preferred remedy (added attribution / replacement / removal).',
        'We will respond and act within 7 business days of receiving complete information, and can hide the disputed content while the request is being processed.',
      ],
    },
    {
      heading: '5. Pilgrimage etiquette',
      paragraphs: [
        'Many locations are private homes, operating businesses or schools. Please read the Pilgrimage Etiquette page before visiting, follow local rules, and do not disturb residents or business owners. This is what allows the hobby to continue existing.',
      ],
    },
    {
      heading: '6. Still stuck?',
      paragraphs: [
        'For anything not covered above, email us directly. We add frequently asked questions to this page as they come up.',
      ],
    },
  ],
  closingNote: 'This page is updated as features change; see the date at the top.',
}
```

- [ ] **Step 4: 写入日文帮助中心内容**

日文版同样是完整对照翻译。**必须先运行 `npm run glossary:build` 并参考 `lib/i18n/glossary.json`**，保证「聖地巡礼」「作品」「都市」等术语与站内其他页面一致。

```ts
const jaHelp: LegalDocument = {
  title: 'ヘルプセンター',
  summary:
    'SeichiGo はアニメ聖地巡礼のガイドサイトです。このページでは、行きたい場所の探し方、ルート情報の読み方、投稿・修正の方法、画像の著作権と削除依頼の取り扱いについて、よくある質問をまとめています。',
  effectiveDateLabel: '初回公開',
  updatedDateLabel: '最終更新',
  contactLabel: 'お問い合わせ',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. はじめに：場所を探す 3 つの方法',
      bullets: [
        '作品から探す：「作品」ページでアニメを選ぶと、その作品について収録済みのすべての巡礼スポットとガイド記事が表示されます。',
        '都市から探す：「都市」ページは、行き先がすでに決まっていて、その土地でどの作品がロケされたかを知りたい場合に便利です。',
        '地図から探す：「地図」ページではスポットの分布を地図上で確認できます。1 日で回る連続ルートを組むときに向いています。',
      ],
    },
    {
      heading: '2. ガイド内のルート情報の読み方',
      bullets: [
        '各ガイドのスポット表は「順序 / 場所 / 最寄り駅 / 所要時間」の 4 列で構成され、順序は徒歩と乗り換えの効率を考慮して並べています。',
        '「最寄り駅」はそのスポットまで徒歩で行ける駅を指します。実際の徒歩時間は記事内の記載をご確認ください。',
        'ナビボタンから Google マップが開きます。ページ内で徒歩・公共交通機関・自動車のモードを切り替えられます。',
        '所要時間はそのスポットでの滞在と撮影の時間のみで、スポット間の移動時間は含みません。',
      ],
    },
    {
      heading: '3. 投稿・修正・アカウント',
      bullets: [
        '投稿にはログインが必要です。メール認証コードとパスワードの両方に対応しています。',
        'すべての投稿は人手による審査を経て、承認後に公開されます。',
        '情報が古くなっている場合（店舗の閉店、駅名の変更、現存しないロケ地など）は、上記のメールアドレスまで記事リンクと該当箇所を添えてご連絡ください。',
        '表示名・アイコン・自己紹介・SNS リンクは「マイ設定」から変更できます。',
        '現在のバージョンにはサイト内での退会機能がありません。アカウント削除はメールでご依頼ください。',
      ],
    },
    {
      heading: '4. 画像の著作権と削除依頼',
      paragraphs: [
        '聖地巡礼のコンテンツは、アニメの画面と実景写真を並べて比較することが表現の核になります。当サイトに掲載されるアニメ画面の著作権はそれぞれの権利者に帰属し、場面の対比と解説に必要な範囲でのみ引用しています。単独での販売や再配布は行いません。',
      ],
      bullets: [
        '実景写真は当サイトまたは投稿者が撮影したもので、著作権は撮影者に帰属します。',
        'アニメ画面または写真の著作権者（もしくは正当な代理人）の方で、当サイトでの引用が適正な範囲を超えているとお考えの場合は、上記アドレスまでご連絡ください。',
        '迅速な対応のため、作品名と該当画面、対象ページの URL、権利関係を示す資料、ご希望の対応（クレジット追加 / 差し替え / 削除）をお知らせください。',
        '必要な情報がそろい次第、7 営業日以内に回答し対応します。対応期間中は該当箇所を非表示にすることも可能です。',
      ],
    },
    {
      heading: '5. 巡礼マナー',
      paragraphs: [
        '多くのロケ地は個人の住宅、営業中の店舗、学校です。訪問前に「聖地巡礼マナー」ページをお読みいただき、現地のルールを守り、住民や事業者の方のご迷惑にならないようご協力ください。この趣味が続いていくための前提です。',
      ],
    },
    {
      heading: '6. 解決しない場合',
      paragraphs: [
        '上記で解決しない場合は、直接メールでお問い合わせください。よくいただく質問はこのページに追記していきます。',
      ],
    },
  ],
  closingNote: '本ページは機能の変更に応じて更新されます。更新日はページ上部をご確認ください。',
}
```

- [ ] **Step 5: 导出访问函数**

```ts
const helpDocuments: Record<LegalLocale, LegalDocument> = { zh: zhHelp, en: enHelp, ja: jaHelp }

export function getHelpDocument(locale: LegalLocale): LegalDocument {
  return helpDocuments[locale]
}
```

- [ ] **Step 6: 类型检查并提交**

```bash
npm run typecheck:app
```

预期：无错误。

```bash
git add lib/help/content.ts && git commit -m "feat(help): add trilingual help center content source"
```

---

### Task 2：新建系统状态内容源

**Files:**
- Modify: `lib/help/content.ts`

**设计决策（重要）：** 不做实时探针。一个手工维护但**诚实标注**的状态页优于一个永远显示"全部正常"的假仪表盘——后者本身构成误导性内容，属于 AdSense 政策风险。页面明确写"手工维护 + 最后核对时间"，并提供报障入口。

- [ ] **Step 1: 追加中文系统状态文档**

```ts
const zhStatus: LegalDocument = {
  title: '系统状态',
  summary:
    '本页记录 SeichiGo 各项服务的当前状态、已知问题与历史事件。本页由人工维护，不是实时监控面板——最后核对时间见页首。遇到本页未记录的故障，请通过下方邮箱告诉我们。',
  effectiveDateLabel: '本页启用',
  updatedDateLabel: '最后核对',
  contactLabel: '故障报告',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. 服务组件与当前状态',
      bullets: [
        '网站主站（文章、作品、城市、资源页）：正常运行。',
        '地图与地点浏览：正常运行。',
        '账号登录与邮箱验证码：正常运行。',
        '投稿、审核与评论：正常运行。',
        '图片上传与图床：正常运行。',
        '每日数据同步任务：正常运行。',
      ],
    },
    {
      heading: '2. 已知问题',
      paragraphs: [
        '当前没有影响正常使用的已知问题。发现新问题时会在这里列出，并标注影响范围与预计恢复时间。',
      ],
    },
    {
      heading: '3. 历史事件',
      paragraphs: [
        '本页自 2026-08-04 起启用，此前的运维事件未在此记录。后续所有影响用户访问的事件都会按时间倒序追加在这一节。',
      ],
    },
    {
      heading: '4. 如何报告故障',
      bullets: [
        '请发送邮件至上方地址，标题注明「故障报告」。',
        '为便于定位，请提供：出问题的页面链接、你使用的浏览器与设备、发生时间，以及可能的话一张截图。',
        '我们会在确认问题后把它登记到「已知问题」一节，并在修复后移入「历史事件」。',
      ],
    },
    {
      heading: '5. 计划内维护',
      paragraphs: [
        '需要停机的维护会提前在这一节公告，包含时间窗口与受影响的功能。目前没有计划内维护。',
      ],
    },
  ],
  closingNote: '本页由人工维护，状态信息以「最后核对」时间为准，不代表实时可用性保证。',
}
```

- [ ] **Step 2: 追加英文系统状态文档**

逐节完整对照翻译 `zhStatus`，标题依次为 `1. Service components and current status` / `2. Known issues` / `3. Incident history` / `4. How to report an issue` / `5. Planned maintenance`，`title: 'System Status'`，`contactLabel: 'Report an issue'`，`effectiveDateLabel: 'Page live since'`，`updatedDateLabel: 'Last verified'`。**关键句必须保留**：`This page is maintained manually and is not a real-time monitoring dashboard — see the "last verified" timestamp above.`

- [ ] **Step 3: 追加日文系统状态文档**

同样逐节完整对照翻译，`title: 'システムステータス'`，`contactLabel: '障害のご報告'`，`effectiveDateLabel: 'ページ公開日'`，`updatedDateLabel: '最終確認'`。**关键句必须保留**：`本ページは人手で更新しており、リアルタイム監視ダッシュボードではありません。最終確認日時はページ上部をご覧ください。`

- [ ] **Step 4: 导出并提交**

```ts
const statusDocuments: Record<LegalLocale, LegalDocument> = { zh: zhStatus, en: enStatus, ja: jaStatus }

export function getStatusDocument(locale: LegalLocale): LegalDocument {
  return statusDocuments[locale]
}
```

```bash
npm run typecheck:app && git add lib/help/content.ts && git commit -m "feat(status): add trilingual system status content source"
```

---

### Task 3：新建 /help 与 /status 六个路由页

**Files:**
- Create: `app/(site)/help/page.tsx`, `app/en/help/page.tsx`, `app/ja/help/page.tsx`
- Create: `app/(site)/status/page.tsx`, `app/en/status/page.tsx`, `app/ja/status/page.tsx`
- Test: `tests/pages/help-status-pages.test.tsx`

**模式：** 严格照抄 `app/(site)/privacy/page.tsx` 的结构（模块顶层取文档、`export const revalidate = 86400`、`export const dynamic = 'force-static'`、`buildZhAlternates` / `buildEnAlternates` / `buildJaAlternates`）。

- [ ] **Step 1: 写失败测试**

```tsx
// tests/pages/help-status-pages.test.tsx
import { describe, it, expect } from 'vitest'
import { getHelpDocument, getStatusDocument } from '@/lib/help/content'

describe('help & status documents', () => {
  it.each(['zh', 'en', 'ja'] as const)('help doc for %s has contact email and copyright section', (locale) => {
    const doc = getHelpDocument(locale)
    expect(doc.contactEmail).toContain('@')
    expect(doc.sections.length).toBeGreaterThanOrEqual(6)
    const joined = JSON.stringify(doc).toLowerCase()
    expect(joined).toMatch(/copyright|著作権|版权/)
  })

  it.each(['zh', 'en', 'ja'] as const)('status doc for %s declares manual maintenance', (locale) => {
    const doc = getStatusDocument(locale)
    const joined = JSON.stringify(doc)
    expect(joined).toMatch(/人工维护|maintained manually|人手で更新/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/pages/help-status-pages.test.tsx
```

预期：如果 Task 1/2 已完成则直接通过；若尚未完成则 `Cannot find module '@/lib/help/content'`。

- [ ] **Step 3: 创建中文 /help 路由**

```tsx
// app/(site)/help/page.tsx
import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getHelpDocument } from '@/lib/help/content'
import { buildZhAlternates } from '@/lib/seo/alternates'

const document = getHelpDocument('zh')
const title = '帮助中心｜SeichiGo'
const description = '圣地巡礼怎么找地点、路线信息怎么读、如何投稿纠错，以及图片版权与下架申请的处理方式。'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildZhAlternates({ path: '/help' }),
  openGraph: { type: 'website', url: '/help', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function HelpPage() {
  return <LegalDocument document={document} />
}
```

- [ ] **Step 4: 创建其余五个路由**

`app/en/help/page.tsx` 与 `app/ja/help/page.tsx` 结构相同，分别用 `getHelpDocument('en')` / `getHelpDocument('ja')`，以及 `buildEnAlternates({ zhPath: '/help' })` / `buildJaAlternates({ zhPath: '/help' })`（先确认 `lib/seo/alternates.ts` 中这两个函数的确切签名，参考 `app/en/privacy/page.tsx` 的用法）。`title` / `description` 用对应语言。

`app/(site)/status/page.tsx`、`app/en/status/page.tsx`、`app/ja/status/page.tsx` 同理，改用 `getStatusDocument(...)` 与 `path: '/status'`。

- [ ] **Step 5: 本地验证六个路由都能渲染**

```bash
npm run build
```

预期：构建成功，输出的路由清单中出现 `/help`、`/en/help`、`/ja/help`、`/status`、`/en/status`、`/ja/status`，且标记为静态。

- [ ] **Step 6: 提交**

```bash
git add app tests/pages/help-status-pages.test.tsx && git commit -m "feat(pages): add trilingual /help and /status pages"
```

---

### Task 4：页脚死链恢复（ADS-UX-03 Blocker）

**Files:**
- Modify: `components/layout/Footer.tsx:41-44,96-104`

**注意：** `lib/i18n/locales/*.json` 中 `footer.help` / `footer.status` 三语文案**已存在**（zh「帮助中心」「系统状态」、en `Help Center`/`System Status`），无需新增 i18n 键。

- [ ] **Step 1: 把死链改为真实内链**

```tsx
// components/layout/Footer.tsx:38-45
    {
      title: t('footer.support', locale),
      links: [
        { label: t('footer.etiquette', locale), href: '/resources/pilgrimage-etiquette' },
        { label: t('footer.help', locale), href: '/help' },
        { label: t('footer.status', locale), href: '/status' },
      ],
    },
```

- [ ] **Step 2: 移除 `href === '#'` 的特判分支**

`getHref`（第 24 行）中删除 `|| path === '#'`；渲染分支（第 96-104 行）改为只判断 `link.isExternal`：

```tsx
                      {link.isExternal ? (
                        <a
                          href={link.href}
                          className="text-gray-500 hover:text-brand-600"
                          target={link.href.startsWith('http') ? '_blank' : undefined}
                          rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link href={getHref(link.href)} prefetch={false} className="text-gray-500 hover:text-brand-600">
                          {link.label}
                        </Link>
                      )}
```

- [ ] **Step 3: 加一条守卫测试，防止死链回归**

```tsx
// 追加到 tests/pages/help-status-pages.test.tsx
import { readFileSync } from 'node:fs'

it('footer contains no placeholder href', () => {
  const src = readFileSync('components/layout/Footer.tsx', 'utf8')
  expect(src).not.toContain("href: '#'")
  expect(src).toContain("href: '/help'")
  expect(src).toContain("href: '/status'")
})
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/pages/help-status-pages.test.tsx
```

预期：全部 PASS。

- [ ] **Step 5: 把新页面加入 sitemap**

在 `app/sitemap.ts` 的 `items` 数组中，紧随 `/about` 条目之后加入（照抄 `/about` 的写法，`changeFrequency: 'monthly'`，`priority: 0.3`）：

```ts
    { url: `${base}/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.3, alternates: { languages: { zh: `${base}/help`, en: `${base}/en/help`, ja: `${base}/ja/help` } } },
    { url: `${base}/en/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.2, alternates: { languages: { zh: `${base}/help`, en: `${base}/en/help`, ja: `${base}/ja/help` } } },
    { url: `${base}/ja/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.2, alternates: { languages: { zh: `${base}/help`, en: `${base}/en/help`, ja: `${base}/ja/help` } } },
    { url: `${base}/status`, lastModified: now, changeFrequency: 'monthly', priority: 0.2, alternates: { languages: { zh: `${base}/status`, en: `${base}/en/status`, ja: `${base}/ja/status` } } },
    { url: `${base}/en/status`, lastModified: now, changeFrequency: 'monthly', priority: 0.1, alternates: { languages: { zh: `${base}/status`, en: `${base}/en/status`, ja: `${base}/ja/status` } } },
    { url: `${base}/ja/status`, lastModified: now, changeFrequency: 'monthly', priority: 0.1, alternates: { languages: { zh: `${base}/status`, en: `${base}/en/status`, ja: `${base}/ja/status` } } },
```

- [ ] **Step 6: 提交**

```bash
npm test && git add components/layout/Footer.tsx app/sitemap.ts tests/pages/help-status-pages.test.tsx && git commit -m "fix(footer): restore help/status links to real pages and add to sitemap"
```

---

### Task 5：隐私政策补广告披露（ADS-PRIV-01 / 02 Blocker）

**Files:**
- Modify: `lib/legal/content.ts`
- Test: `tests/legal/privacy-advertising.test.ts`

**结构决策：** 在现有「4. Cookie 与分析工具」之后插入**一个**合并章节（广告披露 + 同意管理合并为一节），把原 5–10 节顺延为 6–11 节。合并成一节可以把编号改动量降到最小，同时覆盖 ADS-PRIV-01、02、04 三项披露要求。三语都要改。

- [ ] **Step 1: 写失败测试**

```ts
// tests/legal/privacy-advertising.test.ts
import { describe, it, expect } from 'vitest'
import { getLegalDocument } from '@/lib/legal/content'

const LOCALES = ['zh', 'en', 'ja'] as const

describe('privacy policy advertising disclosure', () => {
  it.each(LOCALES)('%s privacy policy discloses third-party advertising cookies', (locale) => {
    const doc = getLegalDocument('privacy', locale)
    const text = JSON.stringify(doc)
    expect(text).toMatch(/AdSense/)
    expect(text).toMatch(/myadcenter\.google\.com/)
    expect(text).toMatch(/aboutads\.info/)
  })

  it.each(LOCALES)('%s privacy policy mentions consent management for EEA', (locale) => {
    const doc = getLegalDocument('privacy', locale)
    expect(JSON.stringify(doc)).toMatch(/TCF|CMP/)
  })

  it.each(LOCALES)('%s privacy section headings are sequentially numbered', (locale) => {
    const doc = getLegalDocument('privacy', locale)
    const numbers = doc.sections.map((s) => Number(s.heading.match(/^(\d+)\./)?.[1]))
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/legal/privacy-advertising.test.ts
```

预期：前两组 FAIL（找不到 AdSense / myadcenter），第三组 PASS。

- [ ] **Step 3: 中文版插入新章节**

在 `lib/legal/content.ts` 中文 `privacy.sections` 里，`'4. Cookie 与分析工具'` 这一节对象之后插入：

```ts
        {
          heading: '5. 第三方广告与同意管理',
          paragraphs: [
            '本站通过第三方广告（包括 Google AdSense）获得运营收入。以下说明广告相关的数据处理方式。',
          ],
          bullets: [
            'Google 作为第三方供应商，会使用 Cookie（包括 DoubleClick DART Cookie）在本站投放广告。',
            'Google 及其合作的第三方供应商与广告网络，可能使用 Cookie、网络信标（web beacon）及类似技术，收集你的 IP 地址、浏览器类型、访问时间、浏览页面与点击行为等非直接身份识别信息，用于衡量广告效果并投放相关广告。',
            'Google 可能基于你在本站及其他网站的历史访问，向你展示个性化广告。',
            '你可以访问 Google 广告设置（https://myadcenter.google.com）关闭个性化广告；也可以通过 https://www.aboutads.info/choices 或 https://optout.networkadvertising.org 统一管理参与厂商的广告 Cookie。',
            '你也可以在浏览器中禁用第三方 Cookie。这不会影响你阅读站内内容，但可能降低广告相关性。',
            '若你位于欧洲经济区、英国或瑞士，我们会在展示广告前，通过符合 IAB TCF 标准的 Google 认证同意管理平台（CMP）征求你对 Cookie 与个性化广告的同意，你可以随时通过页面上的同意设置入口撤回或变更选择。',
            '我们不会将你的邮箱地址、账号昵称或投稿内容提供给广告供应商用于广告定向。',
          ],
        },
```

- [ ] **Step 4: 中文版顺延后续编号并补一条共享方**

把中文 privacy 原第 5–10 节的编号依次改为 6–11：`'5. 信息共享与第三方处理'` → `'6. 信息共享与第三方处理'`，`'6. 数据存储与安全'` → `'7. ...'`，`'7. 数据保留'` → `'8. ...'`，`'8. 你的权利'` → `'9. ...'`，`'9. 未成年人'` → `'10. ...'`，`'10. 政策更新'` → `'11. ...'`。

同时在改为「6. 信息共享与第三方处理」的那一节 `bullets` 中，紧随「分析服务商（Google Analytics）用于聚合统计分析。」之后加入一条：

```ts
            '广告服务商（Google AdSense 及其合作的广告技术供应商）用于广告投放与效果衡量。',
```

- [ ] **Step 5: 英文版插入对应章节并顺延编号**

```ts
        {
          heading: '5. Third-Party Advertising and Consent Management',
          paragraphs: [
            'This site is funded by third-party advertising, including Google AdSense. This section explains how advertising-related data is handled.',
          ],
          bullets: [
            'Google, as a third-party vendor, uses cookies (including the DoubleClick DART cookie) to serve ads on this site.',
            'Google and its third-party vendors and ad networks may use cookies, web beacons and similar technologies to collect non-personally-identifying information such as your IP address, browser type, time of visit, pages viewed and click behaviour, in order to measure and serve relevant ads.',
            'Google may show you personalised ads based on your prior visits to this and other websites.',
            'You can opt out of personalised advertising through Google Ad Settings at https://myadcenter.google.com, or manage vendor advertising cookies at https://www.aboutads.info/choices and https://optout.networkadvertising.org.',
            'You may also disable third-party cookies in your browser. Doing so does not affect your ability to read content on this site, but may reduce ad relevance.',
            'If you are located in the European Economic Area, the United Kingdom or Switzerland, we ask for your consent to cookies and personalised advertising through a Google-certified Consent Management Platform (CMP) compliant with the IAB TCF standard before ads are shown, and you can withdraw or change your choice at any time via the consent settings entry point on the page.',
            'We never share your email address, display name or submitted content with advertising vendors for ad targeting.',
          ],
        },
```

英文 privacy 原第 5–10 节编号同样依次改为 6–11，并在改为 `6.` 的信息共享节中，于 Google Analytics 那条之后加入：

```ts
            'Advertising providers (Google AdSense and its partner ad technology vendors) for ad serving and measurement.',
```

- [ ] **Step 6: 日文版插入对应章节并顺延编号**

```ts
        {
          heading: '5. 第三者配信の広告と同意管理',
          paragraphs: [
            '当サイトは Google AdSense を含む第三者配信の広告によって運営費をまかなっています。本節では広告に関するデータの取り扱いについて説明します。',
          ],
          bullets: [
            'Google は第三者配信事業者として、Cookie（DoubleClick DART Cookie を含む）を使用して当サイトに広告を配信します。',
            'Google および提携する第三者配信事業者・広告ネットワークは、Cookie、ウェブビーコンおよび類似の技術を使用して、IP アドレス、ブラウザの種類、アクセス日時、閲覧ページ、クリック行動などの個人を直接特定しない情報を収集し、広告効果の測定と関連性の高い広告の配信に利用することがあります。',
            'Google は、当サイトおよび他のサイトへの過去のアクセス履歴に基づいて、パーソナライズド広告を表示する場合があります。',
            'パーソナライズド広告は Google 広告設定（https://myadcenter.google.com）から無効にできます。また https://www.aboutads.info/choices または https://optout.networkadvertising.org から参加事業者の広告 Cookie をまとめて管理できます。',
            'ブラウザ側で第三者 Cookie を無効にすることもできます。その場合でもサイト内のコンテンツの閲覧に影響はありませんが、広告の関連性は低下する可能性があります。',
            '欧州経済領域、英国またはスイスにお住まいの方には、広告の表示前に、IAB TCF 準拠の Google 認定同意管理プラットフォーム（CMP）を通じて Cookie とパーソナライズド広告への同意を確認します。同意はページ上の同意設定からいつでも撤回・変更できます。',
            'メールアドレス、アカウント名、投稿内容を広告配信事業者にターゲティング目的で提供することはありません。',
          ],
        },
```

日文 privacy 原第 5–10 节编号同样依次改为 6–11，并在改为 `6.` 的情報共有节中，于 Google Analytics 那条之后加入：

```ts
            '広告配信事業者（Google AdSense および提携する広告技術ベンダー）— 広告の配信と効果測定のため。',
```

- [ ] **Step 7: 更新三语 privacy 的 `updatedDate`**

三处 `updatedDate: '2026-02-07'` 全部改为 `updatedDate: '2026-08-04'`（`effectiveDate` 保持不变）。

- [ ] **Step 8: 运行测试确认通过**

```bash
npx vitest run tests/legal/privacy-advertising.test.ts
```

预期：全部 PASS，包括编号连续性检查。

- [ ] **Step 9: 提交**

```bash
git add lib/legal/content.ts tests/legal/privacy-advertising.test.ts && git commit -m "feat(legal): disclose Google AdSense cookies and consent management in privacy policy"
```

---

### Task 6：用户协议补版权与下架条款（ADS-PUB-02 缓释）

**Files:**
- Modify: `lib/legal/content.ts`（三语 `terms`）

- [ ] **Step 1: 阅读现有 terms 结构**

```bash
grep -n "terms:" -A 4 lib/legal/content.ts
```

记下三语 terms 各自的章节编号范围，新章节追加到「知识产权」相关章节之后（若无，则追加到倒数第二节之前），并顺延后续编号。

- [ ] **Step 2: 中文 terms 插入新章节**

```ts
        {
          heading: 'N. 版权引用与下架申请',
          paragraphs: [
            '本站攻略采用动画画面与实景照片对照的表达形式。站内出现的动画截图版权归各自著作权人所有，本站仅在场景对照、说明与评论的必要范围内引用，不进行独立售卖或再分发；实景照片版权归拍摄者所有。',
          ],
          bullets: [
            '若你是相关内容的著作权人或其授权代理人，认为站内引用超出合理范围，可通过本页联系邮箱提交下架或更正申请。',
            '申请请注明：涉及的作品与具体画面、页面链接、权利证明或授权关系说明、以及希望的处理方式（补充署名 / 替换 / 下架）。',
            '我们会在收到完整信息后 7 个工作日内回复；处理期间可先行隐藏争议内容。',
            '用户投稿的图片须为本人拍摄或已获授权。上传即表示你确认拥有相应权利，并授权本站在站内展示。',
          ],
        },
```

（`N.` 替换为实际顺序号，并把其后所有章节编号顺延。）

- [ ] **Step 3: 英文与日文 terms 插入等价章节**

标题分别为 `N. Copyright Quotation and Takedown Requests` 与 `N. 著作権の引用と削除依頼`，内容为 Step 2 的完整对照翻译（段落 1 段 + 要点 4 条，一一对应），编号同样顺延。

- [ ] **Step 4: 三语 terms 的 `updatedDate` 改为 `'2026-08-04'`**

- [ ] **Step 5: 扩展编号连续性测试覆盖 terms**

在 `tests/legal/privacy-advertising.test.ts` 中追加：

```ts
it.each(LOCALES)('%s terms sections are sequentially numbered and include takedown policy', (locale) => {
  const doc = getLegalDocument('terms', locale)
  const numbers = doc.sections.map((s) => Number(s.heading.match(/^(\d+)\./)?.[1]))
  expect(numbers).toEqual(numbers.map((_, i) => i + 1))
  expect(JSON.stringify(doc)).toMatch(/下架|takedown|削除依頼/i)
})
```

- [ ] **Step 6: 运行测试并提交**

```bash
npx vitest run tests/legal/privacy-advertising.test.ts && git add lib/legal/content.ts tests/legal/privacy-advertising.test.ts && git commit -m "feat(legal): add copyright quotation and takedown policy to terms"
```

---

### Task 7：文章页挂载版权声明区块（ADS-PUB-02 缓释）

**Files:**
- Create: `components/legal/CopyrightNotice.tsx`
- Modify: 文章正文渲染组件（Step 1 中定位）
- Test: `tests/components/copyright-notice.test.tsx`

- [ ] **Step 1: 定位文章正文的渲染组件**

```bash
grep -rn "posts/\[slug\]" app --include=page.tsx | head; ls components/post components/article 2>/dev/null
```

找到文章正文渲染后、评论区之前的插入点，记录确切文件与行号。

- [ ] **Step 2: 写失败测试**

```tsx
// tests/components/copyright-notice.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CopyrightNotice from '@/components/legal/CopyrightNotice'

describe('CopyrightNotice', () => {
  it('renders attribution text and contact link for zh', () => {
    render(<CopyrightNotice locale="zh" />)
    expect(screen.getByText(/著作权人/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /版权|联系/ })).toBeTruthy()
  })

  it('renders English attribution for en', () => {
    render(<CopyrightNotice locale="en" />)
    expect(screen.getByText(/copyright holders/i)).toBeTruthy()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npx vitest run tests/components/copyright-notice.test.tsx
```

预期：FAIL，`Cannot find module '@/components/legal/CopyrightNotice'`。

- [ ] **Step 4: 实现组件**

```tsx
// components/legal/CopyrightNotice.tsx
import Link from 'next/link'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { prefixPath } from '@/components/layout/prefixPath'

const TEXT: Record<SiteLocale, { body: string; linkLabel: string }> = {
  zh: {
    body: '本文中的动画画面版权归各自著作权人所有，仅在场景对照与说明的必要范围内引用；实景照片版权归拍摄者所有。',
    linkLabel: '版权与下架申请',
  },
  en: {
    body: 'Anime frames in this article remain the property of their respective copyright holders and are quoted only as needed for scene comparison and commentary. Photographs remain the property of the photographer.',
    linkLabel: 'Copyright and takedown requests',
  },
  ja: {
    body: '本記事中のアニメ画面の著作権はそれぞれの権利者に帰属し、場面の対比と解説に必要な範囲で引用しています。実景写真の著作権は撮影者に帰属します。',
    linkLabel: '著作権と削除依頼',
  },
}

export default function CopyrightNotice({ locale = 'zh' }: { locale?: SiteLocale }) {
  const text = TEXT[locale]
  return (
    <aside className="mt-12 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs leading-6 text-gray-500">
      <p>{text.body}</p>
      <Link href={prefixPath('/help', locale)} prefetch={false} className="mt-1 inline-block text-brand-600 hover:underline">
        {text.linkLabel}
      </Link>
    </aside>
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/components/copyright-notice.test.tsx
```

预期：PASS。

- [ ] **Step 6: 挂载到 Step 1 定位的插入点**

在文章正文之后、评论区之前插入 `<CopyrightNotice locale={locale} />`，`locale` 从该组件已有的 props 或路由上下文取得（不要新增 `useEffect` 或客户端逻辑）。

- [ ] **Step 7: 全量测试并提交**

```bash
npm test && git add components/legal/CopyrightNotice.tsx tests/components/copyright-notice.test.tsx && git commit -m "feat(post): add image copyright attribution notice to articles"
```

---

## Phase 2：URL 稳定性与爬虫可达性（申请前必做）

### Task 8：中间件三处修复（ADS-CRAWL-04 + Phase 0.4 新发现）

**Files:**
- Modify: `middleware.ts:11,101-135`
- Test: `tests/middleware/i18n-redirect.test.ts`

**三条改动及其理由：**

1. **爬虫 UA 白名单**——`BOT_PATTERN` 增加 `mediapartners|adsbot|google-inspectiontool|google-extended|chrome-lighthouse`。直接原因是 Phase 0.4 实测 `Mediapartners-Google` 被 307。
2. **显式语言前缀不再改写**——删掉 `middleware.ts:129-132` 的 `else` 分支，明确前缀的请求一律 `next()`。这是 URL 稳定性的核心修复。
3. **地域跳转收窄到首页**——只有访问 `/`（无前缀根路径）时才按 IP 分流。深层 zh 路径（`/posts/x`、`/anime/y`）保持稳定，任何人拿到链接看到的都是同一个页面。语言切换器与 `NEXT_LOCALE` Cookie 仍然完整可用，用户体验不降级。

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/middleware/i18n-redirect.test.ts
describe('URL stability for AdSense', () => {
  it('never rewrites an explicit /en path based on IP country', () => {
    const req = createRequest('/en/anime', { country: 'JP' })
    const res = middleware(req)
    expect(res.status).not.toBe(307)
  })

  it('never rewrites an explicit /ja path based on IP country', () => {
    const req = createRequest('/ja/anime', { country: 'US' })
    const res = middleware(req)
    expect(res.status).not.toBe(307)
  })

  it('keeps deep zh paths stable regardless of country', () => {
    const req = createRequest('/posts/some-guide', { country: 'JP' })
    const res = middleware(req)
    expect(res.status).not.toBe(307)
  })

  it('still redirects the bare homepage by country', () => {
    const req = createRequest('/', { country: 'JP' })
    const res = middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/ja')
  })

  it.each([
    'Mediapartners-Google',
    'Mozilla/5.0 (compatible; AdsBot-Google; +http://www.google.com/adsbot.html)',
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ])('never redirects Google crawler UA: %s', (userAgent) => {
    const req = createRequest('/', { country: 'JP', userAgent })
    const res = middleware(req)
    expect(res.status).not.toBe(307)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/middleware/i18n-redirect.test.ts
```

预期：新增用例中，前三条与 Mediapartners / Google-InspectionTool 两条 FAIL（返回 307）；`still redirects the bare homepage` 与 Googlebot / AdsBot 两条 PASS。

- [ ] **Step 3: 扩充 BOT_PATTERN**

```ts
// middleware.ts:11
const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|externalhit|mediapartners|adsbot|google-inspectiontool|google-extended|chrome-lighthouse/i
```

- [ ] **Step 4: 显式前缀直接放行**

在 `middleware.ts` 第 105 行的 bot 检查**之前**插入：

```ts
  // Explicit locale prefixes are a deliberate choice by the user or crawler.
  // Never rewrite them by IP — the same URL must resolve identically for everyone.
  if (currentLocale !== 'zh') {
    return NextResponse.next({ request: { headers } })
  }
```

- [ ] **Step 5: 地域跳转收窄到首页，并简化跳转分支**

把第 121-134 行替换为：

```ts
  if (targetLocale === 'zh') {
    return NextResponse.next({ request: { headers } })
  }

  // Only the bare homepage participates in geo language routing.
  // Deep links must stay stable so shared URLs and crawlers see one canonical target.
  if (pathname !== '/') {
    return NextResponse.next({ request: { headers } })
  }

  const url = req.nextUrl.clone()
  url.pathname = `/${targetLocale}`
  return NextResponse.redirect(url, 307)
```

至此第 130 行原有的 `pathWithoutLocale` 逻辑已不可达，一并删除。

- [ ] **Step 6: 运行完整中间件测试**

```bash
npx vitest run tests/middleware/i18n-redirect.test.ts
```

预期：全部 PASS。若已有的旧用例断言"深层路径按国家跳转"，说明它编码的是被本任务有意改掉的行为——更新该用例的断言并在提交信息中说明，不要放宽新用例。

- [ ] **Step 7: 提交**

```bash
npm test && git add middleware.ts tests/middleware/i18n-redirect.test.ts && git commit -m "fix(i18n): keep URLs stable across IPs and allow AdSense crawlers"
```

---

### Task 9：统一规范域（ADS-CRAWL-04 第一根因）

**Files:**
- Modify: `lib/seo/site.ts:1`（取决于 Step 1 的决策）
- **Cloudflare 控制台操作（不在代码仓库内）**

**决策点——需要先定：** apex（`seichigo.com`）和 www（`www.seichigo.com`）哪个是规范域？

| 选项 | 操作 | 影响 |
|---|---|---|
| **A. apex 为规范（推荐）** | 在 Cloudflare 控制台**删除或反转**现有的 apex→www Redirect Rule，改为 www→apex 308 | 代码零改动（`PROD_SITE_URL` 已是 apex），sitemap / canonical 全部直接命中终点。已被索引的 www URL 通过 www→apex 收敛 |
| **B. www 为规范** | 保留现有规则，把 `lib/seo/site.ts:1` 的 `PROD_SITE_URL` 改为 `'https://www.seichigo.com'`，或在 Cloudflare Worker 环境变量中设 `SITE_URL=https://www.seichigo.com` | 代码一行改动，但站内所有历史外链、README、社交资料里的 apex 链接仍会多一跳 |

**推荐 A。** 理由：代码、sitemap、JSON-LD、hreflang 全部已经写死 apex，选 A 的改动面最小、回归风险最低；Cloudflare 侧只需改一条规则。

- [ ] **Step 1: 确认决策并定位 Cloudflare 规则**

登录 Cloudflare 控制台 → 选择 `seichigo.com` 区域 → Rules → Redirect Rules（也检查 Bulk Redirects 与 Page Rules），找到把 apex 308 到 www 的那一条。记录规则名与当前配置，改动前截图存档。

- [ ] **Step 2（选项 A）: 反转重定向方向**

把规则的匹配条件改为 `hostname eq "www.seichigo.com"`，目标改为 `https://seichigo.com${uri}`，状态码保持 301/308。

- [ ] **Step 3: 实测验证**

```bash
echo "=== apex（应 200）==="; curl -sI -A "Mozilla/5.0" https://seichigo.com/en/anime | head -2
echo "=== www（应 301/308 → apex）==="; curl -sI -A "Mozilla/5.0" https://www.seichigo.com/en/anime | head -3
echo "=== Mediapartners（应 200）==="; curl -sI -A "Mediapartners-Google" https://seichigo.com/en/anime | head -2
```

预期：apex 直接 `200`；www 返回 `301`/`308` 且 `location` 指向 apex；Mediapartners 在 apex 上 `200`。

- [ ] **Step 4: 抽样验证 sitemap 无重定向**

```bash
curl -s https://seichigo.com/sitemap.xml | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' | head -20 | while read -r u; do printf '%-60s ' "${u:0:58}"; curl -s -o /dev/null -w '%{http_code}\n' -A "Mozilla/5.0" "$u"; done
```

预期：抽样的 20 条全部 `200`，无 `3xx`。

- [ ] **Step 5: 若选了 B，改代码并提交**

```ts
// lib/seo/site.ts:1
const PROD_SITE_URL = 'https://www.seichigo.com'
```

```bash
npm test && git add lib/seo/site.ts && git commit -m "fix(seo): align canonical origin with the final host"
```

- [ ] **Step 6: 记录决策**

在 `docs/adsense/` 下记一份短说明：选了哪个方案、Cloudflare 规则改了什么、改动日期。这条规则不在仓库里，没有文档就没有人知道它存在。

---

### Task 10：Phase 1–2 上线与线上复验

- [ ] **Step 1: 部署前检查（强制）**

按 `seichigo-predeploy-guard` 约定执行部署前检查，确认所有改动已推送到 origin。

- [ ] **Step 2: 部署**

```bash
npm run cf:deploy
```

- [ ] **Step 3: 部署后记账**

按 `seichigo-deploy-ledger` 约定打 `deploy/<ISO>` 标签。

- [ ] **Step 4: 线上全量复验**

```bash
BASE=https://seichigo.com
echo "--- 新页面 ---"
for p in /help /en/help /ja/help /status /en/status /ja/status; do printf '%-14s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' -A "Mozilla/5.0" "$BASE$p"; done
echo "--- URL 稳定性（同一 URL 不同 UA 应同码）---"
for ua in "Mozilla/5.0" "Mediapartners-Google" "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)"; do printf '%-30s ' "${ua:0:28}"; curl -s -o /dev/null -w '%{http_code}\n' -A "$ua" "$BASE/en/anime"; done
echo "--- 隐私政策广告条款 ---"
for p in /privacy /en/privacy /ja/privacy; do printf '%-14s ' "$p"; curl -s -A "Mozilla/5.0" "$BASE$p" | grep -c "myadcenter.google.com"; done
```

预期：新页面全部 `200` 且非空；`/en/anime` 在三个 UA 下都是 `200`；三语隐私政策的 `myadcenter.google.com` 匹配数 ≥ 1。

- [ ] **Step 5: 页脚死链人工复核**

在浏览器中打开 `/`、`/en`、`/ja`，点击页脚「帮助中心 / Help Center / ヘルプセンター」与「系统状态 / System Status / システムステータス」，确认六个链接都进入对应语言的真实页面，无 `#` 停留。

---

## Phase 3：提交申请

### Task 11：核对 7 个 Unknown 项（需站主本人确认，无法由代码验证）

- [ ] 年龄 ≥ 18（ADS-ELIG-01）。未成年需使用监护人账户。
- [ ] 是否已有 AdSense 账户（ADS-ELIG-02）。**若有旧账户，必须在旧账户内添加站点，重复开户会导致封禁。**
- [ ] 无自点击历史（ADS-PROG-01）。
- [ ] 流量来源合规（ADS-PROG-04）：无买量、无互点、无垃圾引流。
- [ ] 账户与站点映射准确（ADS-PUB-09）。
- [ ] 开户表单中**不要**勾选"面向儿童"（ADS-PRIV-06）。本站不是儿童导向站点，误勾会永久限制个性化广告。
- [ ] 确认将要接入的收款信息与实名一致。

### Task 12：添加站点并验证

- [ ] **Step 1: 在 AdSense 后台添加站点**

站点填 Task 9 确定的规范域（推荐 `seichigo.com`）。

- [ ] **Step 2: 部署验证代码**

AdSense 会给出一段验证代码。落点为 `app/layout.tsx` 的 `<head>`——注意当前 root layout 没有显式 `<head>` 标签，使用 Next 的 `Script` 组件（照抄第 66-79 行 GA 的写法，`strategy="beforeInteractive"`），或用 `metadata.other` 输出 meta 标签。**不要**手写 `<head>` 元素。

- [ ] **Step 3: 走一遍 Phase 2 的部署与复验流程，确认验证代码在三语页面的 SSR HTML 中都存在**

```bash
for p in / /en /ja; do printf '%-6s ' "$p"; curl -s -A "Mozilla/5.0" "https://seichigo.com$p" | grep -c "google-adsense-account\|adsbygoogle"; done
```

- [ ] **Step 4: 在 AdSense 后台点击验证并提交审核**

---

## Phase 4：审核等待期并行（不阻塞申请）

### Task 13：评论审核与举报机制（ADS-CONTENT-07 Medium）

**Files:**
- Modify: `prisma/schema.prisma:367`
- Modify: `lib/comment/handlers/comments.ts`
- Create: 举报 API route、举报按钮组件、后台评论管理页

**最小可行范围（不要扩大）：**

1. `Comment` 增加 `status String @default("visible")`（取值 `visible` / `hidden`）与 `hiddenAt DateTime?`、`hiddenBy String?`。默认 `visible` 保证现有评论行为不变。
2. `comments.ts` 的 `list` 只返回 `status = 'visible'` 的评论。
3. 新增 `CommentReport` 模型（`id`、`commentId`、`reporterId`、`reason`、`createdAt`、`@@unique([commentId, reporterId])` 防重复举报）。
4. 评论 UI 加举报按钮，调用新的举报 API（需登录）。
5. 复用已有 `/admin` 后台，新增评论列表页：可查看被举报评论、隐藏 / 恢复 / 删除。

**执行顺序：** 先写 handler 层测试（`tests/comment/` 已有目录），再改 schema，再改 handler，最后做 UI。迁移用 `npm run db:migrate:dev -- --name comment_moderation`。

### Task 14：ja/en 页面残留中文字符串（ADS-CONTENT-06 Medium，用户可见价值最高）

- [ ] **Step 1: 扫描残留**

```bash
npm run i18n:coverage
```

- [ ] **Step 2: 定位硬编码中文**

审计报告点名了「用时」「顺序 地点 最近站」等地点表表头。这些多半是组件里硬编码的字符串而非 i18n 键。

```bash
grep -rn "[一-龥]" components features --include=*.tsx | grep -v "locale ===" | grep -v "zh:" | head -40
```

- [ ] **Step 3: 逐个迁移到 `lib/i18n/locales/*.json`**，三语补齐，用 `t(key, locale)` 取值。

- [ ] **Step 4: 线上抽查**

```bash
for p in /en/anime/yuru-camp /ja/anime/yuru-camp; do printf '%-26s 中文字符数: ' "$p"; curl -s -A "Mozilla/5.0" "https://seichigo.com$p" | grep -o "[一-龥]" | wc -l; done
```

英文页应趋近 0；日文页会因汉字命中该范围，需人工目检 UI 标签而非计数。

### Task 15：SSR `<html lang>` 正确化（ADS-CONTENT-06 剩余部分，优先级最低）

**现状：** `app/layout.tsx:63` 硬编码 `lang="zh"`，靠 `components/i18n/HtmlLangSync.tsx` 在客户端 `useEffect` 里改正。SSR HTML 里 ja/en 页面的 lang 属性是错的。

**三个方案的权衡：**

| 方案 | 做法 | 代价 | 结论 |
|---|---|---|---|
| 读 `headers()` | root layout 里读中间件已注入的 `x-seichigo-locale`（`middleware.ts:74`） | **整棵树变 dynamic，`force-static` 全部失效**，TTFB 已经 2.8–6s，不能再退化 | ❌ 否决 |
| 多 root layout | 用 route group 让 `app/(zh)` / `app/(en)` / `app/(ja)` 各有一个输出 `<html>` 的 root layout | 需要把 `app/en`、`app/ja` 整体迁到新 route group，共享部分抽成 `components/layout/RootHtml.tsx`。改动面大、回归风险高 | ⚠️ 正解但成本高 |
| 维持现状 | 保留 `HtmlLangSync` 客户端同步 | SSR HTML lang 仍不准 | ✅ 暂时接受 |

**建议：** 暂不改。`<html lang>` 对 AdSense 审核是弱信号（内容语言与 hreflang 才是主信号，两者本站都正确），而重构 root layout 的回归风险远大于收益。**把 Task 14 做完就够了**。若未来要做 `[locale]` 动态段重构，把这一项并进去顺手解决，不要为它单独开一次重构。

---

## Phase 5：获批之后

### Task 16：发布 ads.txt（ADS-TXT-02）

- [ ] **Step 1: 创建文件**

```
# public/ads.txt
google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
```

`pub-XXXXXXXXXXXXXXXX` 替换为 AdSense 后台的真实发布商 ID。

- [ ] **Step 2: 确认可访问**

`middleware.ts:139` 的 matcher 用 `.*\..*` 排除了带点的路径，`/ads.txt` 会被正确排除、不进中间件。部署后验证：

```bash
curl -s https://seichigo.com/ads.txt
```

预期：输出上述内容，且 `Content-Type` 为 `text/plain`。

- [ ] **Step 3: 在 AdSense 后台确认 ads.txt 状态转为「已找到」**（可能需要 24 小时）

### Task 17：启用 Google CMP（ADS-PRIV-04）

- [ ] AdSense 后台 → 隐私和消息 → 启用 GDPR 消息（Google 认证 CMP，支持 TCF v2.2）。
- [ ] 同时启用 CCPA 消息。
- [ ] 消息中的隐私政策链接指向 `https://seichigo.com/privacy`。
- [ ] 用 EEA IP（VPN）实测同意横幅出现，且拒绝后不投放个性化广告。
- [ ] 确认页面上存在同意设置的重新打开入口——Phase 1 的隐私政策已经写了"可随时通过页面上的同意设置入口撤回"，这句话必须为真。

### Task 18：广告位规范（ADS-PUB-11 / ADS-CONTENT-03 / ADS-CONTENT-05 预防）

新建 `docs/adsense/ad-placement.md`，把下列规范写死，避免后续踩政策线：

- [ ] **禁止投放的页面**：`/anime`、`/city` 索引页（正文约 700–900 字符，属"内容过薄"），`/map` 地图工具页（广告会遮挡交互），`/auth/*`、`/admin/*`、`/me/*`、`/submit`。
- [ ] **允许投放**：`/posts/[slug]` 文章详情页（正文约 1.5 万字符）、首页、`/resources/*`。
- [ ] **位置约束**：不放在导航栏与面包屑相邻处；不放在文章内地点表与导航按钮的相邻位置（避免误点）；首屏广告不超过 1 个。
- [ ] **标注**：使用中性的"广告 / Advertisement / 広告"，禁止"推荐""赞助内容""点击支持我们"等引导性表述（ADS-PROG-02/03）。
- [ ] **上线后自查**：用真实手机在 3G 限速下打开一篇文章，确认广告不遮挡正文、不引发布局跳动。

### Task 19：截图使用运营规范（ADS-PUB-02 长期缓释）

新建 `docs/adsense/content-policy.md`：

- [ ] 单篇文章中动画截图数量不超过实拍照片数量。
- [ ] 每张动画截图必须与一张对应的实景照片成对出现（对照是引用的正当性来源）。
- [ ] 禁止发布纯截图集、无文字说明的图集。
- [ ] 不使用高清完整帧的连续序列（避免构成对作品的实质性替代）。
- [ ] 投稿审核环节把上述规则加进审核清单。

---

## 决策与风险登记

| 项 | 决策 | 理由 |
|---|---|---|
| 页脚死链 | **恢复为真实页面**，不删除 | 用户明确要求；且 `/help` 同时满足 ADS-UX-05 支持页面、ADS-PUB-02 版权通道两项要求，一次投入解决三个问题 |
| 状态页形态 | 手工维护 + 明确标注，不做假实时面板 | 永远显示"全部正常"的假仪表盘本身构成误导性内容，是政策风险而非加分项 |
| CMP 时序 | 移到 Phase 5，不阻塞申请 | Google CMP 必须在 AdSense 后台开启，申请前没有账户无法启用；且审核期站点无任何广告 Cookie |
| 规范域 | 推荐 apex，反转 Cloudflare 规则 | 代码已全量写死 apex，改动面与回归风险最小 |
| 地域跳转 | 收窄到首页 `/` | 深链稳定是硬要求；首页分流保留首访体验，`NEXT_LOCALE` Cookie 与语言切换器不受影响 |
| `<html lang>` | 暂不重构 | 多 root layout 重构的回归风险大于收益；这是弱信号，内容语言与 hreflang 已正确 |
| 评论审核 | 默认 visible + 举报 + 后台隐藏 | 先审后发会显著降低社区活跃度，且本站评论量小、需登录，事后审核足够 |

**风险登记：**

1. **Cloudflare 规则改动不在版本控制内。** 反转 apex/www 重定向若配错会导致全站不可达。改动前截图存档，改后立刻按 Task 9 Step 3 实测，出问题可立即回滚。
2. **重定向方向变更会短期影响索引。** Search Console 中可能出现"网页会重定向"提示波动，属预期，1–2 周收敛。改动后提交一次 sitemap 重新抓取。
3. **中间件改动会改变现有用户体验。** 日本用户访问 `/posts/x`（中文）不再自动跳日文版。这是有意为之（URL 稳定性 > 自动分流），但需确认页面上的语言切换器足够显眼。
4. **`npm run check:line-budget`** 会在 `npm test` 前先跑。新增文件若超预算，更新 `line-budget.allowlist.json` 而不是删内容。
5. **`lib/legal/content.ts` 目前 576 行**，Task 5 与 Task 6 会显著增加。若触发行数预算，考虑把 `terms` 拆到 `lib/legal/terms.ts`——但这属于 Task 5/6 之外的改动，单独提交。

---

## 完成标准

**可以提交 AdSense 申请的判定条件（全部为真）：**

- [ ] `/help`、`/status` 三语共 6 个页面线上返回 200 且内容非空
- [ ] 页脚零 `href="#"`，六个新链接均可点达
- [ ] 三语隐私政策含 AdSense、Cookie/信标、`myadcenter.google.com` 退出链接、CMP 说明
- [ ] 三语用户协议含版权引用与下架申请章节
- [ ] 文章页底部显示版权声明区块
- [ ] `https://seichigo.com/en/anime` 在普通 UA、`Mediapartners-Google`、`Google-InspectionTool` 三种 UA 下均返回 200
- [ ] sitemap 抽样 20 条 URL 全部直接 200，无 3xx
- [ ] `npm test` 与 `npm run typecheck` 全绿
- [ ] Task 11 的 7 项站主确认全部完成
