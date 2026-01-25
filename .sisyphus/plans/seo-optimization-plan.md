# SeichiGo SEO 优化计划

> 生成日期: 2026-01-24
> 审计范围: 线下代码 + 线上 seichigo.com
> 整体评分: 85/100 (良好，有优化空间)

---

## 一、现状总结

### 已完成的 SEO 基础设施

| 类别 | 项目 | 状态 | 实现位置 |
|------|------|------|----------|
| 技术 SEO | 动态 Sitemap | ✅ | `app/sitemap.ts` |
| 技术 SEO | robots.txt | ✅ | `app/robots.ts` |
| 技术 SEO | Canonical URLs | ✅ | 各页面 metadata |
| 技术 SEO | hreflang 多语言 | ✅ | `lib/seo/alternates.ts` |
| Meta 标签 | Title Template | ✅ | `app/layout.tsx` |
| Meta 标签 | OpenGraph | ✅ | 各页面 metadata |
| Meta 标签 | Twitter Cards | ✅ | 各页面 metadata |
| 结构化数据 | WebSite Schema | ✅ | `lib/seo/globalJsonLd.ts` |
| 结构化数据 | Organization Schema | ✅ | `lib/seo/globalJsonLd.ts` |
| 结构化数据 | BlogPosting Schema | ✅ | `lib/seo/jsonld.ts` |
| 结构化数据 | BreadcrumbList Schema | ✅ | `lib/seo/jsonld.ts` |
| 结构化数据 | ItemList (Place/Geo) | ✅ | `lib/seo/jsonld.ts` |
| 结构化数据 | TVSeries Schema | ✅ | `lib/seo/tvSeriesJsonLd.ts` |
| OG 图片 | 全站默认 OG 图 | ✅ | `app/opengraph-image.tsx` |
| OG 图片 | 文章动态 OG 图 | ✅ | `app/(site)/posts/[slug]/opengraph-image.tsx` |
| 工具 | SEO 审计脚本 | ✅ | `scripts/seo-audit.js` |

---

## 二、优化任务清单

### P0 - 高优先级 (本周完成)

#### TASK-001: 为 anime 页面添加动态 OG 图

**问题描述:**
anime 页面（如 `/anime/hibike`）使用全站默认 OG 图，而非该作品的封面图。社交分享时无法展示具体作品的吸引力。

**当前状态:**
```html
<meta property="og:image" content="https://seichigo.com/opengraph-image"/>
```

**期望状态:**
```html
<meta property="og:image" content="https://seichigo.com/anime/hibike/opengraph-image"/>
```

**实施方案:**

创建文件 `app/(site)/anime/[id]/opengraph-image.tsx`:

```tsx
import { ImageResponse } from 'next/og'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getSiteOrigin } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

function toAbsoluteUrl(input: string | null | undefined, base: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  try {
    return new URL(raw, base).toString()
  } catch {
    return null
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const anime = await getAnimeById(id).catch(() => null)
  
  const title = anime?.name || id
  const coverUrl = anime?.cover ? toAbsoluteUrl(anime.cover, getSiteOrigin()) : null
  const year = anime?.year

  return new ImageResponse(
    coverUrl ? (
      <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', backgroundColor: '#0b0b0f' }}>
        <img src={coverUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.25) 78%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.72) 100%)' }} />
        <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 72 }}>
          <div style={{ alignSelf: 'flex-start', fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.92)', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.14)', padding: '10px 16px', borderRadius: 999, marginBottom: 20 }}>
            <span style={{ color: '#f472b6' }}>SeichiGo</span>
          </div>
          <div style={{ maxWidth: 980, fontSize: 76, fontWeight: 800, lineHeight: 1.06, color: 'rgba(255,255,255,0.98)', textShadow: '0 2px 14px rgba(0,0,0,0.60)' }}>
            {title}
          </div>
          {year ? (
            <div style={{ fontSize: 32, marginTop: 18, color: 'rgba(255,255,255,0.88)' }}>
              {year} · 圣地巡礼
            </div>
          ) : null}
        </div>
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #ffffff 0%, #fff1f2 45%, #ffe4e6 100%)', padding: 72, justifyContent: 'center' }}>
        <div style={{ color: '#db2777', fontSize: 32, fontWeight: 700, marginBottom: 24 }}>SeichiGo</div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.08, color: '#111827' }}>{title}</div>
        <div style={{ fontSize: 30, color: '#6b7280', marginTop: 18 }}>圣地巡礼作品</div>
      </div>
    ),
    { ...size }
  )
}
```

