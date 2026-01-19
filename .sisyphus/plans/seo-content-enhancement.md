# SEO 内容端增强计划

> **创建时间**: 2025-01-19
> **状态**: 待实施
> **预计工期**: 2 周

---

## 📋 目标概述

根据 SEO 顾问建议，对 SeichiGo 网站进行内容端增强，实现：

1. **城市/区域 Hub 页面** — 让用户按城市维度发现内容，承接长尾词
2. **链接资产页** — 创建可被外链引用的"资源型页面"
3. **文章模板标准化** — 让每篇路线文章天然承接 Google 长尾词
4. **国际化基础** — 为英文 SEO 铺好技术底座

---

## 🏗️ Phase 1: 城市/区域 Hub 页面

### 1.1 新增文件清单

| 文件路径 | 用途 | 优先级 |
|----------|------|--------|
| `content/city/tokyo.json` | 东京城市元数据 | P0 |
| `content/city/kyoto.json` | 京都城市元数据 | P1 |
| `lib/city/types.ts` | City 类型定义 | P0 |
| `lib/city/getAllCities.ts` | 读取所有城市数据 | P0 |
| `lib/city/getCityById.ts` | 按 ID 获取单个城市 | P0 |
| `app/(site)/city/page.tsx` | 城市索引页 | P0 |
| `app/(site)/city/[id]/page.tsx` | 单城市 Hub 页 | P0 |
| `components/city/CityCard.tsx` | 城市卡片组件 | P0 |

### 1.2 数据 Schema

**`lib/city/types.ts`**:
```typescript
export type CityArea = {
  id: string
  name_zh: string
  name_en?: string
  name_ja?: string
}

export type City = {
  id: string
  name_zh: string
  name_en?: string
  name_ja?: string
  description_zh?: string
  description_en?: string
  areas?: CityArea[]
  cover?: string
  transportTips_zh?: string
  transportTips_en?: string
}
```

**`content/city/tokyo.json`** 示例:
```json
{
  "id": "tokyo",
  "name_zh": "东京",
  "name_en": "Tokyo",
  "name_ja": "東京",
  "description_zh": "东京圣地巡礼路线汇总——从新宿到台场，覆盖热门动漫取景地。",
  "description_en": "Tokyo anime pilgrimage routes — from Shinjuku to Odaiba.",
  "areas": [
    { "id": "shinjuku", "name_zh": "新宿", "name_en": "Shinjuku" },
    { "id": "shibuya", "name_zh": "涩谷", "name_en": "Shibuya" },
    { "id": "minato", "name_zh": "港区", "name_en": "Minato" }
  ],
  "cover": "/images/city/tokyo-cover.jpg",
  "transportTips_zh": "推荐使用 Suica/Pasmo，东京地铁一日券也很划算。",
  "transportTips_en": "Use Suica/Pasmo. Tokyo Metro 24-hour pass is great value."
}
```

### 1.3 页面功能规格

**`/city` 索引页**:
- [ ] 列出所有城市卡片（封面 + 名称 + 文章数量）
- [ ] 按文章数排序
- [ ] SEO: `title: "城市索引 | SeichiGo"`, `description: "按城市浏览..."`
- [ ] Metadata + OpenGraph 配置

**`/city/[id]` Hub 页**:
- [ ] 城市头图 + 名称 + 简介
- [ ] 区域快速导航（锚点跳转）
- [ ] 该城市下所有文章列表（按 `p.city === cityId` 筛选）
- [ ] 交通小贴士区块
- [ ] JSON-LD: `Place` + `BreadcrumbList`
- [ ] 面包屑导航：首页 → 城市 → [城市名]

### 1.4 Sitemap 更新

修改 `app/sitemap.ts`:
```typescript
import { getAllCities } from '@/lib/city/getAllCities'

// 在 sitemap() 函数中添加
const cities = await getAllCities().catch(() => [])
for (const c of cities) {
  items.push({
    url: `${base}/city/${encodeURIComponent(c.id)}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  })
}
```

---

## 🔗 Phase 2: 链接资产页

### 2.1 新增文件清单

| 文件路径 | 用途 | 优先级 |
|----------|------|--------|
| `content/link-assets/pilgrimage-map.json` | 通用巡礼地图配置 | P0 |
| `content/link-assets/pilgrimage-etiquette.json` | 巡礼礼仪配置 | P0 |
| `lib/linkAsset/types.ts` | LinkAsset 类型定义 | P0 |
| `lib/linkAsset/getAllLinkAssets.ts` | 读取所有资产 | P0 |
| `lib/linkAsset/getLinkAssetById.ts` | 按 ID 获取单个资产 | P0 |
| `lib/linkAsset/aggregateSpots.ts` | 聚合点位数据 | P0 |
| `app/(site)/resources/page.tsx` | 资产索引页 | P0 |
| `app/(site)/resources/[id]/page.tsx` | 单资产页 | P0 |
| `components/resources/MapAssetView.tsx` | 地图型资产渲染 | P0 |
| `components/resources/ChecklistAssetView.tsx` | 清单型资产渲染 | P1 |
| `components/resources/EtiquetteAssetView.tsx` | 礼仪型资产渲染 | P0 |

### 2.2 数据 Schema

**`lib/linkAsset/types.ts`**:
```typescript
export type LinkAssetType = 'map' | 'checklist' | 'etiquette' | 'guide'

