# 修复 ja / en 文章页面包屑里的中文作品名与错误 locale 链接

日期：2026-09-09
分支：`fix/locale-breadcrumb-anime-title`，worktree `/Users/mac/Desktop/seichigo-wt-share-b`

## 背景（读这段就够，不用查上下文）

日文与英文文章详情页的面包屑第三层，作品名用的是**简体中文**，链接又漏了 locale 前缀指向中文站。这个错误会直接出现在 Google / Yahoo 的搜索结果里。线上实测，搜 `君の名は 階段` 时我们那条显示为：

```
須賀神社の階段 | 『君の名は。』聖地巡礼スポット詳細
SeichiGo
https://seichigo.com › ホーム › アニメ › 你的名字        ← 简体中文
```

对应的 JSON-LD：

```
1 | ホーム    | https://seichigo.com/ja
2 | アニメ    | https://seichigo.com/ja/anime
3 | 你的名字  | https://seichigo.com/anime/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97   ← 名字是中文，URL 少了 /ja
4 | 『君の名は。』の階段はどこ？…  | https://seichigo.com/ja/posts/suga-shrine-your-name-stairs
```

英文站同样：`Home → Anime → 吹响！上低音号 → "Sound! Euphonium" …`

影响：sitemap 里有 55 个 `/ja/posts/` 页面加上对应英文页，每一次搜索结果展示都带着它。既是信任信号问题（日本用户看到简体中文会判定为机翻站），也是内链问题（日文页的结构化数据把权重指向中文页）。

## 根因

三个 locale 的文章详情页有同一段写法，`primaryAnime.label` 取的是中文 `name`，URL 又没带 locale 前缀：

| 文件 | 行 | 说明 |
|---|---|---|
| `app/ja/posts/[slug]/page.tsx` | 291 | JSON-LD 面包屑 |
| `app/ja/posts/[slug]/page.tsx` | 299 | 页面可见面包屑 |
| `app/en/posts/[slug]/page.tsx` | 290 | JSON-LD 面包屑 |
| `app/en/posts/[slug]/page.tsx` | 298 | 页面可见面包屑 |
| `app/(site)/posts/[slug]/page.tsx` | 286 / 294 | 中文站，本身就该用中文名和无前缀 URL，**预期不改**，但要读一遍确认 |

`ja` 版当前长这样（`en` 与之对称，只是文案是 Home / Anime）：

