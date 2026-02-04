# SeichiGo AI Assistant API 操作手册

本手册为 AI 助手提供完整的 API 调用指南，用于管理 SeichiGo 博客系统的文章内容。

## 概述

### Base URL
- 生产环境：`https://seichigo.com/api/ai`
- 本地开发：`http://localhost:3000/api/ai`

### 认证方式
所有 API 端点都需要管理员权限认证：
- 使用 Auth.js (NextAuth) Session 认证
- 必须是管理员用户（邮箱在 `ADMIN_EMAILS` 环境变量中）
- 请求需要携带有效的 Session Cookie

### 与“标准 API”的关系

- 标准 API（创作中心使用）：`/api/articles/*`（通常只允许操作自己的文章）
- AI API（给 AI 助手/自动化使用）：`/api/ai/*`（仅管理员白名单可用，可跨作者筛选/操作）
- 两者操作同一套文章数据（复用底层 repo），区别主要在鉴权与筛选规则

### 响应格式
成功响应格式：
```json
{
  "ok": true,
  "items": [...],     // GET /api/ai/articles
  "article": {...}    // POST/GET/PATCH 单篇文章
}
```

错误响应格式：
```json
{
  "error": "错误描述信息"
}
```

## 端点列表

| 方法 | 端点 | 用途 | 状态限制 |
|------|------|------|---------|
| GET | `/api/ai` | 路由挂载/探活（返回端点列表） | 无 |
| GET | `/api/ai/articles` | 获取文章列表（不含正文） | 无 |
| POST | `/api/ai/articles` | 创建新草稿 | 无 |
| GET | `/api/ai/articles/:id` | 获取单篇文章完整信息 | 无 |
| PATCH | `/api/ai/articles/:id` | 更新文章内容 | 仅 draft/rejected |
| POST | `/api/ai/articles/:id/submit` | 提交审核 | 仅 draft/rejected |

## 端点详细说明

### GET /api/ai

用于确认 `/api/ai/*` 已正确挂载（不会落到 Next.js HTML 404）。

- 未登录：返回 `401` JSON
- 非管理员：返回 `403` JSON
- 管理员：返回 `200` JSON，并包含端点列表

**请求示例**

```bash
curl -X GET "http://localhost:3000/api/ai" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

---

### GET /api/ai/articles

获取文章列表，不包含正文内容（contentJson/contentHtml）。

**Query 参数**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| authorId | string | 否 | 按作者 ID 筛选 |
| status | string | 否 | 按状态筛选：`draft` / `in_review` / `published` / `rejected` |
| language | string | 否 | 按语言筛选，如 `zh` / `en` |

**请求示例**

基础查询（获取所有文章）：
```bash
curl -X GET "http://localhost:3000/api/ai/articles" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

带筛选条件：
```bash
curl -X GET "http://localhost:3000/api/ai/articles?status=draft&language=zh" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

按作者查询：
```bash
curl -X GET "http://localhost:3000/api/ai/articles?authorId=user_123" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

**成功响应 (200)**

```json
{
  "ok": true,
  "items": [
    {
      "id": "article_abc123",
      "slug": "my-first-article-2026-02-03",
      "language": "zh",
      "translationGroupId": null,
      "authorId": "user_123",
      "title": "我的第一篇文章",
      "seoTitle": "我的第一篇文章 - SEO 优化标题",
      "description": "这是一篇关于动漫圣地巡礼的文章",
      "animeIds": ["anime_001"],
      "city": "东京",
      "routeLength": "5公里",
      "tags": ["动漫", "旅行", "东京"],
      "status": "draft",
      "rejectReason": null,
      "publishedAt": null,
      "createdAt": "2026-02-03T10:00:00.000Z",
      "updatedAt": "2026-02-03T10:00:00.000Z"
    }
  ]
}
```

