1. 产品概述
- 产品名称：SeichiGo
- 形态：
  - 静态为主 + 少量动态的内容网站（博客站）
  - 前端单一代码仓（Next.js App Router），一切配置皆在代码中（适合 AI agent）
- 一句话定位：
- “用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。”
- 关键理念：
  1. 内容为王：每篇文章都是“单作品/单线路”的深度图文攻略。
  2. 样式重要：整体审美要统一、有温度，偏“日系杂志风”。
  3. 工具轻量：网页不做复杂互动地图，导航交给 Google Maps；路线规划/打卡等重功能留给未来 App。
  4. Code-first：所有功能均通过代码与配置驱动，保证 AI 能 90% 代劳。

---
2. 目标 & 非目标
2.1 V1 目标
1. 搭建一个 可持续写作和扩展的博客系统：
  - 用 MDX 管理文章内容（支持富文本 + 组件）。
  - 有基本的文章分类/按作品索引能力。
2. 用 3–5 篇高质量的“单作品巡礼文章”跑通完整体验：
  - 用户从搜索或社媒进来 → 阅读文章 → 获取清晰的地点列表和谷歌地图链接 → 对【巡礼 + SeichiGo 品牌】留下印象。
3. 提供基础用户交互能力：
  - 评论区（Giscus）
  - 简单账号登录（为未来投稿/收藏等功能埋基础）
  - 投稿入口（形式可以是表单 + 简单后台审核）
4. 布好未来 App 的“认知基础”和入口：
  - 在站内合适位置预告 App 能力。
  - 为未来“在 App 中打开本路线”预留按钮位置（先放文案）。
2.2 非目标（V1 明确不做）
- 不做复杂 Web 地图交互（缩放、筛选、多图层等）。
- 不做行程编辑器/路线自动规划。
- 不做大型社区功能（关注/私信/点赞流）。
- 不做多端复杂后台（所有内容管理优先走 Git + MDX）。

---
3. 用户与使用场景
3.1 用户画像
1. 作品向圣地巡礼爱好者
  - 搜索“番名 + 圣地巡礼/取景地”进站。
  - 想知道：这部作品在现实中有哪些点、一天大概怎么安排。
2. 去日本旅游的轻度二次元游客
  - 对某几部作品感兴趣，但不一定是硬核巡礼玩家。
  - 想要一篇“读起来舒服 + 有基本行动指引”的文章。
3. 内容创作者 / Up 主
  - 想快速了解一部作品的圣地信息，用来拍视频 / 写文。
  - 有可能贡献自己的巡礼记录（投稿）。
3.2 典型场景
1. 用户搜「Bocchi the Rock 圣地巡礼」→ 进入 BTR 文章 → 收藏 + 把文中 Google Maps 链接保存到自己地图。
2. 用户看完文章 → 觉得 SeichiGo 写的靠谱 → 留邮箱/收藏站点 → 等 App。
3. 某位博主巡礼回来 → 通过投稿入口提交自己的一条线路与心得 → 由你编辑成正式文章发布。

---
4. 内容策略（重点）
4.1 内容单位
- Post（文章）：
  - 每篇对应「一个作品 × 一条线路/一个区域」为主。
  - 结构包含：
    1. Why：为什么值得巡这条路线/这部作品
    2. 一天的节奏（情绪向描述）
    3. 具体地点列表（包含谷歌地图链接）
    4. 礼仪与注意事项
    5. App 预告 + 行动引导
- Anime（作品标签）：
  - 结构：id、名称、别名、年份、简单简介。
  - 用作文章分类（按作品聚合文章）。
4.2 每篇文章的标准结构（用于 MDX 模板）
推荐在 MDX 中包含：
- Frontmatter（YAML/JSON）：
  - title：文章标题
  - slug：URL
  - animeId：关联作品
  - city：主要城市
  - routeLength：推荐用时（半日/一日等）
  - language：当前语言（先 zh）
  - tags：如 “下北泽”、“河堤”、“桥”等
  - publishDate / updatedDate
  - status：published / draft
