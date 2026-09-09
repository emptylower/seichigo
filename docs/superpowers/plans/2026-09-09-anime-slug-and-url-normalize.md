# 作品页 URL 归一化、alias 回退、标题地名后缀

日期：2026-09-09
分支：`fix/anime-slug-and-url-normalize`，worktree `/Users/mac/Desktop/seichigo-wt-share-b`

## 背景（读这段就够，不需要额外上下文）

作品页里，slug 是拉丁字母的能正常拿到搜索流量，slug 是中文的等于不存在：

| 页面 | 近 90 天展示 | 排名 |
|---|---|---|
| `/ja/anime/sound-euphonium` | 413 | 7.8 |
| `/anime/bocchi-the-rock` | 270 | 6.8 |
| `/ja/anime/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97`（你的名字） | **0** | — |

中文 slug 的作品有三个：`你的名字`、`天气之子`、`轻音少女`。其中《你的名字》关联 9 篇文章，是站点最有价值的内容之一。

同时发现一个会产出垃圾索引页的 bug（详见任务 A）。

**本轮只改代码，一律不写数据库。** 生产数据（`Anime.id` 改名、`alias` 填充、`Article.animeIds` 更新、`Article.city` 修正、新增 `长野` 城市行）由站长在代码上线后另行执行。你写的代码必须在数据尚未改动的当前状态下也能正常工作。

## 任务 A：修二次编码路由（会产出垃圾索引页）

### 现象

`https://seichigo.com/ja/anime/%25E4%25BD%25A0%25E7%259A%2584%25E5%2590%258D%25E5%25AD%2597`（把 `%` 又编码了一次）线上返回：

- HTTP **200**（应该是 301 或 404）
- `<title>` 就是 `%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97` 这串乱码
- `<link rel="canonical">` 指向它自己（二次编码的那个 URL）
- `<meta name="robots" content="index, follow">`

也就是一个标题是乱码、自成 canonical、还邀请搜索引擎收录的页面。GSC 里已经记录到它产生过展示。

### 根因

`app/ja/anime/[id]/page.tsx` 顶部的 `safeDecodeURIComponent` **只解一次**：

```ts
function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try { return decodeURIComponent(input) } catch { return input }
}
```

于是对二次编码的路径：

1. 解一次得到 `"%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97"`（还是编码态）
2. `getAnimeById()` 用这个字符串查不到 → `anime = null`
3. `canonicalId` 退化成 `requestedId`，两者相等 → **不触发已有的 `permanentRedirect`**
4. 但 `getPostsByAnimeId()`（`lib/posts/getPostsByAnimeId.ts:4`）内部**又解了一次**，成功查到 9 篇文章 → `posts.length > 0` → 不走 `notFound()`
5. 页面照常渲染，标题用 `canonicalId`，canonical 用 `encodeURIComponent(canonicalId)` = 二次编码

核心矛盾：页面组件解一次，`getPostsByAnimeId` 解两次，两者对「这是哪个作品」的判断不一致。

### 要做的

1. 把解码改成**循环解到不再变化为止**（设上限 5 次防恶意输入导致的死循环），抽成一个共用工具，建议放 `lib/anime/id.ts` 或新建 `lib/url/decode.ts`，导出 `fullyDecodeURIComponent(input: string): string`。
2. 三个 locale 的 `app/{ja,en,(site)}/anime/[id]/page.tsx` 都改用它。
3. **归一化后必须比对原始路径段并重定向**：现有逻辑只在 `requestedId !== canonicalId` 时跳转，这不够——二次编码时这两者可能相等。改成：把 `params.id`（原样，未解码）与 `encodeAnimeIdForPath(canonicalId)` 比较，不一致就 `permanentRedirect` 到规范路径。
4. 同样的单次解码写法在这些地方也有，逐个读一遍，**存在同样风险的一并修，没有就不动**，并在汇报里说明各自的判断：
   - `lib/posts/getPostsByAnimeId.ts:4`
   - `lib/posts/getDbArticleForPublicNotice.ts:25`
   - `lib/posts/getPublicPostBySlug.ts:42`
   - `lib/seo/spokeFactory/extractCandidates.ts:24`
   - `app/ja/city/[id]/page.tsx:20`
5. 兜底：若归一化后仍找不到作品且没有文章，必须 `notFound()`，绝不能渲染一个以编码串为标题的页面。

### 验收

本地起服务后：

- `/ja/anime/%25E4%25BD%25A0%25E7%259A%2584%25E5%2590%258D%25E5%25AD%2597` → **301** 到 `/ja/anime/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97`
- `/ja/anime/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97` → 200，title 为 `君の名は。 …`，canonical 单次编码
- `/ja/anime/sound-euphonium` → 200，行为不变
- `/ja/anime/完全不存在的作品` → 404
- en 与中文站同样验一遍