**列表项字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 文章唯一标识符 |
| slug | string | URL 友好的标识符（自动生成，不可修改） |
| language | string | 语言代码，默认 `zh` |
| translationGroupId | string \| null | 翻译组 ID（关联不同语言版本） |
| authorId | string | 作者用户 ID |
| title | string | 文章标题 |
| seoTitle | string \| null | SEO 优化标题（最多 120 字符） |
| description | string \| null | 文章描述（最多 320 字符） |
| animeIds | string[] | 关联的动漫 ID 数组 |
| city | string \| null | 相关城市 |
| routeLength | string \| null | 路线长度 |
| tags | string[] | 标签数组 |
| status | string | 文章状态：`draft` / `in_review` / `published` / `rejected` |
| rejectReason | string \| null | 拒绝原因（status=rejected 时） |
| publishedAt | string \| null | 发布时间 ISO 8601 |
| createdAt | string | 创建时间 ISO 8601 |
| updatedAt | string | 最后更新时间 ISO 8601 |

**错误响应**

| 状态码 | 说明 | 响应示例 |
|--------|------|---------|
| 401 | 未登录 | `{"error": "Unauthorized"}` |
| 403 | 非管理员 | `{"error": "Forbidden: Admin access required"}` |

---

### POST /api/ai/articles

创建新的草稿文章。系统会自动根据标题和时间生成唯一的 slug。

**请求体字段**

| 字段 | 类型 | 必需 | 说明 | 限制 |
|------|------|------|------|------|
| title | string | 是 | 文章标题 | 非空字符串（trim 后长度 > 0） |
| seoTitle | string \| null | 否 | SEO 标题 | 最多 120 字符 |
| description | string \| null | 否 | 文章描述 | 最多 320 字符 |
| language | string | 否 | 语言代码 | 2-10 字符，默认 `zh` |
| translationGroupId | string \| null | 否 | 翻译组 ID | - |
| animeIds | string[] | 否 | 关联动漫 ID | 字符串数组 |
| city | string \| null | 否 | 相关城市 | - |
| routeLength | string \| null | 否 | 路线长度 | - |
| tags | string[] | 否 | 标签 | 字符串数组 |
| contentJson | object \| null | 否 | TipTap JSON 格式的内容 | 见 TipTap 格式章节 |
| contentHtml | string | 否 | HTML 格式的内容 | 会自动进行安全过滤 |

**请求示例**

```bash
curl -X POST "http://localhost:3000/api/ai/articles" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "探访《你的名字》取景地：飞騨古川",
    "seoTitle": "你的名字取景地探访指南 - 飞騨古川完整攻略",
    "description": "详细介绍动画电影《你的名字》在飞騨古川的实景取景地，包括车站、神社等经典场景的实地探访攻略。",
    "language": "zh",
    "animeIds": ["anime_yourname"],
    "city": "飞騨古川",
    "routeLength": "3公里",
    "tags": ["你的名字", "飞騨古川", "圣地巡礼"],
    "contentJson": {
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": { "level": 2 },
          "content": [{ "type": "text", "text": "引言" }]
        },
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "《你的名字》是新海诚导演的代表作，电影中许多场景都来自" },
            { "type": "text", "marks": [{ "type": "bold" }], "text": "飞騨古川" },
            { "type": "text", "text": "这座美丽的小城。" }
          ]
        },
        {
          "type": "image",
          "attrs": {
            "src": "/assets/yourname_station_001",
            "alt": "飞騨古川站"
          }
        }
      ]
    },
    "contentHtml": "<h2>引言</h2><p>《你的名字》是新海诚导演的代表作...</p>"
  }'
```

**成功响应 (200)**

```json
{
  "ok": true,
  "article": {
    "id": "article_xyz789",
    "slug": "tan-fang-ni-de-ming-zi-qu-jing-di-fei-zuo-gu-chuan-2026-02-03",
    "language": "zh",
    "translationGroupId": null,
    "authorId": "user_123",
    "title": "探访《你的名字》取景地：飞騨古川",
    "seoTitle": "你的名字取景地探访指南 - 飞騨古川完整攻略",
    "description": "详细介绍动画电影《你的名字》在飞騨古川的实景取景地...",
    "animeIds": ["anime_yourname"],
    "city": "飞騨古川",
    "routeLength": "3公里",
    "tags": ["你的名字", "飞騨古川", "圣地巡礼"],
    "status": "draft",
    "rejectReason": null,
    "publishedAt": null,
    "createdAt": "2026-02-03T11:00:00.000Z",
    "updatedAt": "2026-02-03T11:00:00.000Z"
  }
}
```

