# Step 02｜登录 UI：邮箱登录 + 管理员帐密（已完成）

## 目标
在自定义登录页 `/auth/signin` 同时支持：
- 普通用户：Email Provider（魔法链接）登录
- 管理员：Credentials（帐密）登录（保持原有逻辑）

## 本次完成内容
- 调整页面元信息标题为“登录”（从“管理员登录”调整）
- `app/auth/signin/ui.tsx` 拆分为两段表单：
  - 邮箱登录：调用 `signIn("email", { email, redirect: false, callbackUrl })`
  - 管理员登录：调用 `signIn("credentials", { email, password, redirect: false, callbackUrl })`
- 增加可访问性关联（`label htmlFor` + `input id`），避免测试/可访问性工具无法识别表单控件
- 新增前端测试（测试先行）：
  - 渲染包含两种登录入口
  - 两个表单提交分别调用对应的 `signIn` provider 与参数

## 变更文件
- `app/auth/signin/page.tsx`
- `app/auth/signin/ui.tsx`
- `tests/auth/signin-ui.test.tsx`

## 验收方式（独立可测）
- 自动化：`npm run test`（应包含 `tests/auth/signin-ui.test.tsx` 通过）
- 手动：
  - 打开 `/auth/signin`
  - 邮箱登录：填写邮箱后点击“发送登录链接”（开发环境可能在服务端控制台输出链接；生产需 SMTP）
  - 管理员登录：使用 `ADMIN_EMAILS` 白名单邮箱 + 密码登录（默认 `112233`）

