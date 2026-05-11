<div align="center">
  <a href="https://seichigo.com">
    <img src="public/brand/web-logo-256.png" alt="SeichiGo" width="128" height="128" />
  </a>

  <h1>SeichiGo · 圣地 GO</h1>

  <p>
    <strong>An anime-pilgrimage content platform. Read deep guides, see exact spots on a map, take the route with you.</strong>
  </p>
  <p>
    <strong>面向动漫圣地巡礼的内容平台 —— 读深度图文攻略，在地图上看准点位，把线路带走。</strong>
  </p>

  <p>
    <a href="https://seichigo.com"><img alt="Live" src="https://img.shields.io/badge/live-seichigo.com-ec4899?style=flat-square" /></a>
    <a href="LICENSE"><img alt="License: PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue?style=flat-square" /></a>
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=nextdotjs" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178c6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="Prisma" src="https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma&logoColor=white" />
    <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" />
    <img alt="MapLibre" src="https://img.shields.io/badge/MapLibre-GL-396cb2?style=flat-square&logo=maplibre&logoColor=white" />
  </p>

  <p>
    <a href="#features--特性"><strong>Features</strong></a> ·
    <a href="#quick-start--快速开始"><strong>Quick start</strong></a> ·
    <a href="docs/architecture.md"><strong>Architecture</strong></a> ·
    <a href="docs/deployment.md"><strong>Deployment</strong></a> ·
    <a href="docs/api.md"><strong>API</strong></a> ·
    <a href="docs/roadmap.md"><strong>Roadmap</strong></a> ·
    <a href="CONTRIBUTING.md"><strong>Contribute</strong></a>
  </p>
</div>

---

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

---

## English

### Why SeichiGo?

