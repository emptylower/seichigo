# Track A 评审修复简报

代码评审对象：分支 `feat/point-share-card` 的 `e00183a..HEAD`。以下每条都要修，按顺序做，每条一个 commit，先写测试再改代码。commit message 末尾带：
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

约束：只动 Track A 文件（`lib/share/**`、`app/api/share/**`、`app/s/**`、`prisma/**`、`app/robots.ts`、`tests/share/**`、`tests/seo/**`）。不 push、不对数据库执行迁移、不部署。`prisma/migrations/20260908010000_share_link/migration.sql` 尚未应用到任何库，可以直接改它，不要新建第二个迁移目录。

## F1（高）匿名短链禁止被登录用户认领
`lib/share/handlers/upload.ts:41-43` 现在 `link.userId` 为 null 时放行并把 userId 改写成调用者。改为 `link.userId !== userId` 一律 403（匿名链没有卡片，`/s/[code]` 已有点位截图兜底）。测试：匿名链 + 登录用户上传 → 403。

## F2（高）`formData()` 前做 Content-Length 预检
`lib/share/handlers/upload.ts` 在 `await req.formData()` 之前加：
```ts
const MAX_UPLOAD_BODY_BYTES = SHARE_CARD_MAX_BYTES + SHARE_PHOTO_MAX_BYTES + 64 * 1024
const declared = Number(req.headers.get('content-length') || '')
if (Number.isFinite(declared) && declared > MAX_UPLOAD_BODY_BYTES) {
  return NextResponse.json({ error: '上传内容过大' }, { status: 413 })
}
```
`lib/anitabi/handlers/imageServe.ts:106-107` 有同样的 `parseContentLength` 写法可复用。测试：content-length 超限 → 413 且不调用 formData。

## F3（高）robots.txt 放行读图路由
`app/robots.ts` 的 `*` 规则加 `allow: ['/', '/api/share/img/', '/api/share/photo/']`，`disallow` 保持。加测试断言 allow 列表包含这两个前缀（`tests/seo/` 下已有 robots 测试就补进去，没有就新建 `tests/seo/robots-share.test.ts`）。

## F4（中）匿名去重键纳入 ipHash
`lib/share/repo.ts` 的 `FindRecentDuplicateInput` 加 `ipHash: string | null`；`repoPrisma.ts` 与 `repoMemory.ts` 的 `findRecentDuplicate` 在 `userId` 为 null 时同时匹配 `ipHash`；`handlers/links.ts` 传入。测试：两个不同 ipHash 的匿名请求同一点位得到不同 code；同一 ipHash 24h 内复用。

## F5（中）上传配额按次数计，且卡片 key 带内容指纹
1. `prisma/schema.prisma` 的 `ShareLink` 加两列：`uploadCount Int @default(0)`、`updatedAt DateTime @updatedAt`。同步改 `migration.sql`（`"uploadCount" INTEGER NOT NULL DEFAULT 0`、`"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`）。跑 `npx prisma generate` 和 `npx prisma validate`。
2. `repo.ts` 的 `markUploaded` 改为原子 `uploadCount: { increment: 1 }`；`countUploadsByUserSince` 改为 `sum(uploadCount)` where `userId = ? AND updatedAt >= since`（Prisma `aggregate({ _sum: { uploadCount: true } })`）。`repoMemory.ts` 对齐。
3. `lib/share/store.ts` 的 `shareCardKey(code, ext)` 改为 `shareCardKey(code, fingerprint, ext)` 生成 `share/<code>-<fingerprint>.<ext>`，`fingerprint` = 卡片字节 sha256 hex 前 8 位（Web Crypto `crypto.subtle.digest`）。`handlers/upload.ts` 计算指纹、写新 key、`markUploaded` 成功后删除旧 `imageKey` 对象（`store.delete`，失败只记日志不报错）。
4. `app/s/[code]/page.tsx` 的卡片图 URL 改为 `${origin}/api/share/img/<code>?v=<fingerprint>`，`fingerprint` 从 `imageKey` 里解析（`share/<code>-<fp>.<ext>` 的 `<fp>` 段）。`handlers/media.ts` 忽略 `v` 参数，保持 `immutable`。
测试：同一 code 上传两次，第二次 `uploadCount` 为 2，旧对象被删，新 `imageKey` 含新指纹；配额 sum 达到 30 后第 31 次 429。

## F6（中）`pointId` 字符集收口
`lib/share/handlers/links.ts` 的 `pointId` 加 `.regex(/^[A-Za-z0-9_:.-]+$/)`。测试：含 `/` 或 `..` 的 pointId → 400。

## F7（中）WebP 校验 RIFF 长度自洽
`lib/share/imageMeta.ts` 在 `RIFF`/`WEBP` 魔数检查后加：
```ts
const riffSize = (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0
if (riffSize + 8 !== bytes.length) return null
```
测试：声明尺寸与实际字节数不符的 VP8X 头 → `parseWebpSize` 返回 null。现有 WebP 正例测试的字节数组要把 RIFF size 字段改正确。

## F8（中）`/s/[code]` 同一请求内不重复查库
`app/s/[code]/page.tsx` 的 `loadLink` 用 React `cache()` 包一层。测试：mock repo 的 `findByCode` 在一次渲染（generateMetadata + 页面体）里只被调用一次，若现有测试结构不便断言，至少保证现有测试通过。

## F9（低，一起带上）
- `lib/share/ipHash.ts`：删掉 `x-forwarded-for` 回退；`cf-connecting-ip` 缺失时 `readClientIp` 返回 null，`handlers/links.ts` 对匿名请求在 IP 为 null 时返回 429（`error: '无法识别来源，暂不能创建分享'`）。测试对应更新。
- `lib/share/handlers/media.ts` 的 `getShareImage`：`imageKey` 不以 `share/` 开头 → 404。
- `app/api/share/img/[code]/route.ts` 与 `app/api/share/photo/[userId]/[pointId]/route.ts` 加 `export const dynamic = 'force-dynamic'`。
- `app/s/[code]/page.tsx` 内联 script 的 `JSON.stringify(absolute)` 后追加 `.replace(/</g, '\\u003c')`。
- `lib/share/repoPrisma.ts` 的 `toRecord`：`locale` 不在 `zh|en|ja` 时退回 `'zh'`。
- `lib/share/handlers/links.ts:34`：zod 错误不透传，统一返回 `{ error: '参数不合法' }`。

## 完成标准
- `npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；`npx prisma validate` 通过。
- 汇报每条 F 的 commit sha 与测试关键行。
