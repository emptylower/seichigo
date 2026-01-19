此目录用于存放中文文章（MDX）。

建议前言 Frontmatter 字段（支持结构化 TL;DR/交通/拍摄建议）：

```
---
title: 文章标题
seoTitle: 用于 <title>（可选）
description: 用于 meta description（建议）
slug: url-slug
animeId: 对应作品 id（如 btr、hibike）
city: 主要城市
areas: ["可选区域 1", "可选区域 2"]
routeLength: 半日/一日
language: zh
tags: ["示例标签"]
publishDate: 2025-01-01
updatedDate: 2025-01-02
status: published

# 新增：文章顶部快速概览（可选）
tldr:
  duration: 半日
  startPoint: 起点
  endPoint: 终点
  totalSpots: 5
  transport: 地铁+步行
  estimatedCost: 约 1500 日元

# 新增：交通信息（可选）
transportation:
  icCard: Suica / Pasmo
  lines:
    - JR 山手线
    - Tokyo Metro
  tips:
    - 尽量避开 7-9 与 17-19 高峰

# 新增：拍摄建议（可选）
photoTips:
  - 建议清晨/黄昏拍摄
  - 私人住宅附近请勿打扰居民
---
```

正文可直接书写 Markdown/MDX，支持组件：

```
<TldrBox />

<TransportCard />

<PhotoTipsList />

<Callout type="note">小提示</Callout>

<SpotList spots={[
  { order: 1, name_zh: "示例地点 A", name_ja: "サンプルA", animeScene: "EP01 xx:xx", note: "注意事项", googleMapsUrl: "https://maps.google.com" },
  { order: 2, name_zh: "示例地点 B", googleMapsUrl: "https://maps.google.com" }
]} />
```

提示：slug 应与文件名一致更便于管理（如 `btr-shimokitazawa.mdx`）。
