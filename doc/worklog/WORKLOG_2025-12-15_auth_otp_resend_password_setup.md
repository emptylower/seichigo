# WORKLOG 2025-12-15｜登录体系调整：Resend 邮箱验证码 + 账密登录 + 首次设置密码

## 目标 / 背景
- 将邮件登录从 SMTP/魔法链接切换为 **Resend** 发送的 **邮箱验证码（OTP）**。
- 登录方式统一为两种：
  1) 邮箱验证码登录（适合普通用户投稿/创作）
  2) 账号密码登录（仅管理员邮箱可用，通过 `ADMIN_EMAILS` 判定；不再提供“管理员专用登录模式”）
- 对“已存在但没有密码的账号”增加强制流程：登录后跳转到独立页面设置密码。

## 完成内容
### 1) 邮箱验证码（OTP）系统
- 新增 `EmailOtp` 表存储验证码（不存明文，存 `salt + codeHash`，含过期时间、尝试次数、usedAt 等字段）。
- 新增验证码发送 API：`POST /api/auth/request-code`
  - **同邮箱 60 秒冷却**（按钮显示倒计时）
  - 默认 **10 分钟过期**
  - 发送邮件使用 Resend（配置 `RESEND_API_KEY`），无 Resend/SMPP 时开发环境会在控制台打印邮件内容（便于本地调试）。
- 邮件文案按模板落地（标题 + 正文结构 + `{{CODE}}` 替换）。

### 2) NextAuth 登录方式调整
- 移除 NextAuth Email Provider（魔法链接）。
- 增加 `Credentials` Provider：`id = "email-code"` 用于邮箱验证码登录：
  - 校验 `EmailOtp` 最新未使用且未过期记录
  - 失败会累加 `attempts`，成功则写 `usedAt` 并 `upsert` 用户（补 `emailVerified`）
- 账号密码登录仍通过 `Credentials` Provider（`signIn('credentials')`）：
  - 登录时检查邮箱是否属于 `ADMIN_EMAILS`，仅管理员邮箱允许账密登录
  - 管理员首次登录仍会强制修改默认密码（原逻辑保留）

### 3) 登录页面（现代化 + 粉色主题）
- `/auth/signin` 改为卡片式布局 + Tab 切换：
  - “邮箱登录”：发送验证码按钮显示 **60s 倒计时**（不再单独强调规则）
  - “账号密码”：输入邮箱 + 密码
- UI 对齐项目粉色主题（渐变背景、玻璃拟态卡片、按钮/输入框聚焦态统一）。

### 4) 无密码账号强制设置密码
- 登录后如果检测到当前用户 `passwordHash` 为空，则：
  - `session.user.needsPasswordSetup = true`
  - 站点布局强制跳转到 `/auth/set-password`
- 新增页面 `/auth/set-password` 与 API `POST /api/auth/set-password`
  - 仅对“无密码账号”生效；设置后可用“账号密码”方式（但仍会受管理员邮箱白名单限制）。

## 关键文件
- 验证码与邮件
  - `prisma/schema.prisma`（新增 `EmailOtp`）
  - `prisma/migrations/20251215192000_email_otp/migration.sql`
  - `app/api/auth/request-code/route.ts`
  - `lib/auth/emailOtp.ts`
  - `lib/email/sender.ts`、`lib/email/resend.ts`
  - `lib/email/templates/seichigoOtp.ts`
- 登录与权限
  - `lib/auth/options.ts`（NextAuth providers/session）
  - `app/auth/signin/ui.tsx`（登录页）
  - `app/(site)/layout.tsx`（强制跳转 set-password / change-password）
  - `app/auth/set-password/page.tsx`、`app/auth/set-password/ui.tsx`
  - `app/api/auth/set-password/route.ts`
  - `types/next-auth.d.ts`（session 类型扩展）
- 文档与示例
  - `.env.example`、`README.md`、`doc/STATUS.md`

## 环境变量
- 必填（生产建议）
  - `RESEND_API_KEY`
  - `EMAIL_FROM`（必须使用 Resend 已验证域名的发件地址）
  - `NEXTAUTH_URL`、`NEXTAUTH_SECRET`
  - `DATABASE_URL`
- 可选
  - `EMAIL_OTP_SECRET`（不填默认复用 `NEXTAUTH_SECRET`）
  - `EMAIL_OTP_TTL_MINUTES`（默认 10）
  - `EMAIL_OTP_COOLDOWN_SECONDS`（默认 60）
  - `ADMIN_EMAILS`、`ADMIN_DEFAULT_PASSWORD`

## 迁移与验证
- 已运行并通过：
  - 单测：`npm test`
  - 构建：`npm run build`
- 注意：新增表后需在目标环境执行迁移与 client 生成：
  - `npm run db:migrate:dev && npm run db:generate`

## 后续提醒
- 曾在对话中暴露过 Resend API Key：应在 Resend 控制台 **revoke/rotate**，并仅通过环境变量管理密钥。

