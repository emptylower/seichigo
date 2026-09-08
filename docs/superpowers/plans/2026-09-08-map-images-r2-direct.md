# 2026-09-08 地图点位图改为 R2 公共域直出，代理与直连兜底

## 背景

地图图片诊断面板（`/admin/ops/map-image-diagnostics`）过去 7 天：视口加载阶段（`viewport_loader_request_terminal`）P95 5.3 s，失败几乎全是 `timeout`。代码里点位图（kind 为 `point` / `point-preview` / `point-thumbnail`）目前**只走站内代理** `/api/anitabi/image-render`（见 `lib/anitabi/imageProxy.ts` 的 `getMapDisplayImageCandidates`，`forceProxyOnly` 分支），每张图都要进 Worker → 读 R2 → 流回浏览器，Worker 自定义域前面没有 Cloudflare 边缘缓存。

镜像库已把 85890 张图中的 85743 张（99.8%）写进 R2 桶 `seichigo-anitabi-images`，key 由 `lib/anitabi/imageNormalize.ts` 的 `computeMirrorKey(canonicalUrl, mimeType)` 生成：`mirror/v1/<canonical host>/<sha256(canonicalUrl) 前 24 hex>/<ext>`，`ext` 由 `extensionFromMimeType` 决定（`.jpg`/`.png`/`.webp`/`.avif`/`.gif`/`.svg`，未知回 `.jpg`）。对象写入时带 `httpMetadata.contentType`（`lib/anitabi/r2Mirror.ts`）。

我已把自定义域 **`https://img.seichigo.com`** 绑到该桶（Cloudflare CDN 直接从 R2 出图，不经 Worker）。本任务让客户端优先用它。

## 目标

候选顺序（`getMapDisplayImageCandidates` 的输出）：
- 点位图三种 kind：`[R2 直出 URL, 代理 URL, 代理重试 URL, 直连投递 URL]`（直连放最后作为最终兜底；之前这三种 kind 没有直连，现在按用户要求加上）。
- 封面（`cover`）与其它 kind：在现有顺序**最前面**插入 R2 直出 URL，其余不变。
- 站内 origin 的图片（`url.origin === baseOrigin`）不变。
- R2 直出 URL 只对能算出 canonical/mirror key 的 anitabi / bgm 图片生成；算不出就不插入。

## 实现要点

1. **配置开关**：新增 `NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE`（例如 `https://img.seichigo.com`）。为空则完全不生成 R2 候选（行为与现在一致）。加到 `wrangler.jsonc` 的 `vars`（带中文注释）和 `.env.example`（如有）。
2. **key 计算是异步的**（`crypto.subtle`），而 `getMapDisplayImageCandidates` 是同步函数，10 个调用方（`grep -rln getMapDisplayImageCandidates components features lib app tests`）都按同步用。方案：
   - 新增 `resolveMirrorPublicUrl(rawUrl, kind): Promise<string | null>`：`computeCanonicalImageUrl` → 按 URL 路径扩展名猜 mime（`.jpg/.jpeg`→`image/jpeg`，`.png`、`.webp`、`.avif`、`.gif`；没有扩展名或带 `?q=&w=` 的 anitabi 点位图按 `image/jpeg`）→ `computeMirrorKey` → 拼 `${base}/${key}`。
   - 新增 `getMapDisplayImageCandidatesAsync(raw, options): Promise<string[]>` = `[mirrorUrl?, ...getMapDisplayImageCandidates(raw, options)]` 去重。
   - 改造**真正在浏览器里加载图片**的调用方走 async 版本：`components/map/ResilientMapImage.tsx`、`components/map/utils/thumbnailLoader.ts`、`components/map/utils/coverAvatarLoader.ts`、`features/map/anitabi/media.ts`（预热）、`app/(authed)/plan/[id]/hooks/usePlanImagePrewarm.ts`、`app/(authed)/plan/[id]/components/ItemThumbnail.tsx`。服务端渲染时用的（`lib/home/*`、`components/home/homeShowcase.ts`）保持同步版本不动。
   - 若某个调用方改 async 会明显打乱现有逻辑（例如在 render 里同步取 candidates），可以先同步取候选、异步算出 mirror URL 后把它 unshift 到候选队列头部再启动加载；关键是**首个真正发出的请求应当是 R2 直出**。
3. **404 兜底**：未镜像的 0.2% 图片在 R2 域会 404，现有的候选阶梯会自然切到代理；确认 `ResilientMapImage` 与各 loader 对 404/onerror 的处理会推进到下一候选，而不是把整张图判为失败。
4. **诊断上报**：`lib/mapImageDiag/shared.ts` 的事件 schema 若能低成本加一个可选字段 `candidate_kind: 'r2' | 'proxy' | 'direct'`（由候选 URL 的 host/路径判断），就加上并在 `mapImageSessionManager.ts` 上报；服务端 `lib/mapImageDiag/service.ts` 只需透传存储，不改面板。做不到就跳过，不要为此扩大改动面。
5. **超时**：`features/map/anitabi/shared.ts` 的 `WARMUP_IMAGE_TIMEOUT_MS = 1800` 等不动。

## 测试

- `tests/` 里 imageProxy / media / ResilientMapImage 相关现有测试全部通过（`grep -rl "imageProxy\|getMapDisplayImageCandidates" tests`）。
- 新增：开关为空时输出与旧行为完全一致；开关打开时点位图候选首项是 `https://img.seichigo.com/mirror/v1/image.anitabi.cn/<24hex>/.jpg`，第二项是代理，末项是直连；bgm 封面首项也是 R2；站内图片不变；`.png` 扩展名生成 `.png` key。
- `npm run typecheck`（`typecheck:tests` 有 3 个 HEAD 预存错误，忽略）、`npm run test` 全绿、`npm run cf:build` 成功。

## 约束

- **不要 git commit**，不要 push，不要 deploy/upload。
- 不要碰 `lib/asset/**`、`open-next.config.ts`、`middleware.ts`、`app/api/anitabi/image-render/**`（代理路由本身不改）。
- 不要改 `computeMirrorKey` / `computeCanonicalImageUrl` 的算法（必须与已有 8.5 万个 R2 对象零漂移）。

## 完成后

简短中文汇报：改动文件；候选顺序示例（点位图与封面各一条真实 URL 的输出）；哪些调用方改成了 async、哪些保留同步；测试/typecheck/cf:build 结果；存疑点。
