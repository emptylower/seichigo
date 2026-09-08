# 2026-09-07 首页 TTFB 修复 · 前端第二轮：把浏览器专用库移出服务端包

## 背景

Worker 冷启动时间与脚本体积正相关。第一轮去掉 `googleapis` 后上传体积 49 MB → 31 MB。剩余可减的大头在 `.open-next/server-functions/default/.next/server/` 里：

| 文件 | 体积 | 内容 |
|---|---|---|
| `app/(authed)/me/routebooks/[id]/page.js` | 1.1 MB | `maplibre-gl` 整个库（含 WebGL shader 源码）被服务端渲染路径引入 |
| `chunks/8559.js` | 1.1 MB | TipTap / ProseMirror 编辑器被服务端渲染路径引入 |

这两个库只能在浏览器里跑，服务端渲染它们既没意义也拖慢全站冷启动（OpenNext 把所有路由打进一个 handler.mjs）。

## 任务 A：MapLibre 只在客户端加载

引入链：`app/(authed)/me/routebooks/[id]/ui.tsx` → `components/PlannerMapStage.tsx` → `@/components/route/RoutePreviewMap`（第 4 行 `import maplibregl from 'maplibre-gl'` 是值引入）。

项目里已有正确范例可照抄：`app/(authed)/plan/[id]/components/DayMapLazy.tsx`（`dynamic(() => import('./DayMap'), { ssr: false, loading })`）和 `components/map/AnitabiMapPageLazy.tsx`。

做法：给 `PlannerMapStage` 里对 `RoutePreviewMap` 的使用套一层 `next/dynamic` + `ssr: false` 的懒加载包装（新建 `RoutePreviewMapLazy.tsx` 放在 `components/route/` 下，供其它调用方复用），loading 占位沿用 `components/route/MapUnavailablePlaceholder.tsx` 或一个同尺寸的空白容器，避免布局跳动。
然后全局搜 `RoutePreviewMap` 的其它直接引用（`app/(authed)/plan/[id]/components/DayMap.tsx`、`DayMapExpanded.tsx`、`hooks/useDayPointPopup.tsx` 等），凡是最终会被服务端渲染的路径都改走 Lazy 版本；已经在 `DayMapLazy` 之下的不用动。
`import type ... from 'maplibre-gl'` 的纯类型引入不用改。

验收：`npm run cf:build` 后 `grep -c u_device_pixel_ratio .open-next/server-functions/default/handler.mjs` 应为 0。

## 任务 B：TipTap 只在客户端加载

引入点（10 个文件）：`components/editor/RichTextEditor.tsx` 及 `components/editor/extensions/*`、`components/toc/EditorToc.tsx`、`components/translation/TipTapPreview.tsx`。

先找出这些组件被哪些页面/布局引用（`grep -rn "RichTextEditor\|EditorToc\|TipTapPreview" app components`），在**页面层**的引用处改为 `next/dynamic` + `ssr: false`，编辑器自身文件不动。编辑器多用于 admin/投稿页，没有 SEO 需求，`ssr: false` 无副作用。

验收：`npm run cf:build` 后 `grep -c ProseMirror .open-next/server-functions/default/handler.mjs` 应为 0（或接近 0，剩余若来自类型/字符串常量可接受，报告里说明）。

## 总验收

- `npm run typecheck && npm run test` 通过（`typecheck:tests` 在 HEAD 上有 3 个预存错误，与本任务无关，忽略）。
- `npx wrangler deploy --dry-run --outdir scratch/wr-dry-r2` 记录 `Total Upload` 前后对比。
- `npm run dev`（端口 3457）打开 `/me/routebooks/<任一 id>` 与一个含编辑器的页面，确认地图和编辑器仍能正常出现；结束后按 pid 停进程。

## 约束

- **不要 git commit**，不要 push，不要执行 `deploy` / `upload` / `cf:deploy` / `cf:upload`。
- 不要碰 `lib/seo/**`、`open-next.config.ts`、`wrangler.jsonc`、`worker/**`、`package.json`、`middleware.ts`。
- 不要改地图与编辑器的功能逻辑，只改加载方式。

## 完成后

用简短中文汇报：改动文件；两个 grep 计数；dry-run 体积前后对比；typecheck/test 结果；页面手测结果；存疑点。
