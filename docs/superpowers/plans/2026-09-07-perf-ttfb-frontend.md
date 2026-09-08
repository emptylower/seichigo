# 2026-09-07 首页性能修复 · 前端部分

## 背景

PageSpeed 移动端首页 81 分。主因（TTFB / Worker 冷启动）由另一份任务在并行处理，本任务只处理客户端侧两项次要问题。移动端网络瀑布图中观察到：

- 匿名访客打开首页，客户端在 JS 加载后立刻发出 `/api/auth/session`（next-auth `SessionProvider` 初始化）和 `/api/me/usage`（`hooks/useUsage.ts`），两个请求在 4G 模拟下各耗约 1.8 s，与 LCP 图片抢带宽。
- 同时预取了 `/plan/start`、`/map`、`/posts` 三个 RSC payload（首页 `<Link>` 进入视口时的默认 prefetch）。
- 展示区缩略图 `public/images/showcase/*.jpg`（62 张，320×240）实际渲染尺寸远小于图片尺寸，Lighthouse 估算可省约 120 KiB。

技术栈：Next 15 App Router、next-auth v4（`components/providers/Providers.tsx` 里 `<SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>`）、Tailwind。注意首页是 `force-static` ISR 页面，**任何改动都不能让它变成动态渲染**（不能在服务端组件/布局里调用 `cookies()` / `headers()`）。

## 任务 A：匿名访客不发会话与用量请求

设计（中间件打标记 + 客户端读标记）：

1. `middleware.ts`：在最终返回的 `NextResponse` 上，若请求 cookie 里存在 next-auth 会话 cookie（`next-auth.session-token` 或 `__Secure-next-auth.session-token`，以 `lib/auth/` 里的实际配置为准），则设置一个**非 httpOnly** 的标记 cookie `sg_auth=1`（`SameSite=Lax`、`Path=/`、`Secure` 与请求协议一致、`maxAge` 与会话 cookie 同量级）；若不存在会话 cookie 但存在 `sg_auth`，则清除它。中间件现在有多个 `return NextResponse.next/rewrite/redirect(...)` 出口，请抽一个小函数统一在出口处打标记，不要改变现有的 i18n 重写/重定向逻辑。
2. `components/providers/Providers.tsx`：客户端判断 `document.cookie` 是否含 `sg_auth=1`；不含则给 `<SessionProvider session={null}>`，从而跳过初始 `/api/auth/session` 请求；含则保持现状（不传 `session`）。服务端渲染时无法读 cookie，用 `useState(() => ...)` 惰性初始化并保证 SSR 与首次客户端渲染的 DOM 一致（这个 prop 不影响 DOM，只影响是否发请求）。登录/登出后页面会整页跳转，标记随之刷新，无需额外处理。
3. `hooks/useUsage.ts`：同样规则，没有 `sg_auth=1` 时不发 `/api/me/usage`，直接把 `status` 置为未登录/idle 态、`usage` 为 null，调用方（`HeaderAuthControls.client.tsx`、`components/billing/*`）现有的 null 处理保持不变。
4. 把"读 sg_auth 标记"抽成一个小工具函数（如 `lib/auth/clientAuthHint.ts`），两处共用。

验收：`npm run typecheck && npm run test` 通过；`npm run dev` 起本地（端口用 3457，不要用 3000/3001），用无痕窗口打开首页，Network 面板确认没有 `/api/auth/session` 与 `/api/me/usage` 请求；登录后（或手动种一个 `sg_auth=1` cookie）确认这两个请求恢复。

## 任务 B：首页链接预取改为悬停触发

`components/home/**` 下所有指向 `/plan/start`、`/map`、`/posts`（含 `prefixPath(...)` 包装的多语言路径）的 `<Link>` 加 `prefetch={false}`。只改首页组件，不动站点其它页面。

## 任务 C：展示区缩略图瘦身（低优先级，做完 A、B 再做）

先读 `scripts/generate-home-showcase.mts` 和 `lib/home/showcase.ts`，弄清 `public/images/showcase/*.jpg` 是怎么生成的、在 `components/home/HomeShowcasePlan.tsx` 里以多大的 CSS 尺寸渲染（含 2x 屏）。然后二选一：

- 若由脚本生成：改脚本的输出尺寸/质量到"渲染尺寸 × 2"并重新生成；
- 若是手工放入：用 sharp 批量重编码到同样规格，原地覆盖。

目标：单张 ≤ 10 KB，视觉上在 2x 屏无明显劣化。不要改文件名（其它地方按 hash 文件名引用）。

## 约束

- **不要 git commit**，不要 push，不要执行 `deploy` / `upload` / `cf:*` 命令。
- 不要碰 `lib/seo/**`、`open-next.config.ts`、`wrangler.jsonc`、`worker/**`、`package.json`（另一个任务正在并行改这些文件；如需新依赖，先停下汇报）。
- 不要改 `components/home/HomeHeroTypewriter.ts`、`HomeWorksTicker.tsx`、`HomeHeroPhone.tsx` 里的动画逻辑（动画问题另行决定）。
- 不要改 `app/(site)/page.tsx`。
- 起 dev server 后按 pid 停进程，不要按端口 kill。

## 完成后

用简短中文汇报：改动文件清单；无痕窗口下首页 Network 请求验证结果；typecheck/test 结果；任务 C 处理前后的体积对比；任何未完成或存疑的点。