- 正文章节（建议 H2/H3 结构）：
  1. ## 为什么是这条路线？
  2. ## 一天的节奏（早中晚情绪描述）
  3. ## 景点列表（内嵌 <SpotTable /> 或 <SpotCard /> 组件）
  4. ## 巡礼礼仪与注意事项
  5. ## 关于 SeichiGo & App 预告
- Spot 数据在文章中以组件形式出现：
  - 示例：
  - <SpotList
  spots={[
    {
      order: 1,
      name: "下北泽南口坡道",
      animeScene: "EP03 12:34 主角第一次鼓起勇气搭话",
      note: "建议站在坡顶向下拍，注意不要拍到民宅窗口",
      googleMapsUrl: "https://maps.google.com/..."
    },
    ...
  ]}
/>
Codex 完全可以根据 PRD 帮你生成 <SpotList />、<SpotCard /> 这些组件。

---
5. 信息架构（IA）
5.1 页面结构
- / – 首页
  - 最新文章列表（卡片）
  - 推荐作品区（按 Anime 分类）
  - App 预告区（简单 Banner）
  - 关于/订阅入口
- /posts/[slug] – 文章详情页
  - 基于 MDX 渲染
  - 顶部：标题、meta 信息（作品、城市、用时、发布日期）
  - 正文（章节 + 组件）
  - 底部：
    - 同作品其他文章推荐
    - 评论区（Giscus）
    - App 预告
- /anime – 作品索引页
  - 所有作品列表
  - 每个作品卡片显示：封面图/名称/已发布文章数
- /anime/[id] – 某作品聚合页
  - 作品简介
  - 相关文章列表
- /about – 关于 & App 预告页
  - 项目介绍
  - 作者介绍
  - App 愿景
  - 订阅/社群链接
- /submit – 投稿页
  - 投稿说明（期待什么样的内容、格式要求）
  - 投稿表单（详见功能部分）
