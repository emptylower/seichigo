# SeichiGo 项目现状（MVP）

## 目标
以“动漫圣地巡礼”为主题的内容站（Next.js App Router），支持中文内容发布、作品聚合页、投稿收集、评论（Giscus）与管理员登录（仅管理员使用）。

## 当前已实现
- **站点页面**
  - 首页：最新文章列表（无内容时显示占位）
  - 文章详情：MDX 渲染 + OG Image + Giscus 评论
  - 作品页：作品列表与作品详情（关联相关文章）
  - 作者中心：`/submit`（草稿箱 + 新建/编辑 + 自动保存 + 提交审核/撤回；TipTap 富文本编辑器（飞书风格）：选中/点图浮动工具条（三栏：块样式下拉 / 对齐&缩进下拉 / 文字样式+颜色面板），段首悬浮块菜单（点击左侧 ⋮⋮ 打开，工具条与选中态同款））
  - 管理员审核：`/admin/review`（待审列表 + 详情预览 + 同意/拒绝）
  - 关于页：占位文案
- **内容系统（自研）**
  - 本地 MDX 内容目录：`content/zh/posts/*.mdx`
  - 仅中文已接入，但目录结构预留多语言扩展（以 `content/<lang>/...` 组织）
- **评论（Giscus）**
  - 使用 `@giscus/react`
  - 配置通过环境变量注入（`NEXT_PUBLIC_GISCUS_*`）
- **认证（NextAuth v4 + Prisma）**
  - 已接入邮箱验证码登录（Email OTP）与 Credentials（帐密）Provider
  - **当前优先可用：管理员帐密登录（仅管理员）**
  - 邮箱验证码登录创建的无密码账号，会在登录后强制跳转到 `/auth/set-password` 设置密码
- **数据层**
  - Prisma + Postgres
  - 文章与媒体：`Article` / `Asset`
  - 旧投稿接口（保留）：`Submission`（`/api/submissions`，带简单限流）

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
- **邮件登录（邮箱验证码）**
  - 推荐 Resend：`RESEND_API_KEY` + `EMAIL_FROM`（需使用已验证域名的发件地址）
  - 或使用 SMTP：`EMAIL_SERVER`（或 `EMAIL_SERVER_HOST/PORT/USER/PASSWORD`）
  - 可选配置：
    - `EMAIL_OTP_SECRET`（可不填，默认复用 `NEXTAUTH_SECRET`）
    - `EMAIL_OTP_TTL_MINUTES`（默认 10）
    - `EMAIL_OTP_COOLDOWN_SECONDS`（默认 60）
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
- **邮件登录服务**：建议直接使用 Resend（`RESEND_API_KEY`），避免 SMTP 侧 `535 authentication failed` 等问题。
- **Docker 本地 DB**：当前仓库未内置 `docker-compose.yml`（可按 README 用 `docker run` 启动，或后续补 compose）。
- **作者/审核体验**：富文本编辑器与审核流程已打通，可继续优化交互细节（例如保存状态、错误提示、字段校验等）。
