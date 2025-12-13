# 02｜登录 UI：让“任何登录用户”可进入创作（保留管理员帐密）

## 目标
当前自定义登录页 `app/auth/signin/ui.tsx` 只有管理员 Credentials 登录表单；为了支持“任何登录用户都可创作”，需要补充 Email 登录入口。

## 约束（基于现有 NextAuth 配置）
- NextAuth providers 已包含：
  - `CredentialsProvider`（管理员帐密）
  - `EmailProvider`（魔法链接）
  - 参见：`lib/auth/options.ts`
- `authOptions.pages.signIn = "/auth/signin"` 已覆盖默认 NextAuth 登录页。

## 交付物
- `/auth/signin` 同时支持：
  - “邮箱登录（Email Provider）”
  - “管理员帐密登录（Credentials Provider）”

## 先写测试（Test First）
1. 新增 `tests/auth/signin-ui.test.tsx`
   - 用例 1：页面存在“邮箱登录”表单（email input + submit）
   - 用例 2：页面存在“管理员登录”表单（email + password）
   - 用例 3：提交邮箱登录时会调用 `signIn("email", { email, redirect: false, callbackUrl })`
   - 用例 4：提交管理员登录时仍调用 `signIn("credentials", ...)`
2. 测试要点
   - mock `next-auth/react` 的 `signIn`
   - mock `next/navigation` 的 `useSearchParams`（保持可控）

## 再实现
1. 修改 `app/auth/signin/ui.tsx`
   - 页面结构：可用 Tab/折叠/分区（不强制）
   - 新增 Email 登录表单：
     - 输入邮箱
     - 点击发送登录链接（`signIn("email", { email, redirect: false, callbackUrl })`）
     - 成功提示：“已发送（开发环境可能会在 server console 输出链接）”
2. 保持管理员逻辑不变：
   - Credentials 登录仍走现有路径
   - 默认密码提示仍保留

## 根据测试结果修正
- 若 `useSearchParams` 在测试环境报错：
  - 在组件层 mock，或把读取 params 的逻辑下沉到更薄的 wrapper

## 验收（独立可测）
- `npm run test` 通过该文件所有用例
- 手动：访问 `/auth/signin` 能看到两种登录方式

