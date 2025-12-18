# WORKLOG 2025-12-18｜阅读 PRD + 代码库现状盘点（对话总结）

## 本次对话目标
- 阅读 `doc/PRD.md` 了解项目目的与 V1 范围。
- 扫描代码库与现有文档（含 `doc/STATUS.md`、既有 worklog），总结当前实现到什么程度、与 PRD 的差异、下一步关注点。

## 阅读/抽查范围
- PRD：`doc/PRD.md`
- 项目现状：`doc/STATUS.md`、`README.md`
- 代码入口（部分）：
  - 页面：`app/(site)/*`、`app/auth/*`
  - API：`app/api/*`
  - 内容/聚合：`lib/mdx/*`、`lib/posts/*`、`lib/anime/*`
  - 创作/审核：`lib/article/*`、`app/(site)/submit/*`、`app/(site)/admin/*`
  - 安全/富文本：`lib/richtext/sanitize.ts`、`components/editor/RichTextEditor.tsx`
  - 资源上传：`app/api/assets/route.ts`、`app/assets/[id]/route.ts`、`lib/asset/*`
  - SEO：`app/sitemap.ts`、`app/robots.ts`、`app/(site)/posts/[slug]/opengraph-image.tsx`
- 既有工作日志（选择性阅读）：
  - `doc/worklog/WORKLOG_2025-12-14_editor_feishu.md`
  - `doc/worklog/WORKLOG_2025-12-15_auth_otp_resend_password_setup.md`
  - `doc/worklog/WORKLOG_2025-12-17_vercel_neon_deploy_fixes.md`
  - `doc/WORKLOG_2025-12-13.md`

## PRD 要点（项目定位与 V1）
- 一句话定位：用好读的长文、精致排版、实用地点列表，帮助动漫爱好者完成第一次圣地巡礼的想象与规划。
- V1 目标重点：
  - 博客系统（MDX 管理内容、作品聚合）
  - 至少 3–5 篇示例文章跑通体验
  - 基础互动：评论（Giscus）、账号登录（NextAuth）、投稿入口（表单 + 审核）
  - SEO/分享与未来 App 预告
- 非目标：不做复杂 Web 地图、不做行程编辑器/大型社区/复杂后台。

## 当前实现概览（以代码为准）
### 1) 站点结构与页面
- 首页（书城风格的文章陈列）：`app/(site)/page.tsx`
- 文章详情（MDX 或 DB 文章渲染 + Giscus）：`app/(site)/posts/[slug]/page.tsx`
- 作品索引/详情（作品维度聚合文章）：`app/(site)/anime/page.tsx`、`app/(site)/anime/[id]/page.tsx`
- 作者中心（草稿箱/新建/编辑/提交审核/撤回）：`app/(site)/submit/*`
- 管理员审核（待审列表 + 审核详情）：`app/(site)/admin/review/*`
- 管理员面板（待审/已发布 + 下架）：`app/(site)/admin/panel/*`
- 关于页：`app/(site)/about/page.tsx`

### 2) 内容系统：MDX + DB 文章双通道（已聚合）
- MDX 内容：
  - 目录：`content/zh/posts/*.mdx`（当前仅看到模板说明 `content/zh/posts/README.md`，未见示例文章文件）
  - 读取：`lib/mdx/getAllPosts.ts`、`lib/mdx/getPostBySlug.tsx`
  - MDX 组件：`lib/mdx/mdxComponents.tsx`（`<SpotList/>`、`<Callout/>`）
- DB 文章（站内创作发布）：
  - Prisma 模型：`Article`
  - 公共聚合列表：`lib/posts/getAllPublicPosts.ts`（合并 MDX + DB(published) 并按时间排序）
  - 公共详情读取：`lib/posts/getPublicPostBySlug.ts`（优先 MDX，其次 DB；DB 支持 `id-slug` canonical）
  - “文章下架”提示：`lib/posts/getDbArticleForPublicNotice.ts` + `app/(site)/posts/[slug]/page.tsx`

### 3) 创作与审核闭环（DB 驱动上线）
- 状态机（draft/in_review/rejected/published）与权限判断：`lib/article/workflow.ts`
- 文章 CRUD/API（作者侧）：`app/api/articles/*`（实现位于 `lib/article/handlers/*`）
- 作者写作（TipTap 富文本 + 自动保存 + 延迟创建草稿）：`app/(site)/submit/_components/ArticleComposerClient.tsx`
  - 先写正文→自动创建 draft → 自动保存（PATCH）
  - “提交审核”前补充作品/城市/标签等字段
