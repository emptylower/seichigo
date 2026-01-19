# 文章模板升级指南

> **用途**: 更新 `content/zh/posts/README.md` 的内容
> **创建时间**: 2025-01-19
> **状态**: 待实施

---

## 新版文章模板

以下内容用于替换/更新现有的 `content/zh/posts/README.md`:

```markdown
# 路线文章写作模板

此目录用于存放中文文章（MDX）。

## Frontmatter 完整示例

---
title: 你的名字 · 新宿篇
seoTitle: 你的名字圣地巡礼新宿路线攻略 | SeichiGo
description: 从新宿御苑到须贺神社，重走瀧和三叶相遇的场景。包含完整路线地图、点位清单与拍摄建议。
slug: your-name-shinjuku
animeId: your-name
city: tokyo
areas: ["shinjuku", "yotsuya"]
routeLength: 半日
language: zh
tags: ["电影", "恋爱", "经典", "新海诚"]
publishDate: 2025-01-19
updatedDate: 2025-01-20
status: published

# ========== 新增结构化字段 ==========

# TL;DR 快速概览
tldr:
  duration: 半日           # "半日" | "一日" | "2-3小时"
  startPoint: 新宿御苑      # 起点名称
  endPoint: 须贺神社        # 终点名称
  totalSpots: 5            # 点位数
  transport: 地铁+步行      # "地铁+步行" | "全程步行" | "JR+步行"
  estimatedCost: 约 1500 日元  # 预估费用

# 交通信息
transportation:
  icCard: Suica / Pasmo
  lines:
    - 东京Metro丸之内线
    - JR中央线
  tips:
    - 新宿站东口出发最方便
    - 建议早上 8 点前到达须贺神社避开人流
    - 回程可从四谷站搭乘JR中央线

# 拍摄建议
photoTips:
  - 须贺神社阶梯清晨光线最佳，建议 7:00 前到达
  - 新宿御苑需购票入园（500日元），樱花季人多需排队
  - 瀧的公寓取景地为私人住宅，请勿打扰居民

# ========== 国际化支持（可选） ==========

title_en: "Your Name · Shinjuku Route"
description_en: "Trace Taki and Mitsuha's meeting places from Shinjuku Gyoen to Suga Shrine."
seoTitle_en: "Your Name Pilgrimage Shinjuku Route Guide | SeichiGo"
---

## 正文结构（推荐顺序）

### 1. TL;DR 快速概览

使用 TldrBox 组件自动从 frontmatter 读取：

<TldrBox />

或手动传入数据：

<TldrBox tldr={{
  duration: "半日",
  startPoint: "新宿御苑",
  endPoint: "须贺神社",
  totalSpots: 5,
  transport: "地铁+步行",
  estimatedCost: "约 1500 日元"
}} />

### 2. 路线地图

使用富文本编辑器插入 SeichiRoute 路线块，或使用 MDX SpotList：

<SpotList spots={[
  { 
    order: 1, 
    name_zh: "新宿御苑", 
    name_ja: "新宿御苑",
    nearestStation_zh: "新宿御苑前站",
    animeScene: "EP01 开场",
    photoTip: "正门入口拍摄",
    googleMapsUrl: "https://maps.google.com/?q=35.6852,139.7100" 
  },
  { 
    order: 2, 
    name_zh: "须贺神社", 
    name_ja: "須賀神社",
    nearestStation_zh: "四谷三丁目站",
    animeScene: "结尾重逢",
    photoTip: "阶梯正面，清晨光线最佳",
    googleMapsUrl: "https://maps.google.com/?q=35.6877,139.7213" 
  },
]} />

### 3. 拍摄建议

<PhotoTipsList />

或手动传入：

<PhotoTipsList tips={[
  "须贺神社阶梯清晨光线最佳",
  "新宿御苑需购票入园"
]} />

### 4. 交通指南

<TransportCard />

或手动传入：

<TransportCard transport={{
  icCard: "Suica / Pasmo",
  lines: ["东京Metro丸之内线", "JR中央线"],
  tips: ["新宿站东口出发最方便"]
}} />

### 5. 各点位详细内容

按顺序分节描述每个点位：

## 1. 新宿御苑

（点位描述、历史背景、动画对比截图、实拍照片...）

## 2. 须贺神社

（点位描述...）

### 6. 总结 / 作者碎碎念

（个人感想、额外建议...）

## 可用组件速查

| 组件 | 用途 | 示例 |
|------|------|------|
| `<TldrBox>` | 文章顶部快速概览 | `<TldrBox />` |
| `<TransportCard>` | 交通信息块 | `<TransportCard />` |
| `<PhotoTipsList>` | 拍摄建议列表 | `<PhotoTipsList />` |
| `<SpotList>` | 点位顺序表（带地图链接） | `<SpotList spots={[...]} />` |
| `<Callout>` | 提示框 | `<Callout type="note">小提示</Callout>` |

## Frontmatter 字段说明

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | ✅ | string | 文章标题 |
| `slug` | ✅ | string | URL slug，应与文件名一致 |
| `animeId` | ✅ | string | 作品 ID（如 your-name, btr） |
| `city` | ✅ | string | 城市 ID（如 tokyo, kyoto） |
| `seoTitle` | ❌ | string | SEO 标题，用于 <title> 标签 |
| `description` | ❌ | string | SEO 描述，建议 120-160 字符 |
| `areas` | ❌ | string[] | 区域列表，如 ["shinjuku", "yotsuya"] |
| `routeLength` | ❌ | string | 路程时长：半日/一日 |
| `tags` | ❌ | string[] | 标签列表 |
| `publishDate` | ❌ | string | 发布日期 YYYY-MM-DD |
| `updatedDate` | ❌ | string | 更新日期 YYYY-MM-DD |
| `status` | ❌ | string | published/draft，默认 published |
| `tldr` | ❌ | object | TL;DR 结构化数据 |
| `transportation` | ❌ | object | 交通结构化数据 |
| `photoTips` | ❌ | string[] | 拍摄建议列表 |

## SEO 最佳实践

1. **标题**：包含作品名 + 地点 + "圣地巡礼"
2. **描述**：包含路线概述、点位数、特色亮点
3. **slug**：使用英文，如 `your-name-shinjuku`
4. **areas**：尽量填写，便于城市 Hub 筛选
5. **photoTips**：提供具体可操作的建议

## 文件命名

建议 slug 与文件名保持一致：

- `your-name-shinjuku.mdx` → `slug: your-name-shinjuku`
- `btr-shimokitazawa.mdx` → `slug: btr-shimokitazawa`
```