## 任务 B：`getAnimeById` 支持 alias 回退

为后续把 `Anime.id` 从中文改成拉丁 slug 做准备。改名后旧 URL 必须能 301 到新 URL，而作品页里**已有**这段跳转逻辑：

```ts
const canonicalId = anime?.id || requestedId
if (requestedId && canonicalId && requestedId !== canonicalId) {
  permanentRedirect(`/ja/anime/${encodeAnimeIdForPath(canonicalId)}`)
}
```

只要 `getAnimeById('你的名字')` 能返回 id 已改为 `your-name` 的那条记录，这段就会自动产生 301。所以只需让查找支持 alias。

改 `lib/anime/getAllAnime.ts` 的 `getAnimeById`：先按 `id` 精确查（保持现状），查不到时再按 `alias` 数组包含该值查一次（`where: { alias: { has: id } }`），仍查不到才回落到 bundled JSON。

- `Anime.alias` 是 `String[]`，字段已存在，不需要迁移。
- 保持 `hidden` 与 `options.includeHidden` 的现有语义。
- 多条命中时取第一条并 `console.warn`，不要抛错。
- 同文件里如有 `getAllAnime` 之类的批量函数，不要改它们的行为。

### 验收

新增单测（放 `tests/` 下与现有 anime 测试同目录）：按 id 命中、按 alias 命中、都不命中返回 null、hidden 行为不变。数据库里当前还没有任何 alias 值，所以单测要自己造数据或 mock，不要依赖真实库。

## 任务 C：标题地名后缀

`lib/seo/titleBuilder.ts` 的 `buildAnimeSeoTitle` 目前取 `posts` 里去重后的城市，`.slice(0, 2)`，ja/zh 标题上限 30 字，超了先丢城市后缀。

《你的名字》的文章城市是 `东京` 和 `岐阜·飞驒古川 长野·诹访（上诹访）`，拼出来 34 字超限，于是后缀被整个丢掉，标题只剩 `君の名は。 聖地巡礼ガイド`。而竞品在 `君の名は 聖地` 这个词上的第一页标题**全部**写着「東京・岐阜・長野」——地名是这个查询已经形成的意图信号。

改动：把城市数量上限从 2 提到 **3**。长度守卫保持不变（超限仍然先丢城市后缀），所以这是安全的放宽。

修完之后，数据侧改成 `东京` / `岐阜` / `长野` 三个可本地化的城市时，日文标题会是 `君の名は。 聖地巡礼ガイド｜東京·岐阜·長野`（22 字，未超限）。**数据不归你改**，你只改代码。

### 验收

- 更新 `buildAnimeSeoTitle` 现有单测，补一条「三个城市且未超限时三个都出现」、一条「三个城市但超限时后缀被丢弃」。
- 三个 locale（zh/en/ja）各覆盖到。
- en 的上限是 60、分隔符 `, `，不要改这两个值。

## 全局约束

- **绝对不写数据库**：不改数据、不加 Prisma 迁移、不写 seed 或修数据的脚本。
- 不 push、不切别的分支、不新建 worktree、不 `npm run build`、不部署。
- 不改 `next.config.ts` 和 `middleware.ts`。
- 本地起服务必须显式传开发库连接串，否则 `.env.local` 会让你连上生产库：
  ```bash
  set -a; source .env; set +a
  DATABASE_URL="$DATABASE_URL" npm run dev -- -p 3458
  ```
  开发库的 `Anime` / `Article` 表是空的，页面会走兜底或 404 —— 这属于预期。任务 A 的路由验收可以用一个真实存在于 bundled JSON 的作品 id 来做；如果本地实在验不了，在汇报里写明，以类型检查和单测为准，**不要为了让本地出数据去改兜底逻辑或写种子数据**。

## 完成标准

1. `npx tsc -p tsconfig.app.json --noEmit` 零错误
2. `npm test` 全绿
3. `node scripts/check-line-budget.mjs` 通过

## 提交

按任务分 3 个 commit：

1. `fix(seo): 作品页 URL 完全解码并归一化重定向`
2. `feat(anime): getAnimeById 支持 alias 回退`
3. `feat(seo): 作品页标题城市后缀上限提到 3 个`

每条 message 末尾带：

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## 汇报

简短中文说明：三个 commit 的 sha、实际改了哪些文件、第 4 条里五个单次解码点各自的判断与理由、任务 A 的五条路由验收结果（本地能验的实测，验不了的说明原因）、三项检查结果、与本简报的出入。