同时更新 `app/(site)/anime/[id]/page.tsx` 的 generateMetadata:
```tsx
openGraph: {
  // ... existing
  images: [`/anime/${encodeAnimeIdForPath(canonicalId)}/opengraph-image`],
},
twitter: {
  // ... existing  
  images: [`/anime/${encodeAnimeIdForPath(canonicalId)}/twitter-image`],
},
```

**验收标准:**
- [ ] anime 页面分享到社交媒体时显示作品封面
- [ ] OG 图片包含作品名称和年份
- [ ] 无封面时显示渐变背景

**预计工作量:** 2 小时

---

#### TASK-002: 为 city 页面添加动态 OG 图

**问题描述:**
与 anime 页面相同，city 页面也使用全站默认 OG 图。

**实施方案:**
创建 `app/(site)/city/[id]/opengraph-image.tsx`，使用城市封面或地标图片。

**预计工作量:** 1.5 小时

---

#### TASK-003: Sitemap 添加 lastmod 给所有页面

**问题描述:**
当前只有文章页面 (`/posts/*`) 有 `lastmod`，其他页面缺失。

**当前状态 (app/sitemap.ts):**
```tsx
{ url: `${base}/anime`, changeFrequency: 'weekly', priority: 0.5 }
// 缺少 lastModified
```

**期望状态:**
```tsx
{ url: `${base}/anime`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 }
```

**实施方案:**

修改 `app/sitemap.ts`:

```tsx
// 静态页面添加 lastModified
const items: MetadataRoute.Sitemap = [
  { 
    url: `${base}/`, 
    lastModified: new Date(),
    changeFrequency: 'weekly', 
    priority: 0.8, 
    alternates: { languages: { zh: `${base}/`, en: `${base}/en` } } 
  },
  // ... 其他静态页面同理
]

// anime 动态页面 - 如果数据库有 updatedAt 字段，使用它
for (const a of anime) {
  items.push({
    url: zhUrl,
    lastModified: a.updatedAt ? new Date(a.updatedAt) : new Date(),
    changeFrequency: 'weekly',
    priority: 0.6,
    alternates: { languages: { zh: zhUrl, en: enUrl } },
  })
}

// city 和 resources 同理
```

**验收标准:**
- [ ] sitemap.xml 中所有 URL 都有 `<lastmod>` 标签
- [ ] Google Search Console 不报 sitemap 警告

**预计工作量:** 30 分钟

---

### P1 - 中优先级 (下周完成)

#### TASK-004: 文章页添加 x-default hreflang

**问题描述:**
文章页面 `/posts/*` 没有 hreflang 标签（因为暂无英文版），但应该添加 `x-default` 指向中文版。

**实施方案:**

修改 `app/(site)/posts/[slug]/page.tsx` 的 `generateMetadata`:

```tsx
alternates: {
  canonical: `/posts/${encodeSlugForPath(frontmatter.slug)}`,
  languages: {
    'x-default': `/posts/${encodeSlugForPath(frontmatter.slug)}`,
    zh: `/posts/${encodeSlugForPath(frontmatter.slug)}`,
  },
},
```

**验收标准:**
- [ ] 文章页面 HTML 包含 `<link rel="alternate" hreflang="x-default" ...>`
- [ ] 通过 hreflang 验证工具检测

**预计工作量:** 20 分钟

---

#### TASK-005: City 页面添加 Place Schema

**问题描述:**
city 页面（如 `/city/tokyo`）没有地理位置结构化数据。

**实施方案:**

1. 创建 `lib/seo/placeJsonLd.ts`:

```tsx
type JsonLdObject = Record<string, any>

export function buildCityJsonLd(input: {
  url: string
  name: string
  nameEn?: string
  country?: string
  description?: string
  imageUrl?: string
  latitude?: number
  longitude?: number
}): JsonLdObject {
  const out: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'City',
    name: input.name,
    url: input.url,
  }

  if (input.nameEn) out.alternateName = input.nameEn
  if (input.description) out.description = input.description
  if (input.imageUrl) out.image = input.imageUrl
  if (input.country) {
    out.containedInPlace = { '@type': 'Country', name: input.country }
  }
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    out.geo = {
      '@type': 'GeoCoordinates',
      latitude: input.latitude,
      longitude: input.longitude,
    }
  }

  return out
}
```

2. 在 city 页面中使用

