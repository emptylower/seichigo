# SeichiGo 文章优化总手册（给 AI 写作助手）

更新时间：2026-02-07  
用途：将本手册作为唯一参考文档，指导 AI 对“已有草稿”进行结构优化、内容润色与网站样式增添，并确保可发布。

---

## 1. 数据来源与样本边界

### 1.1 抓取来源
- API：`https://seichigo.com/api/ai`
- 列表接口：`GET /api/ai/articles?status=published&language=zh`
- 详情接口：`GET /api/ai/articles/:id`
- 抓取日期：2026-02-07

### 1.2 样本范围（已发布中文 3 篇）
1. `cmkj44gvj00036ffyj0xkn4u9`  
   标题：`《你的名字》圣地巡礼 Part 3 ｜从飞驒到诹访`  
   发布时间：`2026-01-18T08:16:37.574Z`
2. `cmkhtjwh00001lom1qnr8c7x9`  
   标题：`《你的名字 》圣地寻礼 part2 | 东京 · 港区篇`  
   发布时间：`2026-01-17T06:41:20.715Z`
3. `cmj7xm9ei00019gdl6crx969m`  
   标题：`《你的名字 》 圣地寻礼  part1 |  东京 · 新宿篇`  
   发布时间：`2026-01-12T11:41:00.152Z`

### 1.3 原始文件位置（可回溯）
- 总目录：`doc/template-source/2026-02-07`
- 每篇文章都包含：
  - `list-item.json`
  - `detail.json`
  - `content.json`
  - `content.html`
  - `public-page.html`

---

## 2. 样本统计结论（用于定标）

以下统计来自 3 篇样本的正文 HTML（去标签文本 + 标签计数）：

- 平均字数（去标签）：`2902.67`
- 平均段落数 `<p>`：`62`
- 平均二级标题 `<h2>`：`4`
- 平均图片 `<img>`：`38.33`
- 平均无序列表 `<ul>`：`2.67`
- 平均列表项 `<li>`：`7`
- 平均表格 `<table>`：`1`
- 平均提示块 `<seichi-callout>`：`3.33`

### 2.1 高频章节
- `路线总览 (Route Overview)`（2/3）
- `结语`（2/3）

### 2.2 样本共同模式
- 一定有“路线信息汇总块”（总览/贴士/路线表）。
- 主体是“分站点推进”的连续叙述（多用 H3 编号）。
- 结尾有“总结 + 下一步建议”。
- 图文密度高，且图片常与提示块并用。

---

## 3. 目标成稿结构（AI 必须优先遵循）

### 3.1 元信息结构

```json
{
  "title": "《作品名》圣地巡礼 Part N｜城市/区域",
  "seoTitle": "作品名圣地巡礼｜城市路线全攻略（交通/机位/时间）",
  "description": "80-140 字摘要：路线范围、核心场景、读者收益",
  "language": "zh",
  "animeIds": ["作品ID"],
  "city": "城市或多城市组合",
  "routeLength": "半日 / 一日 / 两日半",
  "tags": ["作品名", "圣地巡礼", "城市", "地标1", "地标2"]
}
```

约束建议：
- `description`：80-140 字。
- `tags`：8-12 个，覆盖作品词/城市词/场景词。
- `routeLength`：必须是可执行时长表达。

### 3.2 正文结构

固定顺序建议：
1. `H2` 路线总览（Route Overview）
2. 站点章节（建议 5-8 个 `H3`）
3. 跨城转场段（多城市时必有）
4. `H2` 结语

每个站点章节固定写法：
- 场景对应（动画镜头 vs 现实位置）
- 到达方式（车站/出口/步行时长）
- 取景建议（机位/时段/方向）
- 实地提示（人流/拍摄礼仪/风险）
- 2-6 张图（至少 1 张全景）

---

## 4. 网站发布样式规范（AI 生成 HTML 时必须兼容）

### 4.1 页面外层结构（站点文章页）

```html
<div class="mx-auto w-full max-w-7xl px-6 lg:px-10" data-layout-wide="true">
  <div class="flex items-start gap-12">
    <main class="min-w-0 flex-1 pb-24">
      <article class="prose prose-pink max-w-none w-full" data-seichi-article-content="true">
        <!-- not-prose 面包屑 -->
        <!-- h1 -->
        <!-- PostMeta -->
        <!-- 正文 contentHtml -->
      </article>
    </main>
  </div>
</div>
```

