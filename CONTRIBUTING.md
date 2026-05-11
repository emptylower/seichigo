# Contributing to SeichiGo

[English](#english) · [中文](#中文)

---

## English

Thanks for your interest in SeichiGo — an anime-pilgrimage content platform.
The bar for contributions is "make the codebase and the on-site experience
better than you found them." Everything below exists to make that easier.

### Ground rules

- Be kind. Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues go to <ljj231428@gmail.com>, **not** public issues.
  See [SECURITY.md](SECURITY.md).
- License: contributions are accepted under the
  [PolyForm Noncommercial 1.0.0](LICENSE) license.

### What to work on

- Bugs labelled `good first issue` or `help wanted` on the
  [issue tracker](https://github.com/emptylower/seichigo/issues).
- Documentation gaps in [`docs/`](docs/).
- Content corrections, translations, or new pilgrimage routes —
  see [route submission template](.github/ISSUE_TEMPLATE/content_submission.yml)
  or use the in-app `/submit` flow.
- Items in [`docs/roadmap.md`](docs/roadmap.md) marked **Open**.

### Dev environment

```bash
git clone https://github.com/emptylower/seichigo.git
cd seichigo
npm install
cp .env.example .env.local
# fill in DATABASE_URL, NEXTAUTH_SECRET, RESEND_API_KEY, ADMIN_EMAILS …
npm run db:generate
npm run db:migrate:dev
npm run dev
```

Local Postgres via Docker:

```bash
docker run --name seichigo-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=seichigo \
  -p 5432:5432 \
  -v seichigo_pg:/var/lib/postgresql/data \
  -d postgres:16
```

### Project conventions

Every domain lives under three layers — keep them separated:

```text
app/api/<domain>/route.ts        # thin transport
  └── lib/<domain>/api.ts        # cached get*ApiDeps()
        └── lib/<domain>/handlers/*.ts   # business logic
              └── lib/<domain>/repo*.ts   # data access (Prisma or in-memory)
```

Hard rules:

| Rule | Why |
|------|-----|
| All user-supplied HTML must pass `sanitizeRichTextHtml` | XSS gate |
| Prisma access only via `@/lib/db/prisma` singleton | Connection hygiene |
| No business logic inside `app/api/**/route.ts` | Route is transport only |
| Files cap at **800 lines** — `npm run check:line-budget` | Forces decomposition; allowlist is monotonic |
| Vitest split: `.test.ts` → node, `.test.tsx` → jsdom | See `vitest.config.ts` |
| Use path aliases `@/lib/*`, `@/components/*`, `@/*` | Avoid relative depth |
| Avoid `as any` / `@ts-ignore` | Only two justified instances exist |
| Untrusted URL fetches must use SSRF guard | See `app/api/link-preview/route.ts` |

User-facing API errors follow `{ status, message }` with Chinese copy where
existing endpoints already use Chinese. Match the surrounding style.

### Module knowledge bases

Read the nearest `AGENTS.md` before touching a module — they encode the
project's actually-tried-and-failed lessons:

- `app/api/AGENTS.md` — route wrapper rules
- `app/(authed)/admin/AGENTS.md` — admin / moderation hotspots
- `features/map/AGENTS.md` — mega-hook map architecture
- `components/editor/AGENTS.md` — TipTap & sanitizer alignment
- `components/map/AGENTS.md` — MapLibre layer rules
- `lib/article/AGENTS.md` — article lifecycle
- `lib/anitabi/AGENTS.md` — sync pipeline rules
- `lib/translation/AGENTS.md` — translation queue
- `lib/seo/AGENTS.md` — SEO / JSON-LD / spoke factory
- `lib/auth/AGENTS.md` — auth & admin bootstrap
- `tests/AGENTS.md` — test split & DOM shims

### Commit style

Conventional Commits with a short scope:

```text
feat(map): in-app travel-mode picker via official Maps Embed API
fix(mirror): include user-uploaded point images in R2 mirror scope
perf(map): tile preconnect + warmup-first-view lane
docs(plans): PR3 R2 mirror design spec
config(deploy): enable mirror worker cron
```

Scopes in active use: `map`, `mirror`, `cf`, `prisma`, `image`, `nav`, `diag`,
`auth`, `editor`, `translation`, `seo`, `deploy`, `plans`.

### Testing

```bash
npm test                              # full suite
npx vitest run --project node          # API / handler tests
npx vitest run --project jsdom         # React / DOM tests
npm test -- tests/article              # one folder
npm run typecheck                      # app + tests
```

Prefer deterministic tests using the in-memory repository doubles
(`repoMemory.ts`) over hitting live DB or network.

### Pull requests

1. Open against `main`. Keep the PR focused.
2. Use the PR template; fill out the verification section honestly.
3. CI must be green. Lint is advisory; tests and typecheck are not.
4. For deploys, read [`docs/deployment.md`](docs/deployment.md).
5. A maintainer will review. Be ready to discuss tradeoffs.

### A note on AI-assisted contributions

This codebase is built and operated with heavy AI assistance — that's part of
the design (`code-first, AI-friendly`). Contributions generated with AI are
welcome **if** you:

- Read and understand the diff yourself.
- Run the tests locally.
- Don't paste output that doesn't follow project conventions.

---

## 中文

感谢你对 SeichiGo 的兴趣 —— 一个面向动漫圣地巡礼的内容平台。
我们对贡献的唯一标准是：**让代码与站点比你来之前更好**。下面这些约定都是为
了让这件事更容易。

### 基本规则

- 友善协作。请阅读 [行为准则](CODE_OF_CONDUCT.md)。
- 安全问题请邮件 <ljj231428@gmail.com>，**不要**开公开 issue。详见 [SECURITY.md](SECURITY.md)。
- License：贡献以 [PolyForm Noncommercial 1.0.0](LICENSE) 接受。

### 可以做什么

- [issue 列表](https://github.com/emptylower/seichigo/issues) 中带
  `good first issue` 或 `help wanted` 的缺陷。
- [`docs/`](docs/) 中缺失或过期的文档。
- 内容纠错、翻译、新巡礼线路 —— 见
  [内容投稿模板](.github/ISSUE_TEMPLATE/content_submission.yml) 或站内 `/submit`。
- [`docs/roadmap.md`](docs/roadmap.md) 中标 **Open** 的条目。

### 开发环境

```bash
git clone https://github.com/emptylower/seichigo.git
cd seichigo
npm install
cp .env.example .env.local
# 填入 DATABASE_URL、NEXTAUTH_SECRET、RESEND_API_KEY、ADMIN_EMAILS …
npm run db:generate
npm run db:migrate:dev
npm run dev
```

### 工程约定

API/领域层结构（务必分层）：

```text
app/api/<域>/route.ts          # 仅传输层
  └── lib/<域>/api.ts          # 缓存式 get*ApiDeps()
        └── lib/<域>/handlers/*.ts   # 业务
              └── lib/<域>/repo*.ts   # 数据访问
```

硬性规则：

| 规则 | 原因 |
|------|-----|
| 富文本必须过 `sanitizeRichTextHtml` | XSS 闸门 |
| Prisma 只能通过 `@/lib/db/prisma` 单例 | 连接卫生 |
| `app/api/**/route.ts` 不写业务 | route 只做传输 |
| 单文件 800 行硬上限 (`npm run check:line-budget`) | 强制拆分；allowlist 单调 |
| Vitest 分项目：`.test.ts → node`，`.test.tsx → jsdom` | 见 `vitest.config.ts` |
| 路径别名 `@/lib/*`、`@/components/*` | 避免相对路径深度 |
| 禁用 `as any` / `@ts-ignore` | 全仓库仅 2 处合理例外 |
| 外部 URL fetch 必须 SSRF 防护 | 参考 `app/api/link-preview/route.ts` |

### Commit 格式

Conventional Commits，作用域具体：

```text
feat(map): 描述
fix(mirror): 描述
perf(map): 描述
docs(plans): 描述
config(deploy): 描述
```

### 测试

```bash
npm test
npx vitest run --project node
npx vitest run --project jsdom
npm test -- tests/article
npm run typecheck
```

优先使用 `repoMemory.ts` 内存仓做确定性测试，不要打真实 DB / 网络。

### Pull Request

1. 基于 `main` 开 PR，保持聚焦。
2. 使用 PR 模板，如实填写验证项。
3. CI 必须绿。lint 是建议项，但 test/typecheck 不是。
4. 涉及部署改动，请先读 [`docs/deployment.md`](docs/deployment.md)。
5. 维护者会评审，欢迎讨论权衡。