**验收标准:**
- [ ] city 页面 HTML 包含 City Schema JSON-LD
- [ ] 通过 Google Rich Results Test 验证

**预计工作量:** 1 小时

---

#### TASK-006: 添加 FAQPage Schema (针对文章)

**问题描述:**
圣地巡礼攻略类文章可以利用 FAQ 结构化数据获取富媒体搜索结果。

**实施方案:**

1. 在文章 frontmatter 或数据库中添加 FAQ 字段
2. 创建 `lib/seo/faqJsonLd.ts`:

```tsx
export function buildFAQPageJsonLd(faqs: { question: string; answer: string }[]): JsonLdObject | null {
  if (!faqs.length) return null
  
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}
```

3. 常见 FAQ 示例:
   - "如何前往 XXX 圣地？"
   - "XXX 圣地巡礼最佳季节是什么时候？"
   - "巡礼 XXX 需要多长时间？"

**验收标准:**
- [ ] 文章页面可选择性渲染 FAQPage Schema
- [ ] Google Rich Results Test 显示 FAQ 富媒体预览

**预计工作量:** 2 小时

---

### P2 - 增强优化 (本月完成)

#### TASK-007: 增强图片 alt 文本

**问题描述:**
首页 hero 区域图片 alt 为通用文本 `"作品封面"`。

**实施方案:**
修改 `app/(site)/page.tsx`，使用具体的 anime 名称:
```tsx
alt={`${animeName} 作品封面`}
```

**预计工作量:** 30 分钟

---

#### TASK-008: 增强 BlogPosting Schema

**问题描述:**
当前 BlogPosting Schema 缺少一些可选但有价值的字段。

**实施方案:**
在 `lib/seo/jsonld.ts` 的 `buildBlogPostingJsonLd` 中添加:

```tsx
{
  wordCount: countWords(content),
  articleSection: '圣地巡礼',
  inLanguage: 'zh-CN',
}
```

**预计工作量:** 30 分钟

---

#### TASK-009: 添加 sameAs 社交媒体链接

**问题描述:**
Organization Schema 缺少社交媒体链接。

**实施方案:**
修改 `lib/seo/globalJsonLd.ts`:

```tsx
export function buildOrganizationJsonLd(): JsonLdObject {
  const origin = getSiteOrigin()
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'SeichiGo',
    url: origin,
    logo: `${origin}/brand/app-logo.png`,
    sameAs: [
      // 添加实际的社交媒体链接
      // 'https://twitter.com/seichigo',
      // 'https://github.com/seichigo',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'ljj231428@gmail.com',
    },
  }
}
```

**预计工作量:** 15 分钟

---

### P3 - 低优先级 (可选)

#### TASK-010: 添加 PWA Manifest

创建 `app/manifest.ts` 或 `public/manifest.json` 提升移动端体验。

#### TASK-011: 添加 Speakable 结构化数据

为语音助手优化关键内容段落。

#### TASK-012: 添加 SearchAction Schema

让用户可以直接从 Google 搜索框搜索站内内容。

---

## 三、验证与监控

### 工具清单

| 工具 | 用途 | 链接 |
|------|------|------|
| Google Search Console | 索引状态、性能监控 | https://search.google.com/search-console |
| Google Rich Results Test | 结构化数据验证 | https://search.google.com/test/rich-results |
| Schema Markup Validator | JSON-LD 验证 | https://validator.schema.org/ |
| PageSpeed Insights | Core Web Vitals | https://pagespeed.web.dev/ |
| 本地 SEO 审计 | 自建工具 | `npm run seo:audit` |

### 验证检查清单

每次部署后执行:

```bash
# 本地审计
npm run seo:audit -- --base-url https://seichigo.com

# 检查 sitemap
curl -s https://seichigo.com/sitemap.xml | head -50

# 检查 robots.txt
curl -s https://seichigo.com/robots.txt
```

---

## 四、时间线

| 周次 | 任务 | 负责人 | 状态 |
|------|------|--------|------|
| W1 | TASK-001, TASK-002, TASK-003 | - | [ ] 待开始 |
| W2 | TASK-004, TASK-005, TASK-006 | - | [ ] 待开始 |
| W3 | TASK-007, TASK-008, TASK-009 | - | [ ] 待开始 |
| W4 | TASK-010, TASK-011, TASK-012 (可选) | - | [ ] 待开始 |

---

## 五、附录

### A. 当前 SEO 相关文件结构