---

## 现有文章升级检查清单

### 适用于：现有 3 篇《你的名字》文章

对于每篇文章，执行以下检查：

#### 1. Frontmatter 补充

- [ ] 确认 `areas` 字段已填写（如 `["shinjuku", "yotsuya"]`）
- [ ] 添加 `tldr` 结构化块
- [ ] 添加 `transportation` 结构化块
- [ ] 添加 `photoTips` 数组
- [ ] 确认 `description` 包含长尾关键词

#### 2. 正文结构调整

- [ ] 在正文开头添加 `<TldrBox />` 组件
- [ ] 确认有 SpotList 或 SeichiRoute 路线表
- [ ] 添加 `<TransportCard />` 交通信息块
- [ ] 添加 `<PhotoTipsList />` 拍摄建议块

#### 3. SEO 检查

- [ ] `seoTitle` 包含"圣地巡礼"关键词
- [ ] `description` 在 120-160 字符
- [ ] 正文有返回作品 Hub 的链接
- [ ] 正文有返回城市 Hub 的链接（待城市 Hub 上线后添加）

---

## Frontmatter 升级示例

假设现有文章 frontmatter 如下：

```yaml
---
title: 你的名字 · 新宿篇
slug: your-name-shinjuku
animeId: your-name
city: tokyo
routeLength: 半日
publishDate: 2025-01-15
status: published
---
```

升级后：

```yaml
---
title: 你的名字 · 新宿篇
seoTitle: 你的名字圣地巡礼新宿路线攻略 | SeichiGo
description: 从新宿御苑到须贺神社，重走瀧和三叶相遇的场景。包含完整路线地图、5个点位清单与拍摄建议。
slug: your-name-shinjuku
animeId: your-name
city: tokyo
areas: ["shinjuku", "yotsuya"]
routeLength: 半日
language: zh
tags: ["电影", "恋爱", "经典", "新海诚"]
publishDate: 2025-01-15
updatedDate: 2025-01-19
status: published

tldr:
  duration: 半日
  startPoint: 新宿御苑
  endPoint: 须贺神社
  totalSpots: 5
  transport: 地铁+步行
  estimatedCost: 约 1500 日元

transportation:
  icCard: Suica / Pasmo
  lines: ["东京Metro丸之内线", "JR中央线"]
  tips: 
    - 新宿站东口出发最方便
    - 建议早上 8 点前到达须贺神社避开人流

photoTips:
  - 须贺神社阶梯清晨光线最佳，建议 7:00 前到达
  - 新宿御苑需购票入园（500日元）
  - 瀧的公寓取景地为私人住宅，请勿打扰居民
---
```