**错误响应**

| 状态码 | 说明 | 响应示例 |
|--------|------|---------|
| 400 | 参数错误 | `{"error": "标题不能为空"}` |
| 401 | 未登录 | `{"error": "请先登录"}` |
| 403 | 非管理员 | `{"error": "无权限"}` |
| 409 | Slug 冲突 | `{"error": "无法生成唯一 slug，请稍后重试"}` |

**注意事项**
- `slug` 字段由系统自动生成，基于标题和创建时间，不需要也不能在请求中指定
- 如果自动生成的 slug 已存在，系统会尝试添加数字后缀（最多尝试 20 次）
- `contentHtml` 会经过服务器端的安全过滤，移除潜在的危险 HTML 标签和属性
- 所有字符串字段会自动 trim 处理空白字符
- 新创建的文章状态默认为 `draft`

---

### GET /api/ai/articles/:id

获取单篇文章的完整信息，包括正文内容（contentJson 和 contentHtml）。

**Path 参数**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | string | 是 | 文章 ID |

**请求示例**

```bash
curl -X GET "http://localhost:3000/api/ai/articles/article_xyz789" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

**成功响应 (200)**

```json
{
  "ok": true,
  "article": {
    "id": "article_xyz789",
    "authorId": "user_123",
    "slug": "tan-fang-ni-de-ming-zi-qu-jing-di-fei-zuo-gu-chuan-2026-02-03",
    "language": "zh",
    "translationGroupId": null,
    "title": "探访《你的名字》取景地：飞騨古川",
    "seoTitle": "你的名字取景地探访指南 - 飞騨古川完整攻略",
    "description": "详细介绍动画电影《你的名字》在飞騨古川的实景取景地...",
    "animeIds": ["anime_yourname"],
    "city": "飞騨古川",
    "routeLength": "3公里",
    "tags": ["你的名字", "飞騨古川", "圣地巡礼"],
    "cover": "/assets/cover_abc123",
    "contentJson": {
      "type": "doc",
      "content": [...]
    },
    "contentHtml": "<h2>引言</h2><p>《你的名字》是新海诚导演的代表作...</p>",
    "status": "draft",
    "rejectReason": null,
    "needsRevision": false,
    "publishedAt": null,
    "lastApprovedAt": null,
    "createdAt": "2026-02-03T11:00:00.000Z",
    "updatedAt": "2026-02-03T11:00:00.000Z"
  }
}
```

**详情额外字段**

与列表接口相比，详情接口额外返回以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| cover | string \| null | 封面图片路径，格式：`/assets/:id` |
| contentJson | object \| null | TipTap JSON 格式的文章正文 |
| contentHtml | string | HTML 格式的文章正文（已过滤和渲染嵌入内容） |
| needsRevision | boolean | 是否需要修订 |
| lastApprovedAt | string \| null | 最后审核通过时间 ISO 8601 |

**错误响应**

| 状态码 | 说明 | 响应示例 |
|--------|------|---------|
| 400 | 缺少 ID | `{"error": "缺少 id"}` |
| 401 | 未登录 | `{"error": "请先登录"}` |
| 403 | 非管理员 | `{"error": "无权限"}` |
| 404 | 文章不存在 | `{"error": "未找到文章"}` |

---

### PATCH /api/ai/articles/:id

更新文章内容。只能编辑状态为 `draft` 或 `rejected` 的文章。

**Path 参数**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | string | 是 | 文章 ID |

**请求体字段**

所有字段都是可选的，但**至少需要提供一个字段**进行更新。

| 字段 | 类型 | 说明 | 限制 |
|------|------|------|------|
| title | string | 文章标题 | 非空字符串（trim 后长度 > 0） |
| seoTitle | string \| null | SEO 标题 | 最多 120 字符 |
| description | string \| null | 文章描述 | 最多 320 字符 |
| animeIds | string[] | 关联动漫 ID | 字符串数组 |
| city | string \| null | 相关城市 | - |
| routeLength | string \| null | 路线长度 | - |
| tags | string[] | 标签 | 字符串数组 |
| cover | string \| null | 封面图片 | 格式：`/assets/[a-zA-Z0-9_-]+`，最多 512 字符 |
| contentJson | object \| null | TipTap JSON 内容 | 见 TipTap 格式章节 |
| contentHtml | string | HTML 内容 | 会自动进行安全过滤 |

**状态限制**
- ✅ 可编辑：`draft`、`rejected`
- ❌ 不可编辑：`in_review`、`published`

**请求示例 1：更新标题和描述**

```bash
curl -X PATCH "http://localhost:3000/api/ai/articles/article_xyz789" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "探访《你的名字》取景地：飞騨古川完整攻略",
    "description": "2026最新版！详细介绍动画电影《你的名字》在飞騨古川的所有实景取景地，含交通、美食、住宿完整攻略。"
  }'