```ts
const primaryAnime = anime[0] || null
const breadcrumbItemsForJsonLd = [
  { name: 'ホーム', url: `${siteOrigin}/ja` },
  { name: 'アニメ', url: `${siteOrigin}/ja/anime` },
  ...(primaryAnime ? [{ name: primaryAnime.label, url: `${siteOrigin}/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
  { name: seoTitle, url: canonicalUrl },
]
```

`anime` 数组在同文件约 216–224 行构造：

```ts
const anime = await Promise.all(
  animeIds.map(async (id) => {
    const meta = await getAnimeById(id).catch((error) => {
      console.error('[degraded:post-detail.anime-label]', { locale: 'ja', slug, id }, error)
      return null
    })
    return { id, label: meta?.name || id }
  })
)
```

`getAnimeById` 在 `lib/anime/getAllAnime.ts:125`，返回的 `Anime` 对象**已经带有 `name_ja` 和 `name_en` 字段**，只是这里没用上。生产数据实测 10 条作品里 9 条两个字段都有值（90%）。

## 要做的改动

### 1. 让 `anime` 数组带上本地化名称

把 `label` 的取值改成按 locale 选，保留兜底链。不要新增数据库查询，`getAnimeById` 返回的对象里已经有这些字段。

- `app/ja/posts/[slug]/page.tsx`：`label: meta?.name_ja || meta?.name || id`
- `app/en/posts/[slug]/page.tsx`：`label: meta?.name_en || meta?.name || id`
- `app/(site)/posts/[slug]/page.tsx`（中文站）：维持 `meta?.name || id` 不变

注意 `label` 这个字段还被用在别处（`keywords` 的组装等），改动后要全文件搜一遍 `\.label` 的用法，确认本地化后不会破坏其他逻辑。如果某处明确需要中文名，就在 `anime` 元素上同时保留两个字段（例如 `label` 用于展示、`nameZh` 用于内部用途），不要为了省事把其他用法一起改掉。

### 2. 修 locale 前缀

面包屑第三层的链接要指向同 locale 的作品页：

- `ja`：`${siteOrigin}/ja/anime/${encodeAnimeIdForPath(primaryAnime.id)}`，可见面包屑 `href: /ja/anime/${...}`
- `en`：`${siteOrigin}/en/anime/${encodeAnimeIdForPath(primaryAnime.id)}`，可见面包屑 `href: /en/anime/${...}`
- 中文站保持 `/anime/${...}`

**先确认这两条路由确实存在**：仓库里应有 `app/ja/anime/[id]/page.tsx` 与 `app/en/anime/[id]/page.tsx`。如果某个 locale 没有该路由，不要造一个死链——停下来在汇报里写明，那一层维持原样。

### 3. 顺带检查同类页面

`app/ja/city/[id]/page.tsx:144` 和 `app/ja/anime/[id]/page.tsx:153` 也调用 `buildBreadcrumbListJsonLd`。读一遍，如果存在同样的「中文名 / 缺 locale 前缀」问题，一并修；没有就不动。英文站对应文件同理。

## 不要做的事

- 不要改 `lib/seo/jsonld.ts` 的 `buildBreadcrumbListJsonLd` 签名。
- 不要碰任何数据库数据。《你的名字》的 `name_ja` 目前是错的（值为「お名前」，应为「君の名は。」），**这条由站长另行处理，你不要写库、不要加迁移、不要写修数据的脚本**。
- 不要动 `app/(site)/posts/[slug]/page.tsx` 的中文名逻辑。
- 不要 `git commit` 之外的任何 git 操作：不 push、不切分支、不新建 worktree、不合并。
- 不要跑 `npm run build`，不要部署。

## 完成标准

1. `npx tsc -p tsconfig.app.json --noEmit` 零错误。
2. `npm test` 全绿（如有面包屑相关测试需同步更新）。
3. `node scripts/check-line-budget.mjs` 通过。
4. 起本地服务自测三个 locale 的 JSON-LD 面包屑第三层。**注意：本地必须显式传开发库的 `DATABASE_URL`，否则 `.env.local` 会让你连上生产库**：

   ```bash
   set -a; source .env; set +a
   DATABASE_URL="$DATABASE_URL" npm run dev -- -p 3458
   ```

   然后对三个 URL 各取一次 JSON-LD，确认第三层：

   | URL | 期望第三层名称 | 期望第三层链接 |
   |---|---|---|
   | `/ja/posts/suga-shrine-your-name-stairs` | 日文名（当前库里是「お名前」，只要**不是**简体中文即算通过） | `/ja/anime/…` |
   | `/en/posts/<任一英文文章 slug>` | 英文名（如 `Sound! Euphonium`） | `/en/anime/…` |
   | `/posts/<任一中文文章 slug>` | 中文名，维持不变 | `/anime/…` |

   开发库的 `Anime` 表是空的，本地取不到 `name_ja`/`name_en` 时会走兜底返回 id——**这属于预期**，只要代码路径正确即可，不要为了让本地出数据去改兜底逻辑或写种子数据。判断依据以代码正确性和类型检查为准。

## 提交

按上面的改动分 2 个 commit：

1. `fix(seo): 文章页面包屑按 locale 取作品名`
2. `fix(seo): 文章页面包屑链接补上 locale 前缀`

每条 message 末尾带：

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## 汇报

用简短中文说明：每个 commit 的 sha、实际改了哪些文件哪些行、第 2 节里两条 anime 路由是否都存在、`.label` 的其他用法有没有受影响、以及三项检查的结果。与本简报有出入的地方要写明。