```
lib/seo/
├── alternates.ts      # hreflang 构建
├── globalJsonLd.ts    # WebSite + Organization Schema
├── jsonld.ts          # BlogPosting + BreadcrumbList + ItemList Schema
├── site.ts            # 站点 URL 工具
└── tvSeriesJsonLd.ts  # TVSeries Schema

app/
├── layout.tsx         # 全局 metadata + JSON-LD 注入
├── sitemap.ts         # 动态 sitemap
├── robots.ts          # robots.txt
├── opengraph-image.tsx
├── twitter-image.tsx
└── (site)/
    └── posts/[slug]/
        ├── opengraph-image.tsx
        └── twitter-image.tsx

scripts/
└── seo-audit.js       # 自建 SEO 审计工具
```

### B. 参考资源

- [Next.js Metadata API](https://nextjs.org/docs/app/building-your-application/optimizing/metadata)
- [Schema.org 文档](https://schema.org/)
- [Google SEO 入门指南](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [hreflang 最佳实践](https://developers.google.com/search/docs/specialty/international/localized-versions)

---

## 六、GSC 索引问题分析

### "已发现 - 尚未编入索引" 状态说明

**这是正常现象，不是技术问题。**

当 Google Search Console 显示页面状态为「已发现 - 尚未编入索引」时，表示：
- ✅ Googlebot 已经发现了这些 URL
- ✅ 页面技术上可以被索引（无 noindex、无阻止）
- ⏳ Google 尚未安排爬取/索引时间

**常见于：**
1. 新建站点（seichigo.com 建站时间短）
2. 新发布页面
3. Google 认为优先级较低的页面

**受影响页面（2026-01 观察）：**
- `/about` - 关于页
- `/anime/*` - 作品聚合页
- `/posts/*` - 文章详情页

### 解决方案

| 方案 | 操作 | 预期效果 |
|------|------|----------|
| **1. 手动请求编入索引** | GSC → URL 检查 → 请求编入索引 | 加速单页索引 |
| **2. 等待自然爬取** | 保持更新、发布新内容 | 1-4 周内自动索引 |
| **3. 提升页面权重** | 增加内链、外链、社交分享 | 提高 Google 爬取优先级 |
| **4. 确保 sitemap 完整** | 检查 sitemap.xml 是否包含所有页面 | ✅ 已完成 |

**当前技术 SEO 状态：无问题**
- robots.txt 正确配置
- sitemap.xml 包含所有页面
- 无 noindex 标签
- 页面可正常渲染

---

## 七、长尾词 SEO 策略

### 关键词金字塔模型

```
                    ┌─────────────────┐
                    │   圣地巡礼      │  ← 短尾词（高难度）
                    │   竞争激烈      │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │    你的名字 圣地巡礼         │  ← 中尾词（中难度）
              │    吹响吧上低音号 巡礼        │
              └──────────────┬──────────────┘
                             │
    ┌────────────────────────┴────────────────────────┐
    │  你的名字 圣地巡礼 须贺神社                        │  ← 长尾词（低难度）
    │  你的名字 圣地巡礼 四谷 路线                       │
    │  你的名字 圣地巡礼 交通攻略                        │
    └─────────────────────────────────────────────────┘
```

### 目标关键词矩阵 - 「你的名字」系列

| 关键词 | 搜索意图 | 竞争度 | 目标排名 | 对应内容 |
|--------|----------|--------|----------|----------|
| 你的名字 圣地巡礼 | 信息型 | 中 | Top 10 | 系列汇总页 |
| 你的名字 圣地巡礼 路线 | 导航型 | 低 | Top 5 | 各 Part 详细攻略 |
| 你的名字 圣地巡礼 须贺神社 | 地点型 | 低 | Top 3 | Part 1 四谷篇 |
| 你的名字 圣地巡礼 新宿 | 地点型 | 低 | Top 3 | Part 2 新宿篇 |
| 你的名字 圣地巡礼 飞騨 | 地点型 | 低 | Top 3 | Part 3 飞騨篇 |
| 你的名字 巡礼 交通 | 攻略型 | 低 | Top 5 | 交通指南段落 |
| 君の名は 聖地巡礼 | 日语搜索 | 中 | Top 20 | 未来日语版 |

### 内容优化策略

#### 1. Title 优化
当前：
```
你的名字 圣地巡礼（上）四谷/新宿篇
```

建议：
```
你的名字圣地巡礼攻略：四谷须贺神社路线（上篇）| SeichiGo
```

#### 2. 创建汇总页
建议创建 `/posts/your-name-pilgrimage-complete-guide` 汇总页：
- 作为 Part 1-3 的 Hub 页面
- 目标关键词：「你的名字 圣地巡礼」
- 内链到各分篇，提升整体权重

#### 3. 增加内链密度
- 在每篇文章末尾添加「相关文章」区块
- 在 anime 页面添加「推荐路线」
- 在 city 页面添加「热门作品」

---

## 八、竞争对手分析

### 「你的名字 圣地巡礼」关键词竞争格局

| 排名 | 网站 | URL 类型 | 优势 | 劣势 |
|------|------|----------|------|------|
| 1 | funtime.com.tw | 攻略汇总 | 老牌旅游站、外链多 | 更新慢、无结构化数据 |
| 2 | navitime.co.jp | 官方导航 | 日本本土权威 | 非中文用户友好 |
| 3 | vocus.cc | UGC 文章 | 域名权重高 | 内容质量参差不齐 |
| 4 | douban.com | 日记/小组 | 社区互动强 | 非专业旅游内容 |
| 5 | zhihu.com | 问答 | 高权重域名 | 非系统性内容 |

### SeichiGo 竞争优势

| 维度 | SeichiGo | 竞争对手 |
|------|----------|----------|
| 结构化数据 | ✅ BlogPosting, TVSeries, Place | ❌ 大多无 |
| 地图集成 | ✅ 内置坐标、导航 | ⚠️ 部分有 |
| 多语言 | ✅ hreflang 就绪 | ❌ 单语言 |
| 移动端体验 | ✅ 响应式 PWA-ready | ⚠️ 参差不齐 |
| 内容新鲜度 | ✅ 持续更新 | ⚠️ 多为旧文 |

### 差异化策略

1. **垂直深耕**：专注圣地巡礼细分领域
2. **技术 SEO 领先**：结构化数据、Core Web Vitals
3. **内容体系化**：按作品 → 城市 → 路线组织
4. **用户体验**：一站式路线规划 + 地图导航

---

## 九、关键词追踪方法

### Google Search Console 追踪

**操作步骤：**
1. 进入 GSC → 效果 → 搜索结果
2. 筛选器 → 查询 → 包含「你的名字」
3. 查看：展示次数、点击次数、平均排名

**关键指标：**
| 指标 | 含义 | 目标 |
|------|------|------|
| 展示次数 (Impressions) | 页面在 SERP 出现次数 | 持续增长 |
| 点击次数 (Clicks) | 用户点击进入次数 | 持续增长 |
| 点击率 (CTR) | Clicks / Impressions | > 5% |
| 平均排名 (Position) | 搜索结果平均位置 | < 10 (首页) |

**按页面筛选：**
1. 筛选器 → 页面 → 包含 `/posts/your-name`
2. 查看该系列文章的表现

### 第三方工具（可选）

| 工具 | 功能 | 价格 |
|------|------|------|
| Ahrefs | 关键词排名追踪、外链分析 | $99/月起 |
| SEMrush | 竞争对手分析、关键词研究 | $129/月起 |
| Ubersuggest | 基础关键词追踪 | 免费/付费 |
| Google Alerts | 品牌/关键词监控 | 免费 |

### 手动追踪模板

```
| 日期 | 关键词 | 当前排名 | 上次排名 | 变化 | 备注 |
|------|--------|----------|----------|------|------|
| 2026-01-25 | 你的名字 圣地巡礼 | - | - | - | 初始 |
| 2026-01-25 | seichigo | 7.8 | - | - | 品牌词 |
```

---

## 十、监控指标与目标

### 月度 KPI 目标

| 月份 | 总点击 | 总展示 | 平均 CTR | 索引页面数 | 目标关键词排名 |
|------|--------|--------|----------|------------|----------------|
| 2026-01 | 3 | 19 | 15.8% | 待确认 | - |
| 2026-02 | 50+ | 500+ | > 10% | 全部索引 | Top 50 进入 |
| 2026-03 | 200+ | 2000+ | > 10% | - | Top 20 进入 |
| 2026-04 | 500+ | 5000+ | > 10% | - | Top 10 进入 |

### 周度检查清单

- [ ] GSC 检查新索引页面状态
- [ ] 查看「你的名字 圣地巡礼」关键词排名变化
- [ ] 检查 Core Web Vitals 报告
- [ ] 检查移动设备可用性报告
- [ ] 审查新增外链（如有）

### 季度回顾

- 对比关键词排名趋势
- 分析高表现内容特征
- 识别待优化页面
- 调整内容策略