- /auth/* – 登录/退出（NextAuth 流程）
  - 可以简化到只有一个“登录/登出”入口，跳转 NextAuth 内置页面。
5.2 导航结构
- 顶部导航：
  - Logo+SeichiGo
  - 导航项：文章（首页）、作品、关于、投稿、（未来 App）
  - 右上角：登录/用户头像
- 底部：
  - 简短版权
  - 社交/邮箱链接
  - 小字：“圣地巡礼请遵守当地法律与礼仪”等提醒

---
6. 功能需求（按模块）
6.1 内容展示 & 编辑（MDX）
- 所有文章存放于 content/posts/*.mdx
- 类似 content/anime/*.json 管理作品元数据（或用 TS 常量）
- 需要一个“Content Layer”：
  - 从文件系统读 MDX → 解析 frontmatter → 提供统一的 getAllPosts(), getPostBySlug() 等函数。
- 支持：
  - 代码高亮（可选）
  - 图片插入（本地或远程链接）
  - 自定义组件（如 <SpotList />、提示框组件）
6.2 评论系统（Giscus 集成）
- 使用 Giscus 作为评论组件：
  - 在 post/[slug] 底部插入 <Giscus />
  - 映射规则：根据文章 slug 作为 discussion key
- 评论登录由 GitHub 处理，你不维护用户密码。
- 配置：在仓库中有一个 giscus.config.ts 或 .env 来配置 repo、category 等。
6.3 账号系统（NextAuth + DB）
V1 目标：仅支持登录，暂不开放复杂用户中心；主要用于：
- 为投稿功能识别“是谁投稿的”。
- 为未来的收藏/个人页面预备基础。
实现建议：
- 使用 NextAuth.js：
  - Provider：GitHub & Email（未来再加 Google 等）
- 使用托管数据库（Supabase/Neon）存 User 表：
  - id, name, email, avatar, createdAt, updatedAt
- 前端：
  - Header 显示：未登录 → “登录”按钮；已登录 → 用户头像 + 下拉菜单（退出登录）。
6.4 投稿功能（Submission Flow）
V1 简化方案（尽量 code-first）：
- /submit 页面：
  - 仅对已登录用户显示投稿表单：
    - 基本字段：作品名 / 城市 / 标题建议 / 正文（支持 Markdown） / 参考链接（可以填自己社媒）
    - 提示：你会进行编辑和加工，不保证所有投稿都会发布。
  - 未登录则提示先登录。
- 后端：
  - /api/submissions 接口
  - 提交时在 DB 写入 Submission 表：
    - id, userId, title, animeName, city, contentMarkdown, references, status=pending, createdAt
- 审核：
  - V1 可以简单做一个内部管理页 /admin/submissions（加“仅管理员访问”保护）
  - 管理页列出所有 pending 投稿，展示 Markdown 渲染预览。
  - 管理员按钮：
    - “导出为 MDX 草稿”：AI/Codex 可以帮你写一个脚本，将数据库中的投稿转换为 content/posts/draft-xxx.mdx 文件。
    - “标记为 processed”。
这里不追求极致自动化，只要流程完全在代码和简单页面里，AI 就可以全部协助实现。
6.5 SEO & 分享
- 每篇文章：
  - 唯一 canonical URL
  - <title> = 作品名 + 圣地巡礼关键词 + 副标题
  - <meta description> 简要概括路线特色
  - Open Graph：封面图 + 标题 + 描述
- 使用 next-seo 或自写 <Head> 组件封装 SEO 逻辑。
- 文章页提供一键复制链接按钮（可放入分享组件）。

---
7. 技术架构 & 工程约定
7.1 技术栈
- 前端框架：Next.js App Router（TypeScript）
- 样式：Tailwind CSS（配合自定义 CSS 变量/设计系统）
- 内容：MDX 文件（文章） + TypeScript/JSON 数据（作品信息）
- Auth：NextAuth.js
- 数据库：Supabase/Neon 等托管 Postgres（通过 Prisma 或 Drizzle ORM）
- 评论：Giscus
- 部署：Vercel（适配 Next.js）
7.2 目录结构（建议）
/
  app/
    layout.tsx
    page.tsx              # 首页
    about/page.tsx
    anime/page.tsx
    anime/[id]/page.tsx
    posts/[slug]/page.tsx
    submit/page.tsx
    admin/submissions/page.tsx (管理员页，简单即可)
  components/
    layout/
      Header.tsx
      Footer.tsx
      SiteShell.tsx
    blog/
      PostCard.tsx
      PostList.tsx
      PostMeta.tsx
    content/
      SpotList.tsx
      Callout.tsx
    shared/
      Button.tsx
      Tag.tsx
      Avatar.tsx
  lib/
    mdx/
      getAllPosts.ts
      getPostBySlug.ts
    anime/
      getAllAnime.ts
    auth/
      authOptions.ts
    db/
      client.ts
  content/
    posts/
      btr-shimokitazawa.mdx
      hibike-uji-1day.mdx
    anime/
      btr.json
      hibike.json
  styles/
    globals.css
    tailwind.config.js
  prisma/ or drizzle/
    schema.ts (User, Submission)

---
8. 版本规划（非常具体）
V1.0（MVP 可上线版本）
必须实现：
1. Next.js + Tailwind 基本框架搭建。
2. MDX 内容系统 + 至少 3 篇示例文章。
3. 首页、文章详情页、作品索引页、关于页。
4. Giscus 评论集成。
5. NextAuth 登录（GitHub 即可）+ User 表。
6. 投稿页：登录 + 投稿表单 + Submission 表（可以先不做 admin UI，用数据库手查也行）。
7. 初步 SEO 配置（title / description / OG）。
V1.1（体验加强）
1. /admin/submissions 简易后台页（列表 + Mark as processed）。
2. Post 列表的作品/城市筛选（简单 Tag 过滤）。
3. 样式统一优化：
  - 定一个调色板 + 字体组合
  - 博客列表/详情的 spacing & typography 调整
4. About 页加 App 介绍 & 订阅入口（可用外部 newsletter 工具）。
V1.2（多语言 & 品牌加强）
1. 预留多语言结构（比如 content/zh、content/ja）。
2. Logo / 品牌视觉统一（AI 可以帮你设计基础 Logo & 配色）。
3. 增加“按城市浏览”页（简单列表，不做地图）。