- 管理员审核/发布/拒绝/下架：
  - 列表：`app/api/admin/review/articles/route.ts`
  - 同意发布：`app/api/admin/review/articles/[id]/approve/route.ts`
  - 拒绝（含原因）：`app/api/admin/review/articles/[id]/reject/route.ts`
  - 下架（含原因）：`app/api/admin/review/articles/[id]/unpublish/route.ts`

### 4) 认证登录（NextAuth v4 + Prisma + JWT session）
- NextAuth handler：`app/api/auth/[...nextauth]/route.ts`
- 配置与回调：`lib/auth/options.ts`
  - Session 策略：JWT（兼容 Credentials Provider）
  - Provider：
    - `email-code`：邮箱验证码 OTP（走 `EmailOtp` 表）
    - `credentials`：账号密码（仅管理员邮箱白名单可用）
  - Session 中补充 `isAdmin / mustChangePassword / needsPasswordSetup`
- 站点布局强制跳转：
  - 无密码账号：`/auth/set-password`
  - 管理员首次/强制改密：`/auth/change-password`
  - 逻辑入口：`app/(site)/layout.tsx`

### 5) 评论与 SEO
- Giscus：`components/GiscusComments.tsx`
- Sitemap/Robots：`app/sitemap.ts`、`app/robots.ts`
- 文章 OG 图片：`app/(site)/posts/[slug]/opengraph-image.tsx`

### 6) 富文本安全与媒体
- HTML 净化：`lib/richtext/sanitize.ts`
  - 白名单 tags/attributes
  - `a[href]` 仅允许 http/https/mailto/站内相对路径
  - `img[src]` 仅允许 `http(s)://` 或站内 `/assets/<id>`
  - `span[style]` 限定允许的颜色/背景色/字体族
- 图片上传/读取（存 DB bytes）：
  - 上传：`POST /api/assets`（需登录，限制 image/*，大小受 `ASSET_MAX_BYTES` 控制）
  - 读取：`GET /assets/[id]`（公开缓存）
  - 编辑器使用：`components/editor/RichTextEditor.tsx`（上传图片、粘贴图片、粘贴 URL 自动取预览图）
- Link Preview（抓取网页 `og:image`，带基础 SSRF 防护）：`app/api/link-preview/route.ts`

### 7) 数据模型（Prisma）
见 `prisma/schema.prisma`，核心表：
- `User` + NextAuth `Account/Session/VerificationToken`
- `EmailOtp`（邮箱验证码）
- `Article`（站内创作与发布状态）
- `Anime`（作品元数据，文件 JSON + DB 双来源）
- `Asset`（图片 bytes）
- `Submission`（旧投稿接口保留：`/api/submissions`，带简单限流）

### 8) 测试覆盖
- 已存在较完整的 vitest 测试集合：`tests/*`（覆盖 workflow、API、编辑器交互、公开聚合、邮件发送分支等）。

## 与 PRD 的主要差异/潜在缺口
- PRD 的“内容主路径”偏向 **MDX + Git 管理**；当前实现已形成 **DB 富文本创作→审核→发布** 的主路径，MDX 仍保留但示例内容未落地（仅模板）。
- PRD 提及 GitHub 登录；当前主要是 Email OTP + 管理员账密（可按需要再加 Provider）。
- PRD 的投稿形态是“表单+后台审核”；当前作者中心更像“站内写作平台”（并保留了旧 `Submission` API）。

## 已知注意点（来自现有文档/代码的现实约束）
- 生产环境邮件：需要配置 `RESEND_API_KEY` 或 SMTP，否则会 fail fast（避免“前端显示成功但实际没发出去”）。
- Prisma/Neon：迁移建议使用 `DATABASE_URL_UNPOOLED`（`directUrl`）避免 pooler 影响。

## 下一步建议（需你确认方向）
- 先确认 V1 的内容生产优先级：
  1) 以 DB 富文本为主（站内写作 + 审核 + 即时发布），还是
  2) 以 MDX 为主（Git 写作 + 构建发布），还是
  3) 双轨并行但明确“官方文章/UGC/草稿”的归档规则。
- 如果按 PRD 要求尽快“跑通 3–5 篇文章体验”，可以优先补齐：
  - `content/zh/posts/*.mdx` 的示例文章（至少 3 篇）与作品数据（`content/anime/*.json`）；
  - 或将现有 DB 发布文章作为内容主来源，完善首页/作品页的内容呈现与 SEO 文案。