```

**请求示例 2：更新内容**

```bash
curl -X PATCH "http://localhost:3000/api/ai/articles/article_xyz789" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contentJson": {
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": { "level": 2 },
          "content": [{ "type": "text", "text": "更新后的章节标题" }]
        },
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "更新后的段落内容..." }]
        }
      ]
    },
    "contentHtml": "<h2>更新后的章节标题</h2><p>更新后的段落内容...</p>"
  }'
```

**请求示例 3：更新封面**

```bash
curl -X PATCH "http://localhost:3000/api/ai/articles/article_xyz789" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cover": "/assets/new_cover_456"
  }'
```

**成功响应 (200)**

返回更新后的完整文章信息（格式同 GET /api/ai/articles/:id）：

```json
{
  "ok": true,
  "article": {
    "id": "article_xyz789",
    "authorId": "user_123",
    "slug": "tan-fang-ni-de-ming-zi-qu-jing-di-fei-zuo-gu-chuan-2026-02-03",
    "title": "探访《你的名字》取景地：飞騨古川完整攻略",
    "description": "2026最新版！详细介绍动画电影《你的名字》...",
    "contentJson": {...},
    "contentHtml": "...",
    "updatedAt": "2026-02-03T12:00:00.000Z",
    ...
  }
}
```

**错误响应**

| 状态码 | 说明 | 响应示例 |
|--------|------|---------|
| 400 | 参数错误 | `{"error": "标题不能为空"}` |
| 400 | 尝试修改 slug | `{"error": "slug 不允许修改"}` |
| 400 | 无更新字段 | `{"error": "至少需要更新一个字段"}` |
| 401 | 未登录 | `{"error": "请先登录"}` |
| 403 | 非管理员 | `{"error": "无权限"}` |
| 404 | 文章不存在 | `{"error": "未找到文章"}` |
| 409 | 状态不可编辑 | `{"error": "当前状态不可编辑"}` |

**注意事项**
- `slug` 字段**不能修改**，如果请求体中包含 slug 字段会返回 400 错误
- 只能编辑 `draft` 或 `rejected` 状态的文章
- 如果文章在审核中（`in_review`）或已发布（`published`），会返回 409 错误
- `contentHtml` 会经过服务器端的安全过滤
- 字符串字段会自动 trim 处理空白字符
- 更新后 `updatedAt` 字段会自动更新为当前时间

---

### POST /api/ai/articles/:id/submit

提交文章进入审核流程。只能提交状态为 `draft` 或 `rejected` 的文章。

**Path 参数**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | string | 是 | 文章 ID |

**请求示例**

```bash
curl -X POST "http://localhost:3000/api/ai/articles/article_xyz789/submit" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

**成功响应 (200)**

```json
{
  "ok": true,
  "article": {
    "id": "article_xyz789",
    "status": "in_review",
    "authorId": "user_123"
  }
}
```

**错误响应**

| 状态码 | 说明 | 响应示例 |
|--------|------|---------|
| 400 | 缺少 ID | `{"error": "缺少 id"}` |
| 401 | 未登录 | `{"error": "请先登录"}` |
| 403 | 非管理员 | `{"error": "无权限"}` |
| 404 | 文章不存在 | `{"error": "未找到文章"}` |
| 409 | 状态不可提交 | `{"error": "只能提交草稿或已拒绝的文章"}` |

**状态转换**
- 提交后文章状态从 `draft` 或 `rejected` 变为 `in_review`
- 如果之前有拒绝原因（`rejectReason`），会被清除
- 提交后文章进入待审核队列，管理员可在审核页面查看

