此目录用于存放中文文章（MDX）。

建议前言 Frontmatter 字段：

```
---
title: 文章标题
slug: url-slug
animeId: 对应作品 id（如 btr、hibike）
city: 主要城市
routeLength: 半日/一日
language: zh
tags: ["示例标签"]
publishDate: 2025-01-01
status: published
---
```

正文可直接书写 Markdown/MDX，支持组件：

```
<Callout type="note">小提示</Callout>

<SpotList spots={[
  { order: 1, name: "示例地点 A", animeScene: "EP01 xx:xx", note: "注意事项", googleMapsUrl: "https://maps.google.com" },
  { order: 2, name: "示例地点 B" }
]} />
```

提示：slug 应与文件名一致更便于管理（如 `btr-shimokitazawa.mdx`）。

