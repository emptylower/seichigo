# 登录/注册三语：审查后修复（2026-09-22）

前置：`2026-09-22-auth-i18n.md` 已实现，独立审查结论「可合并」，下面是审查提出、需要一并做的项。约束同前：不 commit、不改 middleware 与索引策略、不新增依赖、注释中文。

## F1 `app/api/auth/request-code/route.ts`：非法 locale 不应让发码失败
现在 body 带 `locale: 'fr'` 或 `locale: null` 时，`schema.safeParse` 整体失败，返回 400「邮箱格式不正确」，误导排查。locale 只是展示偏好：schema 改为宽容（如 `z.enum([...]).optional().catch(undefined)`），非法值忽略并按 cookie / Accept-Language 回退。`tests/auth/request-code.test.ts` 里「rejects unsupported body locales」那条改成期望 200 且按 Accept-Language 选模板。

## F2 `app/auth/signin/ui.tsx`：登录按钮不要复用标题 key
两个提交按钮（验证码表单、密码表单）现在用 `auth.signin.title`；新增 `auth.signin.submit`（zh「登录」、en「Sign in」、ja「ログイン」），按钮改用它。

## F3 日文术语统一为「認証コード」
`auth.modal.code` / `auth.modal.codePlaceholder` 的 ja 值目前是「確認コード」「6 桁のコード」，与 `auth.signin.*`、邮件模板的「認証コード」不一致。把 `auth.modal` 的 ja 改成「認証コード」「6桁の認証コード」（只改 ja 值，zh/en 不动）。同步更新相关测试断言（若有写死）。

## F4 `.replace('{error}', errorParam)` 的 `$` 模式
`app/auth/signin/ui.tsx` 里 `errorParam` 来自 URL，`String.replace` 会解释 `$'`、`$&` 等。改成函数形式 `.replace('{error}', () => errorParam)`。全仓 grep 一遍 `.replace('{` 的用法，凡替换值可能来自用户输入的都改成函数形式；数字来源的可不改。

## F5 「设置密码」页三语
`app/auth/set-password/{page,ui}.tsx` 全是硬编码中文，而注册成功后 `callbackUrl` 就是 `/auth/set-password`，三语流程在最后一步断掉。
- 新增字典 `auth.setPassword.*`（标题、说明、字段、按钮、错误/成功提示、metadata），中文原样，英日由你写，语气与 signin/signup 一致。
- 页面用 `getAuthLocale()` 取语言，传给客户端组件，全部文案走 `t()`；`generateMetadata` 三语；canonical 不动。
- `components/layout/prefixPath.ts` 的 `LOCALIZED_EXACT_PATHS` 加 `/auth/set-password`；注册页的 `callbackUrl` 改成带语言前缀的路径（en/ja 加前缀，zh 不加）。确认 middleware 现有的 `/(en|ja)/auth/*` rewrite 覆盖它（正则是 `^/(en|ja)/auth(?:/.*)?$`，应该覆盖，不要改 middleware）。
- 如果 set-password 页还跳转到别的中文页（如成功后回 `/me`），只保证本页三语，不扩散。
- 测试：`tests/auth/pages-locale.test.tsx` 加 set-password 在 en/ja 下的标题断言；`prefixPath.test.ts` 加对应用例；若有 set-password 的旧测试，断言改成 `t()` 取值。

## 不做（记 backlog，别动）
根 layout `<html lang>` 写死 zh；`lib/i18n/getLocale.ts` 与 `getAuthLocale` 合并；字典里 signin/signup 重复键抽 `auth.common`。

## 完成标准
`npm run typecheck`、`npm test` 通过。汇报（简短中文）：每项落点；F4 改了哪些位置；F5 的英日文案原文贴出来。