---

## 文章状态说明

### 状态流转图

```
draft (草稿)
  ↓ [提交审核]
in_review (审核中)
  ↓ [审核通过]          ↓ [审核拒绝]
published (已发布)    rejected (已拒绝)
                         ↓ [修改后重新提交]
                      in_review (审核中)
```

### 状态详细说明

| 状态 | 英文 | 说明 | 可编辑 | 可提交审核 |
|------|------|------|--------|-----------|
| 草稿 | draft | 初始状态，文章正在编写中 | ✅ 是 | ✅ 是 |
| 审核中 | in_review | 已提交，等待管理员审核 | ❌ 否 | ❌ 否 |
| 已发布 | published | 审核通过，已公开发布 | ❌ 否 | ❌ 否 |
| 已拒绝 | rejected | 审核未通过，需要修改 | ✅ 是 | ✅ 是 |

**编辑权限**
- `draft` 和 `rejected` 状态可以通过 PATCH 接口编辑
- `in_review` 和 `published` 状态不能编辑（返回 409 错误）

**提交审核权限**
- `draft` 和 `rejected` 状态可以提交审核
- `in_review` 和 `published` 状态不能再次提交（返回 409 错误）

**拒绝原因**
- 当文章被拒绝时，`rejectReason` 字段会包含管理员的拒绝理由
- 重新提交后，`rejectReason` 会被清除

---

## TipTap JSON 内容格式

SeichiGo 使用 TipTap 编辑器，内容以 JSON 格式存储。

### 基础结构

所有 TipTap 文档都是一个根 `doc` 节点，包含一个 `content` 数组：

```json
{
  "type": "doc",
  "content": [
    // 文章内容节点数组
  ]
}
```

### 常用节点类型

#### 1. 段落 (paragraph)

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "这是一段普通文本。" }
  ]
}
```

#### 2. 标题 (heading)

支持 1-6 级标题：

```json
{
  "type": "heading",
  "attrs": { "level": 2 },
  "content": [
    { "type": "text", "text": "二级标题" }
  ]
}
```

#### 3. 文本标记 (Text Marks)

**粗体 (bold)**
```json
{
  "type": "text",
  "marks": [{ "type": "bold" }],
  "text": "粗体文本"
}
```

**斜体 (italic)**
```json
{
  "type": "text",
  "marks": [{ "type": "italic" }],
  "text": "斜体文本"
}
```

**链接 (link)**
```json
{
  "type": "text",
  "marks": [
    {
      "type": "link",
      "attrs": { "href": "https://example.com", "target": "_blank" }
    }
  ],
  "text": "链接文本"
}
```

**组合标记**
```json
{
  "type": "text",
  "marks": [
    { "type": "bold" },
    { "type": "italic" }
  ],
  "text": "粗斜体文本"
}
```

#### 4. 无序列表 (bulletList)

```json
{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "第一项" }]
        }
      ]
    },
    {
      "type": "listItem",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "第二项" }]
        }
      ]
    }
  ]
}
```

#### 5. 有序列表 (orderedList)

```json
{
  "type": "orderedList",
  "content": [
    {
      "type": "listItem",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "第一步" }]
        }
      ]
    },
    {
      "type": "listItem",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "第二步" }]
        }
      ]
    }
  ]
}
```

#### 6. 图片 (image)

图片必须使用 `/assets/:id` 格式的路径：

```json
{
  "type": "image",
  "attrs": {
    "src": "/assets/image_abc123",
    "alt": "图片描述文本",
    "title": "图片标题（可选）"
  }
}
```

**重要提示**：
- 图片 `src` 必须使用 `/assets/:id` 格式
- 需要先上传图片到资源管理系统获取 ID
- 不支持外部 URL（如 `https://...`）

#### 7. 引用块 (blockquote)

```json
{
  "type": "blockquote",
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "这是一段引用文本。" }]
    }
  ]
}
```

#### 8. 代码块 (codeBlock)

```json
{
  "type": "codeBlock",
  "attrs": { "language": "javascript" },
  "content": [
    { "type": "text", "text": "const message = 'Hello, World!';\nconsole.log(message);" }
  ]
}
```

