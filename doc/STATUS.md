# SeichiGo 项目现状（MVP）

## 目标
以“动漫圣地巡礼”为主题的内容站（Next.js App Router），支持中文内容发布、作品聚合页、投稿收集、评论（Giscus）与管理员登录（仅管理员使用）。

## 当前已实现
- **站点页面**
  - 首页：最新文章列表（无内容时显示占位）
  - 文章详情：MDX 渲染 + OG Image + Giscus 评论
  - 作品页：作品列表与作品详情（关联相关文章）
  - 投稿页：登录后提交投稿内容（写入 DB）
  - 关于页：占位文案
- **内容系统（自研）**
  - 本地 MDX 内容目录：`content/zh/posts/*.mdx`
  - 仅中文已接入，但目录结构预留多语言扩展（以 `content/<lang>/...` 组织）
- **评论（Giscus）**
  - 使用 `@giscus/react`
  - 配置通过环境变量注入（`NEXT_PUBLIC_GISCUS_*`）
- **认证（NextAuth v4 + Prisma）**
  - 已接入 Email Provider（魔法链接）与 Credentials（帐密）Provider
  - **当前优先可用：管理员帐密登录（仅管理员）**
- **数据层**
  - Prisma + Postgres
  - 投稿写入 `Submission` 表
- **基础防滥用（投稿接口）**
  - 按“用户/IP/天”做简单限流（可通过环境变量调整）

## 本地启动（推荐流程）
1. 准备 Postgres（本地 Docker 或其它 Postgres 实例）
2. 配置环境变量（见下方）
3. 安装依赖：`npm install`
4. 生成 Prisma Client：`npm run db:generate`
5. 迁移：`npm run db:migrate:dev`
6. 启动开发：`npm run dev`

## 环境变量（不含敏感值）
> 建议：以 `.env.local` 作为开发配置；Prisma CLI 默认读 `.env`，可在开发时将 `.env.local` 同步到 `.env`（二者均已在 `.gitignore` 中）。

- **站点**
  - `NEXTAUTH_URL`：如 `http://localhost:3000`
  - `NEXTAUTH_SECRET`：随机字符串
- **数据库**
  - `DATABASE_URL`：Postgres 连接串，如 `postgresql://postgres:postgres@localhost:5432/seichigo?schema=public`
- **管理员登录（仅管理员）**
  - `ADMIN_EMAILS`：管理员邮箱白名单，逗号分隔（仅这些邮箱可用帐密登录）
  - `ADMIN_DEFAULT_PASSWORD`：可选，默认 `112233`
- **邮件登录（可选，后续再处理）**
  - `EMAIL_SERVER`（或 `EMAIL_SERVER_HOST/PORT/USER/PASSWORD`）
  - `EMAIL_FROM`
- **Giscus**
  - `NEXT_PUBLIC_GISCUS_REPO`
  - `NEXT_PUBLIC_GISCUS_REPO_ID`
  - `NEXT_PUBLIC_GISCUS_CATEGORY`
  - `NEXT_PUBLIC_GISCUS_CATEGORY_ID`
- **投稿限流**
  - `RATE_LIMIT_USER_PER_DAY`（默认 3）
  - `RATE_LIMIT_IP_PER_DAY`（默认 5）
  - `RATE_LIMIT_SALT`（可选）

## 已知问题 / 待办
- **企业邮箱 SMTP（腾讯企业邮箱）当前认证失败**：NextAuth Email Provider 报 `535 authentication failed`，需要到邮箱侧开启 SMTP/客户端授权码、确认服务器与端口、以及是否需要 SSL/TLS/STARTTLS（后续再排）。
- **Docker 本地 DB**：当前仓库未内置 `docker-compose.yml`（可按 README 用 `docker run` 启动，或后续补 compose）。
- **管理后台**：目前仅有管理员登录与强制改密页，暂无投稿审核/文章管理 UI。

