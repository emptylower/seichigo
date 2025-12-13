# 06｜图片：上传（登录）+ 读取（公开）+ 存 DB

## 目标
为富文本编辑器提供图片能力：
- 作者上传图片 → 返回可插入编辑器的 URL
- 渲染时通过 URL 获取图片 bytes
- 允许直接插入外链图片 URL（`http/https`；仍会被服务端 sanitize 校验协议与属性）

## 交付物
1. API：
   - `POST /api/assets`：上传（multipart/form-data）
     - 入参：`file`
     - 出参：`{ id, url }`，其中 `url = "/assets/<id>"`
2. Public route：
   - `GET /assets/[id]`：返回图片 bytes（`Content-Type` 正确）

## 先写测试（Test First）
新增 `tests/asset/api.test.ts` 覆盖：
1. 未登录上传：返回 401
2. 登录上传：
   - 返回 `{id,url}`
   - repo 收到 bytes 与 contentType
3. 获取图片：
   - `GET /assets/<id>` 返回 200
   - header `Content-Type` 正确
   - body bytes 与上传一致
4. 文件大小限制（建议）：
   - 超过 `ASSET_MAX_BYTES` 返回 413（或 400）

> 测试建议通过“可注入依赖的 handler 工厂”实现，无需真实 DB。

## 再实现
1. 新增 route handlers：
   - `app/api/assets/route.ts`
   - `app/assets/[id]/route.ts`
2. 在 route 内：
   - 上传使用 `await req.formData()` + `file.arrayBuffer()`
   - 校验 mime：仅允许 `image/*`
   - 校验大小：`ASSET_MAX_BYTES`（默认例如 5MB；可写在实现里并在测试锁定）
   - 读取：从 repo 获取 bytes → `new Response(bytes, { headers })`
3. 鉴权：
   - 上传：`getServerAuthSession()` 必须存在
   - 读取：公开（不要求登录）

## 根据测试结果修正
- 路由若因 Next runtime 差异导致 `formData()` 不可用：
  - 优先调整 route runtime 配置（Node runtime）或改为 JSON(base64) 上传（但需要重新写测试并确认）

## 验收（独立可测）
- `npm run test`：`tests/asset/api.test.ts` 全绿
