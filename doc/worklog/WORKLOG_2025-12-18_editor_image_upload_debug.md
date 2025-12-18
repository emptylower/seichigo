# WORKLOG 2025-12-18｜创作页图片上传问题排查：插入覆盖 + Vercel 413

> 注：本次对话的“PRD/代码库现状盘点”已记录在 `doc/worklog/WORKLOG_2025-12-18_repo_review_summary.md`；本文件仅补充本次对话后半段的图片上传问题排查与修复。

## 问题现象
- 创作页（`/submit/new`）在上传两张图片后继续上传，会出现“无法上传/看起来上传无效”的情况。
- 线上（Vercel）请求 `POST https://seichigo.com/api/assets` 出现：
  - `413 Request Entity Too Large`
  - `FUNCTION_PAYLOAD_TOO_LARGE`
  - 浏览器 Network 有时仅表现为请求失败（无业务错误码），Vercel 日志可见 413 记录。

## 根因分析
### 1) “只能保留两张图”的根因：TipTap NodeSelection 下插入会替换节点
- 编辑器图片节点使用自定义 TipTap node：`figureImage`（`components/editor/extensions/FigureImage.tsx`）。
- 当用户刚插入图片时，编辑器选区往往停留在图片节点（NodeSelection）或其 caption 内。
- 此时调用 `editor.chain().insertContent(...)` 会把“当前选中的图片节点”当作选区内容进行替换，导致下一次插入覆盖上一张图：
  - 表现为：第一张存在、最后一次插入的那张存在，中间被覆盖，看起来像“最多两张”。

### 2) 线上 413 的根因：Vercel Function 请求体上限（在路由代码前被拒）
- `FUNCTION_PAYLOAD_TOO_LARGE` 说明请求体超过 Vercel 平台限制，请求在进入 `app/api/assets/route.ts` 之前就被拒绝。
- 因此仅依赖服务端 `ASSET_MAX_BYTES` 的校验无法兜底（因为 handler 根本没机会执行）。

## 修复内容
### 1) 修复图片插入覆盖：改用 insertContentAt（插到图片节点之后）
- 文件：`components/editor/RichTextEditor.tsx`
  - 新增 `resolveImageInsertPos(editor)`：
    - 若当前选中的是 `figureImage` 节点，返回 `selection.to`（node 之后）；
    - 若选区在图片 caption/内部，尝试从 `$from` 向上找到 `figureImage` 所在深度，并返回 `$from.after(depth)`。
  - 上传成功后插入图片改为：
    - `editor.chain().focus().insertContentAt(pos, nodes).run()`，避免覆盖当前选中的图片节点。
- 回归测试：
  - `tests/editor/paste-images.test.tsx` 新增用例：先粘贴 2 张，再粘贴 1 张，最终应同时包含 3 张图片 URL。

### 2) 规避 Vercel 413：客户端预压缩 + 降低预算 + 413 重试一次
- 文件：`components/editor/RichTextEditor.tsx`
  - 新增客户端体积预算 `resolveClientAssetMaxBytes()`：
    - 默认 `3_500_000` bytes（可用 `NEXT_PUBLIC_ASSET_MAX_BYTES` 覆盖）。
  - 新增 `compressImageIfNeeded(file, maxBytes)`：
    - 使用 `canvas` 进行缩放（从 maxDim 2560 开始逐步降低）；
    - 输出优先 `image/webp`，失败则退回 `image/jpeg`，并递减质量直到小于预算；
    - GIF 过大则直接提示用户（避免破坏动图内容）。
  - 上传逻辑：
    - 先压缩到预算再上传；
    - 若服务端仍返回 413，则用更紧预算（`maxBytes * 0.72`，最低 1.5MB）再压一次并重试 1 次。
- 文件：`lib/asset/handlers.ts`
  - 服务端默认 `ASSET_MAX_BYTES` 同步为 `3_500_000` bytes（仍可通过环境变量覆盖）。

## 变更提交（GitHub）
- `ae1d565` `fix(editor): prevent image insert overwrite`
- `15ceb9e` `fix(upload): compress images to avoid 413`
- `228e282` `fix(upload): lower max bytes and retry on 413`

## 验证
- 本地：`npm test` 全绿。
- 线上：需要等待 Vercel 部署完成后再次验证大图上传；若仍频繁 413，建议继续下调 `NEXT_PUBLIC_ASSET_MAX_BYTES/ASSET_MAX_BYTES`，或改为对象存储直传（S3/R2/Supabase Storage + signed URL）以绕开平台请求体限制。

