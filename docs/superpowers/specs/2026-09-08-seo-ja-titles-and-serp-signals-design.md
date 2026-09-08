# 日文页面标题摘要重写 + SERP 展示信号修复

日期：2026-09-08
状态：已与站长确认文案，待实现

## 背景与数据

- GSC 近 90 天：日本区曝光 48,347 次占全站 80%，CTR 1.9%；中国区 CTR 10.4%。日文页面问题在标题摘要不回答搜索意图，不在排名。
- 2026-08-07 到 08-26 搜索点击涨 5 倍又回落，全部来自首页在「圣地巡礼」一词上的 CTR 变化（4% → 20% → 4%），排名全程第 5 到 6 位没动。涨对应 08-06 favicon 改造；跌自 08-27 起原因未定。
- 顺带发现：中文 slug 的 DB 文章 canonical 与 hreflang 被双重编码（`%25E4...`）；根 layout 的 Organization/WebSite JSON-LD 走 next/script beforeInteractive，静态 HTML 里没有 `<script type="application/ld+json">`，只在 `self.__next_s` 负载里。

## 目标

1. 日本区高曝光低 CTR 的四个页面标题摘要按搜索意图重写。
2. 首页标题品牌名前置，三语一致。
3. 修双重编码 canonical/hreflang。
4. Organization JSON-LD 以静态 script 标签输出。

不做：新建页面、改正文、改排名策略、动 AdSense。

## 改动清单

### A. `lib/seo/alternates.ts` 双重编码修复

`buildHreflangAlternates` 对 `canonicalPath` 和三个语言路径都做 `encodeURI`，而文章页传入的路径已经过 `encodeSlugForPath` 编码，导致 `%E4` 变 `%25E4`。

修法：新增内部函数 `encodePathOnce(path)`：先 `decodeURI` 尝试解码（失败则原样），再 `encodeURI`。`canonical` 与 `toAbsoluteUrl` 都改用它。

验收：
- 输入 `/ja/posts/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97-your-name-seichigo-tokyo-shinjuku` 输出 canonical 为同一字符串（单次编码），hreflang 四条同理。
- 输入未编码的 `/ja/posts/你的名字-your-name-...` 输出与上面一致。
- 输入纯 ASCII 路径行为不变。
- 在 `tests/seo/` 下新增 `alternates.test.ts` 覆盖以上三条；现有 `tests/seo/post-metadata.test.ts` 若有断言 canonical 的用例保持通过。

### B. `app/layout.tsx` JSON-LD 静态输出

- 删除 `jsonld-website` 和 `jsonld-org` 两个 `<Script strategy="beforeInteractive">`。
- Organization 改用 `lib/seo/placeJsonLd.tsx` 的 `PlaceJsonLd` 组件渲染（它输出原生 `<script type="application/ld+json">`），放在 body 开头原位置，`keyPrefix="global-org"`。
- WebSite 不再在 layout 输出。首页三语的 `HomePageTemplate` 已各自输出带 SearchAction 的 WebSite JSON-LD，避免重复。
- `buildWebSiteJsonLd` 若无其他调用方则删除；有则保留不动。

验收：`curl -sL https://<预览域>/ | grep -c '"@type":"Organization"'` 为 1；首页 `"@type":"WebSite"` 仍为 1；任意文章页 Organization 为 1。

### C. 首页标题三语改为品牌名前置

只改 `TITLE` 常量，`DESCRIPTION` 不动。openGraph 与 twitter 的 title 引用同一常量，自动跟随。

| 文件 | 新标题 |
|---|---|
| `app/(site)/page.tsx` | `SeichiGo \| 动漫圣地巡礼攻略 · AI 规划 + 全球巡礼点位地图` |
| `app/ja/page.tsx` | `SeichiGo \| アニメ聖地巡礼ガイド · AIプランナー + 世界の聖地マップ` |
| `app/en/page.tsx` | `SeichiGo \| Anime Pilgrimage Guides · AI Planner + Global Location Map` |

### D. 两篇 MDX 日文文章 frontmatter

`content/ja/posts/suga-shrine-your-name-stairs.mdx`：
- `seoTitle`: `『君の名は。』の階段はどこ？須賀神社（新宿・四谷）への行き方と撮影ポイント`
- `description`: `『君の名は。』ラストシーンの階段は東京・新宿区須賀町の須賀神社前。JR四ツ谷駅から徒歩約10分。作中と同じ構図の撮影位置、混雑を避ける時間帯、参拝マナーを地図付きで解説。`
- `title`（页内 H1）不动。

`content/ja/posts/suga-shrine-shinjuku.mdx`：
- `seoTitle`: `須賀神社『君の名は。』聖地巡礼ガイド｜アクセス・撮影ポイント・参拝マナー`
- `description`: `『君の名は。』瀧と三葉が再会する階段の舞台、東京・四谷の須賀神社。最寄り駅からのアクセス、階段の撮影位置、御朱印と参拝マナー、周辺の新宿聖地もあわせて紹介。`
- `title` 不动。

frontmatter 其余字段与引号风格保持原样。

### E. 两篇 DB 日文文章（Article 表，`language = 'ja'`）

通过脚本改，不走后台。新增 `scripts/update-ja-article-seo.ts`：
- 读 `DATABASE_URL`，按 `slug + language='ja'` 定位，`@@unique([slug, language])`。
- 默认 dry-run，打印每篇 before/after 的 `title / seoTitle / description`；加 `--apply` 才写库。
- 只更新下表字段，其它列不碰。

| slug | 字段 | 新值 |
|---|---|---|
| `你的名字-your-name-seichigo-tokyo-shinjuku` | seoTitle | `『君の名は。』東京聖地巡礼 新宿編｜新宿駅→須賀神社 半日モデルコース（地図・撮影スポット付き）` |
| 同上 | description | 现有摘要开头的 `『君の名は。』東京都新宿区 聖地巡礼 半日コースまとめ：` 替换为 `『君の名は。』新宿の聖地を半日で全部回るモデルコース。`，其余原文保留 |
| `你的名字-your-name-tokyo-minato-ward` | seoTitle | 不动 |
| 同上 | description | `『君の名は。』港区・恵比寿エリアの聖地を1日で回る実践ルート。国立新美術館、六本木ヒルズ、恵比寿ガーデンプレイス、渋谷スクランブル交差点から東京駅まで、各ロケ地の作中カット再現ポイントと回り方を解説。新宿編と合わせて東京の聖地を網羅。` |

注意：这两篇如果 `seoTitle` 为空而 `title` 承担了 `<title>`，则改 `title` 所在字段。脚本 dry-run 输出会显示实际哪一列在用，以 dry-run 结果为准再 `--apply`。

执行顺序：A 到 D 走预览验证后合并部署；E 在部署后由站长确认 dry-run 输出再 `--apply` 到生产库（`.env.local` 的 Neon）。

## 验证

- `npm run typecheck` 与 `npm test` 通过。
- 预览环境 curl 检查：首页三语 `<title>`；`/ja/posts/%E4%BD%A0...-shinjuku` 的 canonical 与 hreflang 无 `%25`；Organization JSON-LD 静态存在；两篇 MDX 页面 `<title>` 与 `meta description` 为新文案。
- 部署后 GSC 用 URL 检查工具对四个日文页面请求重新抓取。
- 两到三周后复查四个页面 CTR 与首页「圣地巡礼」CTR。
