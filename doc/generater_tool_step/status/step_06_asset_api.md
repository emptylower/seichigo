# Step 06｜图片：上传（登录）+ 读取（公开）+ 存 DB（已完成）

## 目标
为富文本编辑器提供图片能力：
- 登录用户上传图片 → 返回可插入编辑器的 URL（`/assets/<id>`）
- 渲染时通过 URL 获取图片 bytes（公开读取）
- 图片数据存储在 DB（`Asset.bytes`）

## 本次完成内容
- 新增可注入依赖的 handler 工厂：`lib/asset/handlers.ts`
  - `createPostAssetsHandler`：支持 `multipart/form-data` 上传（字段 `file`），校验登录、`image/*` MIME、`ASSET_MAX_BYTES` 大小限制；写入 repo 并返回 `{ id, url }`
  - `createGetAssetHandler`：公开读取 `GET /assets/<id>`，返回 bytes 并设置正确 `Content-Type`
- 新增 Next.js 路由：
  - `app/api/assets/route.ts`：`POST /api/assets`
  - `app/assets/[id]/route.ts`：`GET /assets/[id]`
  - 均显式指定 `runtime = "nodejs"`
- 新增测试（测试先行）：`tests/asset/api.test.ts`
  - 未登录上传返回 401
  - 登录上传返回 `{id,url}`，并验证 repo 存入 `bytes/contentType`
  - 公开读取返回 200、`Content-Type` 正确、bytes 一致
  - 超过 `ASSET_MAX_BYTES` 返回 413

## 变更文件
- `lib/asset/handlers.ts`
- `app/api/assets/route.ts`
- `app/assets/[id]/route.ts`
- `tests/asset/api.test.ts`

## 验收方式（独立可测）
- 运行：`npm run test`