export type AggregatedSpot = {
  name_zh: string
  name_en?: string
  name_ja?: string
  googleMapsUrl?: string
  lat?: number
  lng?: number
  fromArticle?: string  // 来源文章 slug
  animeIds?: string[]
  city?: string
  photoTip?: string
}

export type LinkAsset = {
  id: string
  type: LinkAssetType
  title_zh: string
  title_en?: string
  description_zh?: string
  description_en?: string
  
  // 过滤条件（用于动态聚合）
  filterByAnimeIds?: string[]
  filterByCities?: string[]
  filterByTags?: string[]
  
  // 静态内容（礼仪/指南类）
  content_zh?: string  // Markdown
  content_en?: string
  
  // 手动指定的相关文章
  relatedPosts?: string[]
  
  // SEO
  seoTitle_zh?: string
  seoTitle_en?: string
  seoDescription_zh?: string
  seoDescription_en?: string
  
  cover?: string
  publishDate?: string
  updatedDate?: string
}
```

### 2.3 点位聚合逻辑

**`lib/linkAsset/aggregateSpots.ts`** 实现思路:
```typescript
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'

export async function aggregateSpots(options: {
  filterByAnimeIds?: string[]
  filterByCities?: string[]
}): Promise<AggregatedSpot[]> {
  // 1. 获取所有已发布文章
  const posts = await getAllPublicPosts('zh')
  
  // 2. 过滤符合条件的文章
  const filtered = posts.filter(p => {
    if (options.filterByAnimeIds?.length) {
      if (!p.animeIds.some(id => options.filterByAnimeIds!.includes(id))) return false
    }
    if (options.filterByCities?.length) {
      if (!options.filterByCities.includes(p.city)) return false
    }
    return true
  })
  
  // 3. 从每篇文章提取点位
  const spots: AggregatedSpot[] = []
  for (const p of filtered) {
    // 需要读取文章 contentJson 并提取路线
    // extractSeichiRouteEmbedsFromTipTapJson(...)
  }
  
  // 4. 去重并返回
  return spots
}
```

### 2.4 页面功能规格

**`/resources` 索引页**:
- [ ] 资产卡片网格（封面 + 标题 + 类型徽章）
- [ ] 分类 Tab：全部 / 地图 / 清单 / 礼仪
- [ ] SEO: `title: "巡礼资源 | SeichiGo"`

**`/resources/[id]` 资产页**:
- [ ] 根据 `type` 渲染不同视图
- [ ] `map`: 全屏地图 + 点位列表 + 相关文章链接
- [ ] `checklist`: 可复制清单 + 打印友好样式
- [ ] `etiquette`: 富文本内容 + 图文并茂
- [ ] JSON-LD: `ItemList` (带所有 Place) + `BreadcrumbList`
- [ ] 社交分享优化：专属 OG 图

### 2.5 Sitemap 更新

```typescript
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'

const linkAssets = await getAllLinkAssets().catch(() => [])
for (const asset of linkAssets) {
  items.push({
    url: `${base}/resources/${encodeURIComponent(asset.id)}`,
    changeFrequency: 'monthly',
    priority: 0.7,
  })
}
```

---

## 📝 Phase 3: 文章模板标准化

### 3.1 扩展 Frontmatter Schema

修改 `lib/mdx/types.ts`:

```typescript
export type TldrInfo = {
  duration?: string        // "半日" | "一日" | "2-3小时"
  startPoint?: string      // 起点名称
  endPoint?: string        // 终点名称
  totalSpots?: number      // 点位数
  transport?: string       // "地铁+步行" | "全程步行"
  estimatedCost?: string   // "约 1500 日元"
}

export type TransportInfo = {
  icCard?: string          // "Suica / Pasmo"
  lines?: string[]         // ["JR山手线", "东京Metro丸之内线"]
  tips?: string[]          // ["新宿站东口出发最方便"]
}

