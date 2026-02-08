# 固定文章模板（结构 + 网站发布样式）

> 基于 3 篇已发布中文文章实样提炼（见同目录抓取文件）。

## 一、固定元信息模板（发布前填写）

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

硬性建议：
- `description` 控制在 `80-140` 字。
- `tags` 建议 `8-12` 个，含“作品词 + 城市词 + 场景词”。
- `routeLength` 用可执行时间单位（半日/一日/两日半）。

## 二、固定正文结构模板（内容层）

样本均值（3 篇）：
- 正文字量约 `2900` 字（去标签后）
- 段落约 `62` 段
- 图片约 `38` 张（图文密集）
- 至少 1 个“路线总览”块 + 1 个“结语”块

推荐固定骨架：

1. `H2` 路线总览（Route Overview）  
- 路线范围（起点/终点）
- 推荐时长
- 交通主线（JR/地铁/步行）
- 难点与注意事项（人流、拍摄限制、坡道）
- 建议附 1 个路线表格（站点/取景点/停留时长）

2. `H3` 分站点叙述（建议 5-8 个）  
每个站点都按同一小结构写：
- 场景对应：动画镜头 vs 现实位置
- 到达方式：最近车站、出口、步行时长
- 取景建议：机位、时间段、镜头方向
- 实地提示：人流、光线、拍摄礼仪
- 配图：2-6 张（含 1 张全景 + 若干细节）

3. 转场段（多城市时必写）  
- 明确“从 A 到 B”的交通路径和时间成本。

4. `H2` 结语  
- 总结本条路线体验
- 给出下一篇路线衔接（Part N+1）
- 提供 1-2 条执行建议（最佳到访时段/备选点）

## 三、网站发布样式模板（展示层）

页面容器（站内文章页）：

```html
<div class="mx-auto w-full max-w-7xl px-6 lg:px-10" data-layout-wide="true">
  <div class="flex items-start gap-12">
    <main class="min-w-0 flex-1 pb-24">
      <article class="prose prose-pink max-w-none w-full" data-seichi-article-content="true">
        <!-- 面包屑 -->
        <div class="not-prose">...</div>
        <!-- H1 + Meta -->
        <h1>...</h1>
        <div class="text-sm text-gray-600">作品/城市/用时/发布</div>
        <!-- 正文 HTML -->
      </article>
    </main>
  </div>
</div>
```

核心排版（来自全局样式）：
- `h1`: `1.875rem`, `700`, 上下间距 `1.25rem/0.75rem`
- `h2`: `1.5rem`, `700`, 上下间距 `1.1rem/0.6rem`
- `h3`: `1.25rem`, `700`, 上下间距 `1rem/0.5rem`
- `p`: 上下间距 `0.5rem`
- `blockquote`: 左边框 `4px` 粉色 + 灰色正文
- `pre/code`: 灰底圆角（代码块与行内代码）
- 链接：品牌粉色（`brand-600`）

富文本组件风格约束：
- 图片用 `figure/img/figcaption` 组合，支持 `data-align` 与 `data-indent`
- 提示块用 `<seichi-callout>...</seichi-callout>`
- 路线卡可用 `<seichi-route data-id="..."></seichi-route>`
- 表格用于路线总览（`table/thead/tbody/tr/th/td`）

## 四、可直接复制的正文骨架（HTML）

```html
<h2>路线总览 (Route Overview)</h2>
<p>本次路线：起点 A → 终点 B，建议时长半日/一日。</p>
<table>
  <thead>
    <tr><th>站点</th><th>场景</th><th>建议停留</th></tr>
  </thead>
  <tbody>
    <tr><td>1</td><td>场景名称</td><td>20-30 分钟</td></tr>
    <tr><td>2</td><td>场景名称</td><td>30-45 分钟</td></tr>
  </tbody>
</table>

<h3>1. 站点标题</h3>
<p>动画镜头与现实场景对应描述。</p>
<p>交通：最近车站/出口 + 步行时间。</p>
<figure data-figure-image="true">
  <img src="/assets/xxx" alt="站点图" />
  <figcaption>机位说明</figcaption>
</figure>
<seichi-callout>
  <p>注意事项：拍摄礼仪/排队/人流高峰。</p>
</seichi-callout>

<h3>2. 站点标题</h3>
<p>重复同样结构直到最后一个站点。</p>

<h2>结语</h2>
<p>总结本次路线，给出下一条路线衔接与行动建议。</p>
```

## 五、发布前检查清单

- `title / seoTitle / description / tags` 已补齐。
- 首屏 300 字内出现“作品名 + 城市 + 路线收益”。
- 路线总览表存在，且站点顺序与正文一致。
- 每个站点至少 1 张图 + 1 条实地提示。
- 存在“结语”并给出下一步行动。
- HTML 仅使用可净化通过的标签与属性（避免自定义脚本与非白名单标签）。

## 六、样式依据（仓库实现）

- 文章页结构：`app/(site)/posts/[slug]/page.tsx`
- 元信息行样式：`components/blog/PostMeta.tsx`
- 全局排版与富文本样式：`styles/globals.css`
- 富文本净化白名单：`lib/richtext/sanitize.ts`