#### 9. 水平分隔线 (horizontalRule)

```json
{
  "type": "horizontalRule"
}
```

### 完整示例

一个包含多种节点类型的完整文章：

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "探访《你的名字》取景地" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "《你的名字》是新海诚导演的代表作，电影中的" },
        { "type": "text", "marks": [{ "type": "bold" }], "text": "飞騨古川" },
        { "type": "text", "text": "成为了无数粉丝向往的圣地。" }
      ]
    },
    {
      "type": "image",
      "attrs": {
        "src": "/assets/hida_furukawa_station",
        "alt": "飞騨古川站全景"
      }
    },
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "主要取景地" }]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "content": [
                { "type": "text", "marks": [{ "type": "bold" }], "text": "飞騨古川站：" },
                { "type": "text", "text": "电影开场的火车站原型" }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "content": [
                { "type": "text", "marks": [{ "type": "bold" }], "text": "气多若宫神社：" },
                { "type": "text", "text": "三叶家神社的取景地" }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "content": [
                { "type": "text", "marks": [{ "type": "bold" }], "text": "飞騨市图书馆：" },
                { "type": "text", "text": "瀧寻找三叶的图书馆场景" }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "交通指南" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "从名古屋出发，乘坐 JR 特急 Wide View 飞騨号约 2.5 小时可达。详细时刻表请查看" },
        {
          "type": "text",
          "marks": [
            {
              "type": "link",
              "attrs": { "href": "https://www.jreast.co.jp", "target": "_blank" }
            }
          ],
          "text": "JR 东日本官网"
        },
        { "type": "text", "text": "。" }
      ]
    },
    {
      "type": "blockquote",
      "content": [
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "marks": [{ "type": "bold" }], "text": "旅行小贴士：" },
            { "type": "text", "text": "建议购买 JR 高山北陆周游券，可以节省不少交通费用。" }
          ]
        }
      ]
    },
    {
      "type": "horizontalRule"
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "marks": [{ "type": "italic" }], "text": "最后更新：2026年2月" }
      ]
    }
  ]
}
```

---

## 错误码说明

### HTTP 状态码

| 状态码 | 说明 | 常见原因 |
|--------|------|---------|
| 200 | 成功 | 请求正常处理 |
| 400 | 请求参数错误 | 缺少必需字段、字段验证失败、格式错误 |
| 401 | 未认证 | 未登录或 Session 过期 |
| 403 | 无权限 | 非管理员用户 |
| 404 | 资源不存在 | 文章 ID 不存在 |
| 409 | 状态冲突 | 尝试编辑/提交不可操作状态的文章、slug 冲突 |
| 500 | 服务器错误 | 服务器内部错误，请联系管理员 |

### 常见错误消息

| 错误消息 | 出现场景 | 解决方法 |
|---------|---------|---------|
| `Unauthorized` | GET /api/ai/articles 未登录 | 确保携带有效的 Session Cookie |
| `Forbidden: Admin access required` | 非管理员用户 | 使用管理员邮箱登录 |
| `请先登录` | POST/PATCH/其他接口未登录 | 确保携带有效的 Session Cookie |
| `无权限` | 非管理员用户 | 使用管理员邮箱登录 |
| `标题不能为空` | title 字段为空或仅包含空白字符 | 提供有效的标题 |
| `参数错误` | 请求体验证失败 | 检查所有字段的类型和格式 |
| `至少需要更新一个字段` | PATCH 请求体为空 | 至少提供一个要更新的字段 |
| `slug 不允许修改` | PATCH 请求包含 slug 字段 | 移除 slug 字段 |
| `封面地址无效` | cover 字段格式不正确 | 使用 `/assets/:id` 格式 |
| `缺少 id` | Path 参数缺失 | 确保 URL 包含文章 ID |
| `未找到文章` | 文章 ID 不存在 | 检查文章 ID 是否正确 |
| `当前状态不可编辑` | 尝试编辑 in_review 或 published 状态 | 等待审核完成或撤回文章 |
| `只能提交草稿或已拒绝的文章` | 尝试提交非 draft/rejected 状态 | 确认文章状态 |
| `无法生成唯一 slug，请稍后重试` | Slug 冲突（极少见） | 稍后重试或修改标题 |

---

## 使用建议

### 典型工作流

1. **获取文章列表**
   ```bash
   GET /api/ai/articles?status=draft
   ```
   查看当前有哪些草稿文章。

2. **创建新草稿**
   ```bash
   POST /api/ai/articles
   ```
   提供标题、描述、标签等基础信息和内容。

3. **编辑草稿**
   ```bash
   PATCH /api/ai/articles/:id
   ```
   根据需要更新标题、内容、标签等字段。

4. **提交审核**
   ```bash
   POST /api/ai/articles/:id/submit
   ```
   完成编辑后提交给管理员审核。

5. **处理拒绝**
   - 如果文章被拒绝（status=rejected），检查 `rejectReason` 字段
   - 根据拒绝原因进行修改：`PATCH /api/ai/articles/:id`
   - 重新提交：`POST /api/ai/articles/:id/submit`

6. **查看发布状态**
   ```bash
   GET /api/ai/articles/:id
   ```
   检查文章是否已发布（status=published）。

### 内容格式建议

1. **同时提供 JSON 和 HTML**
   - 推荐同时提供 `contentJson` 和 `contentHtml`
   - `contentJson` 用于编辑器重新打开和编辑
   - `contentHtml` 用于后端渲染和显示（会经过安全过滤）

2. **图片处理**
   - 先上传图片到资源管理系统获取 `/assets/:id` 路径
   - 在 TipTap JSON 中使用该路径
   - 不要使用外部 URL

3. **文本标记**
   - 合理使用粗体突出重点
   - 适当使用链接引用外部资源
   - 保持文本可读性

### SEO 优化建议

1. **标题优化**
   - `title`：简洁明了的文章标题（30-60 字符）
   - `seoTitle`：优化的 SEO 标题（包含关键词，50-60 字符）

2. **描述优化**
   - `description`：简明扼要的文章摘要（150-160 字符）
   - 包含主要关键词
   - 吸引读者点击

3. **标签使用**
   - `tags`：3-8 个相关标签
   - 包含动漫名称、地点、主题等
   - 有助于分类和搜索

4. **元数据完整性**
   - 尽量填写 `animeIds`、`city`、`routeLength` 等结构化数据
   - 有助于生成富媒体搜索结果

### 错误处理建议

1. **验证响应状态码**
   - 始终检查 HTTP 状态码
   - 4xx 错误：客户端问题，检查请求参数
   - 5xx 错误：服务器问题，稍后重试

2. **解析错误消息**
   - 错误响应包含 `error` 字段
   - 根据错误消息调整请求

3. **重试策略**
   - 对于 409（slug 冲突）错误，可以自动重试
   - 对于 401/403 错误，需要重新认证
   - 对于 500 错误，使用指数退避重试

### Session 管理建议

1. **Cookie 处理**
   - 从登录响应中提取 `next-auth.session-token` Cookie
   - 在所有请求的 Cookie header 中携带
   - Session 有效期通常为 30 天

2. **认证失败处理**
   - 收到 401 错误时，重新登录
   - 保持 Session 活跃（定期发送请求）

3. **安全建议**
   - 不要在日志中记录 Session Token
   - 使用 HTTPS 传输（生产环境）
   - 妥善保管管理员凭证

---

## 附录

### 字段长度限制

| 字段 | 最大长度 | 说明 |
|------|---------|------|
| title | 无硬性限制 | 建议 30-60 字符 |
| seoTitle | 120 字符 | SEO 优化标题 |
| description | 320 字符 | 文章描述/摘要 |
| language | 10 字符 | 语言代码，最小 2 字符 |
| cover | 512 字符 | 封面图片路径 |
| slug | 无硬性限制 | 自动生成，不可修改 |

### 相关资源

- **TipTap 官方文档**：https://tiptap.dev/docs
- **Auth.js 文档**：https://authjs.dev
- **Next.js API Routes 文档**：https://nextjs.org/docs/app/building-your-application/routing/route-handlers

### 技术支持

如有问题，请联系系统管理员或查阅项目文档。

---

**最后更新：2026年2月3日**