Anime pilgrimage — visiting the real-world places that appear in your
favorite shows — is hard to plan well. The information is scattered across
fansites, Twitter threads, and dead blog posts. SeichiGo collects the best
routes into a single, well-crafted reading experience: deep guides per work,
exact point-of-interest data backed by [Anitabi](https://anitabi.cn), and a
map you can hand off to Google Maps in one tap.

> "Help anime fans imagine — and plan — their first pilgrimage with
> long-form writing, gentle visual design, and a useful list of places."
> — from the original product brief

### Features / 特性

| | |
|---|---|
| ✦ Long-form pilgrimage articles | MDX-driven posts (`content/zh/posts/*.mdx`) with `<SpotList />` components, OG images, and JSON-LD. |
| ✦ Map by Anitabi | MapLibre GL with clustering, viewport warmup, per-host policy, and an R2-backed durable image mirror. |
| ✦ In-app navigation | Travel-mode picker (walking / transit / driving) via the official Google Maps Embed API. |
| ✦ Authoring center | `/submit` — TipTap rich-text editor with floating toolbar, autosave, draft/withdraw, and revision flow. |
| ✦ Admin moderation | `/admin/review` for article queue, translation batches, route books, and an ops dashboard. |
| ✦ Multilingual | Locale-aware routing for `zh` / `en` / `ja`, with a Gemini-powered translation queue and glossary builder. |
| ✦ SEO-first | Sitemap, robots, dynamic OG, JSON-LD spoke factory, SEO audit script, SerpAPI-driven rank tracker. |
| ✦ Comments by Giscus | GitHub-Discussions-backed, zero database load. |
| ✦ Code-first / AI-friendly | Everything from migrations to cron lives in the repo; modules ship with scoped `AGENTS.md` knowledge bases. |
| ✦ Observability | Sentry server/edge, Cloudflare Workers observability, internal map-image diagnostics dashboard. |

### Live demo / 在线体验

<https://seichigo.com>

### Quick start / 快速开始

```bash
git clone https://github.com/emptylower/seichigo.git
cd seichigo
npm install
cp .env.example .env.local        # fill in required vars
cp .env.local .env                # Prisma CLI reads .env
npm run db:generate
npm run db:migrate:dev
npm run dev
```

The site runs at <http://localhost:3000>. Sign in via `/auth/signin`
using an email listed in `ADMIN_EMAILS` (default password `112233`,
overridable with `ADMIN_DEFAULT_PASSWORD`); first login forces password
change.

For a local Postgres, see [`CONTRIBUTING.md`](CONTRIBUTING.md#dev-environment).

### Required env vars

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection (pooled, e.g. Neon `-pooler.` host) |
| `DATABASE_URL_UNPOOLED` | Direct URL for Prisma migrations |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | NextAuth basics |
| `ADMIN_EMAILS` | Comma-separated admin allowlist |
| `RESEND_API_KEY` + `EMAIL_FROM` | OTP delivery (or SMTP fallback) |
| `NEXT_PUBLIC_GISCUS_*` | Comment widget config |
| `ANITABI_CRON_SECRET` | Auth for Anitabi cron endpoints |
| `SENTRY_*` | Optional, error reporting |
| Cloudflare bindings (`MAP_IMAGE_CACHE`, `IMAGES`, `ASSETS`) | Set via `wrangler.jsonc` for Workers deploy |

Full list and tuning guidance: [`docs/deployment.md`](docs/deployment.md).

### Tech stack

- **App:** Next.js 15 App Router, React 19, strict TypeScript
- **Styling:** Tailwind CSS (`colors.brand` pink scale), Radix primitives, shadcn-flavored UI
- **Data:** Prisma 6 + Postgres (Neon / Supabase / Vercel Postgres)
- **Auth:** NextAuth v4 (Email OTP + admin credentials)
- **Editor:** TipTap 3 with custom extensions and a hard sanitizer gate
- **Map:** MapLibre GL + Supercluster, R2 image mirror, Cloudflare Images binding
- **Content:** MDX (`content/<lang>/posts/*.mdx`), `next-mdx-remote`
- **Testing:** Vitest (node + jsdom projects), Playwright for e2e
- **Deploy:** OpenNext on Cloudflare Workers (primary), Vercel-compatible build path
- **Observability:** Sentry, Cloudflare observability, internal map-image diag

### Architecture at a glance

```text
app/api/<domain>/route.ts        # thin transport — auth, status, error mapping
  └── lib/<domain>/api.ts        # cached get*ApiDeps()
        └── lib/<domain>/handlers/*.ts   # business logic
              └── lib/<domain>/repo*.ts   # Prisma + in-memory doubles for tests
```

15 domain factories, 79 handler files, repository pattern with memory doubles.
The map is a single mega-hook orchestrator (`features/map/`) passing scoped
state to specialized rendering hooks; see
[`docs/architecture.md`](docs/architecture.md) for the full diagram.

### Repository layout

```text
seichigo/
├── app/                  # App Router pages + API route wrappers
├── features/             # Heavy client modules (map mega-hook lives here)
├── components/           # Shared UI (editor, map presentation, etc.)
├── lib/                  # 34 domain modules (handlers, repos, workflows)
├── content/              # Locale MDX content (zh / en / ja)
├── prisma/               # Schema + migrations
├── scripts/              # SEO / i18n / Anitabi tooling
├── tests/                # Vitest suites (node + jsdom split)
├── workers/              # Cloudflare worker entry points (R2 mirror cron, ...)
├── docs/                 # Architecture, deployment, API, roadmap, runbooks
└── AGENTS.md             # Top-level project knowledge base
```

### Deployment

Primary target is **Cloudflare Workers** via OpenNext:

```bash
npm run cf:build      # CLOUDFLARE_DEPLOY=1 opennextjs-cloudflare build + Prisma WASM
npm run cf:preview    # local Workers preview
npm run cf:deploy     # build + opennextjs-cloudflare deploy
```

Bindings live in `wrangler.jsonc`: R2 bucket `seichigo-anitabi-images`,
Cloudflare Images binding, static assets, and observability flags.

Vercel-compatible build path is also supported; daily Anitabi delta, daily
translation pass, and ops daily cron are declared in `vercel.json`.

See [`docs/deployment.md`](docs/deployment.md) for the full runbook,
including the predeploy guard, deploy ledger, and the four-skill repo
governance suite.

### Scripts

```bash
npm run dev                     # local dev
npm run build                   # next build (with Prisma migrate locally)
npm test                        # line-budget + vitest
npm run typecheck               # app + tests
npm run seo:audit -- --base-url https://seichigo.com
npm run anitabi:sync            # manual Anitabi delta sync
npm run i18n:coverage           # i18n key coverage report
npm run glossary:build          # translation glossary build
```

### Contributing / 贡献

Pull requests welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
nearest `AGENTS.md`. For new pilgrimage routes or content corrections,
use the in-app `/submit` flow or the
[content submission issue template](.github/ISSUE_TEMPLATE/content_submission.yml).

By contributing you agree your changes are released under
the [PolyForm Noncommercial 1.0.0](LICENSE) license.

### Security

Please **do not** open public issues for security vulnerabilities.
See [`SECURITY.md`](SECURITY.md) for the responsible-disclosure flow.

### License

Source code is released under
**[PolyForm Noncommercial 1.0.0](LICENSE)**. Personal use, research,
charitable/educational use, and non-commercial hobby projects are
permitted. **Commercial use requires a separate license** — please
contact the maintainer.

Content under `content/**` (articles, route descriptions, photos) may be
covered by separate per-article licenses noted in each file's frontmatter.
When in doubt, ask before redistributing.

---

## 中文

### 我们在做什么

动漫圣地巡礼 —— 去你爱的作品取景的现实地点 —— 一直没人好好做：信息散落
在 fansite、推特串和早已无人维护的旧博客。SeichiGo 把这些线路收拢成一份
精心打磨的阅读体验：单作品的深度图文 + 由
[Anitabi](https://anitabi.cn) 提供的精确点位 + 一键交给 Google Maps。

### 关键特性

- **长文 + MDX 内容系统**：每篇对应单作品/单线路，结构化的 `<SpotList />` 组件
- **Anitabi 地图**：MapLibre + 聚类 + 视口预热 + 按域名调度 + R2 持久镜像
- **站内导航选择器**：通过 Google Maps Embed API 在站内切换步行/交通/驾车
- **作者中心 `/submit`**：TipTap 富文本（飞书风格浮动工具条 + 段首块菜单），自动保存，提交/撤回
- **管理后台 `/admin`**：审稿、翻译批处理、路线本、运营仪表盘
- **多语言**：中/英/日 区域路由，Gemini 翻译队列与术语表
- **SEO 完备**：sitemap、robots、动态 OG、JSON-LD 辐射工厂、审计脚本、SerpAPI 排名追踪
- **Giscus 评论**：基于 GitHub Discussions，无 DB 负担
- **代码即配置**：从迁移到 cron 都在仓库里，模块附带 `AGENTS.md` 知识库
- **可观测**：Sentry、Cloudflare 观测、内部地图图像诊断面板

### 在线体验

<https://seichigo.com>

### 快速开始

```bash
git clone https://github.com/emptylower/seichigo.git
cd seichigo
npm install
cp .env.example .env.local        # 填入必填变量
cp .env.local .env                # Prisma CLI 默认读 .env
npm run db:generate
npm run db:migrate:dev
npm run dev
```

打开 <http://localhost:3000>。在 `/auth/signin` 用 `ADMIN_EMAILS` 中的邮箱
登录（默认密码 `112233`，可用 `ADMIN_DEFAULT_PASSWORD` 覆盖），首次登录会
强制改密。

完整环境变量、部署细节见 [`docs/deployment.md`](docs/deployment.md)。

### 技术栈

- **前端**：Next.js 15 App Router、React 19、严格 TypeScript
- **样式**：Tailwind（`colors.brand` 粉色系）、Radix、shadcn 风组件
- **数据**：Prisma 6 + Postgres（Neon / Supabase / Vercel Postgres）
- **认证**：NextAuth v4（Email OTP + 管理员密码）
- **编辑器**：TipTap 3 + 严格 sanitizer
- **地图**：MapLibre GL + Supercluster + R2 镜像 + Cloudflare Images
- **内容**：MDX (`content/<lang>/posts/*.mdx`) + `next-mdx-remote`
- **测试**：Vitest（node + jsdom 两套）+ Playwright e2e
- **部署**：OpenNext on Cloudflare Workers（主线），保留 Vercel 兼容路径
- **观测**：Sentry + Cloudflare 观测 + 内部诊断

### 文档导航

- [架构总览 / Architecture](docs/architecture.md)
- [部署手册 / Deployment](docs/deployment.md)
- [API 索引 / API](docs/api.md)
- [路线图 / Roadmap](docs/roadmap.md)
- [运行手册 / Runbooks](docs/runbooks/)
- [贡献指南 / Contributing](CONTRIBUTING.md)
- [行为准则 / Code of Conduct](CODE_OF_CONDUCT.md)
- [安全策略 / Security](SECURITY.md)
- [更新日志 / Changelog](CHANGELOG.md)

### 内容与版权

- 源代码：**[PolyForm Noncommercial 1.0.0](LICENSE)**。允许个人、研究、
  教育、非营利与业余使用；**商业使用需另行授权**，请邮件联系维护者。
- 内容（`content/**`）：可能逐篇适用不同 license，详见各文件 frontmatter。

---

<div align="center">
  Made with ☕ and a lot of 路面电車 timetables. <br/>
  Maintained by <a href="https://github.com/emptylower">@emptylower</a>.
</div>
