# WORKLOG 2025-12-17｜Vercel 部署与 Neon(Postgres) 迁移 + Resend 邮件与草稿创建问题修复

## 目标 / 背景
- 将项目从本地 Docker Postgres 切换到 **Vercel Storage → Neon(Postgres)**（不迁移本地测试数据，只需建表）。
- 解决 Vercel 构建失败与线上运行时问题：
  - Prisma Client 在 Vercel 依赖缓存下未自动生成导致构建失败。
  - Resend 邮件验证码：前端提示“已发送”，但 Resend 控制台无发送记录。
  - 创作中心新建文章在草稿箱中一直停留在“创建中…”，无法保存。

## 完成内容
### 1) 修复 Vercel 构建失败（Prisma Client 未生成）
- 将构建脚本改为在 `next build` 前显式执行 `prisma generate`，避免 Vercel 缓存依赖导致 Prisma Client 过期。

相关文件：
- `package.json`（`build: prisma generate && next build`）

### 2) 适配 Neon / Vercel Postgres（Pooled + Unpooled）
- Prisma datasource 增加 `directUrl = env("DATABASE_URL_UNPOOLED")`：
  - 运行时（API/SSR）使用 `DATABASE_URL`（通常是带 pooler 的连接串）。
  - 迁移/DDL 使用 `DATABASE_URL_UNPOOLED`（直连，避免 pgbouncer/pooler 对事务/DDL 的限制）。
- 同步更新环境变量示例与文档说明。

相关文件：
- `prisma/schema.prisma`
- `.env.example`
- `README.md`
- `doc/STATUS.md`

### 3) 修复 Resend “显示发送成功但实际未发送”
- 根因：邮件发送封装在生产环境缺少 provider 配置时会“DEV 打印并返回成功”，导致 UI 误判为发送成功。
- 处理：生产环境若未配置 `RESEND_API_KEY`（或 SMTP `EMAIL_SERVER*`），直接抛错并返回 502，让问题可见并便于排查。
- 增加单测覆盖该分支。

相关文件：
- `lib/email/sender.ts`
- `lib/email/resend.ts`
- `app/api/auth/request-code/route.ts`
- `tests/email/sender.test.ts`

### 4) 修复新建草稿一直“创建中…”
- 根因：新建草稿的 `useEffect` 依赖包含 `saveState`，在设置为 `creating` 后 effect 重新执行并触发 cleanup 清掉定时器，导致创建请求长期不触发/被取消。
- 处理：
  - 用 `draftCreateInFlight` 的 `useRef` 做“是否在创建中”的幂等保护，避免依赖循环。
  - 为创建/保存请求加 `AbortController` + 超时，避免网络异常时永远卡住。
  - 增加回归测试：输入正文后应触发 `POST /api/articles` 并 `router.replace('/submit/:id')`。

相关文件：
- `app/(site)/submit/_components/ArticleComposerClient.tsx`
- `tests/submit/article-composer.test.tsx`

## 环境变量（Vercel 建议）
> 由 Vercel Storage/Neon 面板自动生成的变量可直接导入；项目最少需要以下几个。

- 数据库（必填）
  - `DATABASE_URL`（pooler/pooled）
  - `DATABASE_URL_UNPOOLED`（direct/unpooled，给 Prisma migrate 用）
- Auth（必填）
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET`
- Resend（生产必填）
  - `RESEND_API_KEY`
  - `EMAIL_FROM`（必须是 Resend 已验证的域名/发件人）

## 验证
- 单测：`npm test`
- 构建：`npm run build`

## 提交记录（按功能）
- `9496b74`：Vercel 构建前生成 Prisma Client（修复构建失败）
- `a807764`：Neon 迁移配置（`directUrl` + 文档/示例）
- `1561cb8`：邮件 provider 未配置时生产环境 fail fast（修复“假发送”）
- `8f77571`：新建草稿卡住“创建中…”修复 + 回归测试

## 部署操作清单（给自己/后续排查）
1. Vercel → Storage 里选择 Neon，连接到项目（勾选 Preview/Production）。
2. Vercel → Environment Variables 填齐上面的变量（注意 Production/Preview 都要有）。
3. 首次建库后执行迁移建表：`npm run db:migrate`（使用 `DATABASE_URL_UNPOOLED`）。
4. 重新部署（触发一次 build），验证：
   - `/auth/signin` 发送验证码后 Resend 控制台有记录
   - `/submit/new` 输入内容后不再卡“创建中…”，会自动生成草稿并跳转到 `/submit/:id`