export type PostFrontmatter = {
  // === 现有字段 ===
  title: string
  seoTitle?: string
  description?: string
  slug: string
  animeId: string
  city: string
  areas?: string[]
  routeLength?: string
  language?: string
  tags?: string[]
  publishDate?: string
  updatedDate?: string
  status?: 'published' | 'draft'
  
  // === 新增结构化字段 ===
  tldr?: TldrInfo
  transportation?: TransportInfo
  photoTips?: string[]
  
  // === 国际化支持 ===
  title_en?: string
  description_en?: string
  seoTitle_en?: string
}
```

### 3.2 新增 MDX 组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `<TldrBox>` | `components/content/TldrBox.tsx` | 文章顶部快速概览卡片 |
| `<TransportCard>` | `components/content/TransportCard.tsx` | 交通信息块 |
| `<PhotoTipsList>` | `components/content/PhotoTipsList.tsx` | 拍摄建议列表 |

**TldrBox 渲染效果**:
```
┌─────────────────────────────────────────┐
│ TL;DR                                    │
│ ⏱ 半日  📍 5 个点位  🚃 地铁+步行        │
│ 🚩 新宿站东口 → 须贺神社                  │
│ 💴 约 1500 日元                          │
└─────────────────────────────────────────┘
```

### 3.3 更新 MDX 组件注册

修改 `lib/mdx/mdxComponents.tsx`:
```typescript
import TldrBox from '@/components/content/TldrBox'
import TransportCard from '@/components/content/TransportCard'
import PhotoTipsList from '@/components/content/PhotoTipsList'

export const mdxComponents = {
  SpotList,
  Callout,
  TldrBox,        // 新增
  TransportCard,  // 新增
  PhotoTipsList,  // 新增
  a: MdxLink,
  img: MdxImg,
}
```

### 3.4 更新文章模板

更新 `content/zh/posts/README.md` 为标准化模板（见附录 A）。

### 3.5 现有文章升级指导

**升级检查清单** (适用于现有 3 篇《你的名字》文章):

| 检查项 | 说明 |
|--------|------|
| ✅ 添加 `tldr` 块 | 从正文提取：路程时长、点位数、起终点 |
| ✅ 添加 `transportation` 块 | 从正文提取：推荐IC卡、线路、小贴士 |
| ✅ 添加 `photoTips` 数组 | 从正文提取：各点位的拍摄建议 |
| ✅ 补充 `areas` 字段 | 如 `["shinjuku", "yotsuya"]` |
| ✅ 确保 `description` 包含长尾关键词 | 如 "圣地巡礼"、"取景地"、"路线" |

**Frontmatter 升级示例**:
```yaml
# 在现有 frontmatter 基础上添加
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
  tips: ["新宿站东口出发最方便"]

photoTips:
  - "须贺神社阶梯清晨光线最佳"
  - "新宿御苑需购票入园"
```

---

## 🌍 Phase 4: 国际化基础

### 4.1 路由结构方案

采用 **路由组** 方案:

```
app/
├── (site)/              # 中文站（现有）
│   ├── page.tsx
│   ├── anime/
│   ├── city/            # 新增
│   ├── resources/       # 新增
│   └── posts/[slug]/
│
├── (site-en)/           # 英文站（新增）
│   ├── layout.tsx       # lang="en"
│   ├── page.tsx
│   ├── anime/
│   ├── city/
│   ├── resources/
│   └── posts/[slug]/
```

### 4.2 新增/修改文件清单

| 文件路径 | 用途 | 优先级 |
|----------|------|--------|
| `app/(site-en)/layout.tsx` | 英文站 layout | P0 |
| `app/(site-en)/page.tsx` | 英文首页 | P0 |
| `app/(site-en)/anime/page.tsx` | 英文作品索引 | P1 |
| `app/(site-en)/anime/[id]/page.tsx` | 英文作品 Hub | P1 |
| `app/(site-en)/city/page.tsx` | 英文城市索引 | P1 |
| `app/(site-en)/city/[id]/page.tsx` | 英文城市 Hub | P1 |
| `app/(site-en)/resources/page.tsx` | 英文资产索引 | P1 |
| `app/(site-en)/resources/[id]/page.tsx` | 英文资产页 | P1 |
| `app/(site-en)/posts/[slug]/page.tsx` | 英文文章页 | P1 |
| `lib/i18n/locale.ts` | locale 工具函数 | P0 |
| `lib/i18n/translations.ts` | UI 文案翻译 | P0 |
| `content/en/posts/` | 英文文章目录 | P1 |

### 4.3 hreflang 实现

在每个 `generateMetadata` 中添加:

```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  const siteOrigin = getSiteOrigin()
  const slug = (await params).slug
  
  return {
    // ...现有字段
    alternates: {
      canonical: `/posts/${slug}`,
      languages: {
        'zh': `${siteOrigin}/posts/${slug}`,
        'en': `${siteOrigin}/en/posts/${slug}`,
        'x-default': `${siteOrigin}/posts/${slug}`,
      },
    },
  }
}
```

### 4.4 Sitemap 更新（多语言）

```typescript
// 中英文文章都加入 sitemap，并设置 alternates
for (const p of postsZh) {
  items.push({
    url: `${base}${p.path}`,
    lastModified: ...,
    alternates: {
      languages: {
        zh: `${base}${p.path}`,
        en: `${base}/en${p.path}`,
      },
    },
  })
}
```

### 4.5 lib/i18n 工具

**`lib/i18n/locale.ts`**:
```typescript
export type Locale = 'zh' | 'en'