### 4.2 关键排版参数（来自全局样式）
- `h1`: 1.875rem / 700 / margin 1.25rem 0 0.75rem
- `h2`: 1.5rem / 700 / margin 1.1rem 0 0.6rem
- `h3`: 1.25rem / 700 / margin 1rem 0 0.5rem
- `p`: margin 0.5rem 0
- `blockquote`: 左边框 4px 粉色 + 灰色正文
- `pre/code`: 灰底圆角
- `a`: 品牌粉色（brand-600/700）

### 4.3 富文本组件约定
- 图片：`figure > img + figcaption`
- 提示框：`<seichi-callout>...</seichi-callout>`
- 路线卡：`<seichi-route data-id="..."></seichi-route>`
- 路线总览：优先使用 `<table>`

---

## 5. 可用 HTML 白名单（严守）

### 5.1 允许标签
- `h1 h2 h3 p br blockquote strong em u s del code span div`
- `ul ol li a`
- `table thead tbody tr th td`
- `pre`
- `img figure figcaption`
- `seichi-route seichi-callout`

### 5.2 链接与图片安全约束
- 链接协议仅允许：`http https mailto`（或站内相对路径）。
- 图片 `src` 允许：
  - `https://...`
  - `/assets/<id>`（可带 `?w=&q=`）
- 禁止脚本相关标签与事件属性。

### 5.3 关键属性（常用）
- 块级对齐与缩进：`data-align`, `data-indent`
- 图片与裁切：`data-rotate`, `data-flip-x`, `data-flip-y`, `data-crop-*`
- figure 宽度：`data-width-pct`
- route：`data-id`

---

## 6. AI 改稿执行流程（针对“已有草稿”）

### 6.1 输入
- 现有草稿元信息（title/seoTitle/description/tags/city/routeLength/animeIds）
- 现有正文（`contentHtml` 或 `contentJson`）

### 6.2 执行步骤
1. 结构诊断  
检查是否缺少：路线总览、站点分节、转场（如需）、结语。
2. 元信息修正  
补齐并规范 `seoTitle/description/tags/routeLength`。
3. 内容增强  
按“站点固定写法”补齐可执行信息（交通、机位、提示）。
4. 样式增添  
在不破坏语义的前提下加入 `table/figure/figcaption/seichi-callout`。
5. 合规校验  
剔除白名单外标签与属性，确保可被服务端 sanitize 保留。
6. 可发布检查  
按第 9 节检查清单逐项通过后输出。

### 6.3 禁止行为
- 不得引入未允许标签（如 `video`, `iframe`, `script`, `hr`）。
- 不得生成空洞口号式段落（必须含可执行信息）。
- 不得删除已有有效信息（除非重复或明显错误）。

---

## 7. AI 输出格式（固定）

AI 每次改稿必须输出 4 段：

1. `修订后元信息 JSON`  
2. `修订后 contentHtml`  
3. `修改说明`（逐条说明改了什么、为什么）  
4. `发布前检查清单结果`（通过/不通过 + 原因）

建议附加：
- `可选：修订后 contentJson`（若工作流需要）

---

## 8. 可直接复制给 AI 的指令模板

```text
你是 SeichiGo 的文章优化编辑器。请严格根据《SeichiGo 文章优化总手册》执行改稿。

任务目标：
1) 优化现有草稿的结构完整度与信息密度；
2) 增添与站点一致的发布样式（table / figure / seichi-callout 等）；
3) 保证输出 HTML 在白名单内，可被服务端净化后保留。

硬性要求：
- 必须包含“路线总览”与“结语”；
- 站点章节按“场景对应/到达方式/机位建议/实地提示”组织；
- description 控制在 80-140 字；
- tags 建议 8-12 个；
- 不得使用白名单外标签或协议。

请按以下格式输出：
1. 修订后元信息 JSON
2. 修订后 contentHtml
3. 修改说明（列表）
4. 发布前检查清单结果
```

---

## 9. 发布前检查清单（最终门禁）

- `title / seoTitle / description / tags / routeLength` 全部存在且合理。
- 首屏 300 字内出现：作品名 + 城市 + 路线收益。
- 存在路线总览块，且建议包含表格。
- 站点章节具备可执行信息（交通/机位/注意事项）。
- 至少有一个结语段，给出下一步建议。
- HTML 不含白名单外标签与属性。

---

## 10. 仓库实现依据（审计锚点）

- 页面结构：`app/(site)/posts/[slug]/page.tsx`
- 元信息展示：`components/blog/PostMeta.tsx`
- 全局样式：`styles/globals.css`
- 富文本净化：`lib/richtext/sanitize.ts`
- 字体白名单：`lib/richtext/fonts.ts`