export function getLocaleFromPath(pathname: string): Locale {
  return pathname.startsWith('/en') ? 'en' : 'zh'
}

export function localizedPath(path: string, locale: Locale): string {
  if (locale === 'en') {
    return path.startsWith('/en') ? path : `/en${path}`
  }
  return path.replace(/^\/en/, '')
}
```

**`lib/i18n/translations.ts`**:
```typescript
export const translations = {
  zh: {
    'nav.home': '首页',
    'nav.anime': '作品',
    'nav.city': '城市',
    'nav.resources': '资源',
    'common.readMore': '阅读更多',
    'common.openInMaps': '在 Google 地图打开',
    // ...
  },
  en: {
    'nav.home': 'Home',
    'nav.anime': 'Anime',
    'nav.city': 'Cities',
    'nav.resources': 'Resources',
    'common.readMore': 'Read More',
    'common.openInMaps': 'Open in Google Maps',
    // ...
  },
}

export function t(key: string, locale: Locale): string {
  return translations[locale][key] || key
}
```

---

## 📅 实施时间线

```
Week 1
├── Day 1-2: Phase 1 城市 Hub 基础
│   ├── lib/city/ 类型 + 读取函数
│   ├── content/city/tokyo.json
│   └── app/(site)/city/ 页面骨架
│
├── Day 2-3: Phase 2 链接资产页基础
│   ├── lib/linkAsset/ 类型 + 读取函数
│   ├── content/link-assets/*.json
│   └── app/(site)/resources/ 页面骨架
│
├── Day 3-4: Phase 4 国际化基础
│   ├── app/(site-en)/layout.tsx
│   ├── lib/i18n/ 工具
│   └── 各页面 generateMetadata 添加 hreflang
│
└── Day 4-5: Phase 3 文章模板升级
    ├── 扩展 PostFrontmatter 类型
    ├── 新增 TldrBox/TransportCard/PhotoTipsList
    └── 更新 README.md 模板

Week 2
├── Day 1-2: 完善城市 Hub
│   ├── CityCard 组件样式
│   ├── 城市页 JSON-LD (Place)
│   └── Sitemap 更新
│
├── Day 2-3: 完善链接资产页
│   ├── 点位聚合逻辑 aggregateSpots
│   ├── MapAssetView 地图渲染
│   ├── EtiquetteAssetView 礼仪内容
│   └── 资产页 JSON-LD (ItemList)
│
├── Day 3-4: 英文站页面
│   ├── 复制 (site) → (site-en) 调整
│   ├── 英文 UI 文案
│   └── Sitemap 多语言
│
└── Day 4-5: 测试 + 文档
    ├── SEO 审计脚本验证
    ├── 更新 AGENTS.md / README.md
    └── 文章升级指导文档
```

---

## ✅ 验收标准

### Phase 1 城市 Hub
- [ ] `/city` 页面正常渲染城市卡片
- [ ] `/city/tokyo` 页面显示该城市所有文章
- [ ] JSON-LD 包含 Place schema
- [ ] Sitemap 包含城市页面

### Phase 2 链接资产页
- [ ] `/resources` 页面正常渲染资产卡片
- [ ] `/resources/pilgrimage-map` 显示聚合地图
- [ ] `/resources/pilgrimage-etiquette` 显示礼仪内容
- [ ] JSON-LD 包含 ItemList schema

### Phase 3 文章模板
- [ ] TldrBox 组件正常渲染
- [ ] TransportCard 组件正常渲染
- [ ] PhotoTipsList 组件正常渲染
- [ ] MDX 文章可使用新组件

### Phase 4 国际化
- [ ] `/en/` 路由正常访问
- [ ] 页面 lang 属性正确（zh/en）
- [ ] hreflang alternates 正确输出
- [ ] Sitemap 包含多语言 alternates

---

## 📎 附录

### 附录 A: 更新后的文章模板

见 `content/zh/posts/README.md` 更新内容。

### 附录 B: 圣地巡礼礼仪指南内容大纲

见单独文件 `.sisyphus/plans/pilgrimage-etiquette-content.md`。

---

## 🔗 相关文件

- 现有 SEO 实现: `lib/seo/jsonld.ts`
- 现有 Sitemap: `app/sitemap.ts`
- 现有 Robots: `app/robots.ts`
- 现有作品 Hub: `app/(site)/anime/[id]/page.tsx`
- 现有点位组件: `components/content/SpotList.tsx`
