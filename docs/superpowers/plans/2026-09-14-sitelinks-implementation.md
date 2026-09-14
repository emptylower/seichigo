# sitelinks 站内结构改造：实施记录

方案：`docs/superpowers/plans/2026-09-14-sitelinks-joint-plan.md`（Claude × Astra 联合方案 v1）
分支：`feat/sitelinks-nav`　执行：opencode（Commit 1/3/4 glm-5.3 max，Commit 2 kimi k3 max）　审阅：Claude + code-reviewer 子 agent，逐提交

## 提交

| 提交 | SHA | 内容 | 审阅结论 |
|---|---|---|---|
| Commit 1 | 09b09a63 | 三语公开入口 `/plan/start`、`/en/plan/start`、`/ja/plan/start`；路由组 `(plan-start)`；旧 `?locale=` 307 兼容；`prefixPath` 精确豁免；`planStartHref` 本地化；独立 metadata | APPROVE WITH NITS（已处理：共享 helper 移出路由组、过期测试描述） |
| Commit 2 | 97015d3b | 四个主入口三语名称与顺序统一；AI 规划链接指向公开入口；城市索引 H1/title、城市详情与日文文章面包屑；地图加载占位本地化 | APPROVE WITH NITS（M1 英文页头溢出 → b7967013 修复） |
| 修复 | b7967013 | 桌面导航去 `justify-end`、gap-3、13px；1024/1280/1440 实测 overflow=0 | — |
| Commit 3 | 47595d5c | `/plan`、`/plan/[id]` 页面级 noindex；sitemap 补三语 `/plan/start` 与 `/posts` | APPROVE WITH NITS（已处理：死断言、松散前缀） |
| Commit 4 | dc085d65 | Organization `sameAs` 删除错误的 `github.com/seichigo`（不新增） | 自审（1 行 + 测试） |

每个提交均通过：对应测试命令、`typecheck:app`、`typecheck:tests`；Commit 1/2 另跑全量套件（547 文件 / 4923 用例通过）。

## 验收证据

- 本地 workerd（`opennextjs-cloudflare preview`）验收：见本文件末尾"验收输出"。
- 生产 curl 复验：待部署后补。

## 品牌首次提及规则（并入外联攻势）

| 语言 | 首次提及写法 |
|---|---|
| 中文 | SeichiGo（动漫圣地巡礼地图与 AI 规划） |
| 日文 | SeichiGo（アニメ聖地巡礼マップと AI プランナー） |
| 英文 | SeichiGo (anime pilgrimage map and AI planner) |

站内 title 模板维持 `%s | SeichiGo`。此规则同步到外联守则记忆（`seichigo-community-outreach-playbook`）。

## 发布与基线

- 发布日期 D：待补
- 部署版本（Worker Version ID / deploy tag）：待补
- 正式基线（D 前最近 14 天完整窗口；page=`https://seichigo.com/`、query 精确「圣地巡礼」、device 分开、全部国家、Web）：待补
- 品牌词基线（query 精确 `seichigo`，同窗口）：待补
- 历史观察（非正式基线，等长 14 天）：08-13–08-26 移动 108/477=22.6%、桌面 47/227=20.7%；08-29–09-11 移动 19/287=6.6%、桌面 12/182=6.6%。

## 上线后测量（每周一次，三到六周）

固定：手机版 viewport、hl=zh-CN、gl=jp 与 gl=cn、未登录、记录实际出口地区；查「圣地巡礼」与「seichigo」，保存截图，记录是否出现附加链接、目标 URL 与标签、我们条目距页面顶部的位置。GSC 用同筛选、等长窗口比较；先看入口发现/抓取/规范 URL/索引状态，再看 sitelinks 与 CTR。

## 回滚

以提交为单位：路由问题整体回滚 Commit 1 及依赖它的 Commit 2/3；文案问题只回滚 Commit 2；sitemap/noindex 问题只回滚 Commit 3；sameAs 独立回滚 Commit 4。部署回滚用 `deploy/*` 标签。

## 验收输出

### 本地 workerd（opennextjs-cloudflare preview，2026-09-14，构建自 dc085d65）

```text
### B. 旧协议 307（不跟随）
HTTP/1.1 307 Temporary Redirect
Location: /ja/plan/start?draft=%E6%9D%B1%E4%BA%AC%205%20%E6%97%A5%E9%96%93%20%26%20%E4%BA%AC%E9%83%BD
HTTP/1.1 307 Temporary Redirect
Location: /en/plan/start?draft=a%26b
HTTP/1.1 200 OK
HTTP/1.1 200 OK
### C. 私有页
HTTP/1.1 307 Temporary Redirect
Location: /auth/signin?callbackUrl=/plan
### E. sitemap
   1 <loc>https://seichigo.com/en/plan/start</loc>
   1 <loc>https://seichigo.com/en/posts</loc>
   1 <loc>https://seichigo.com/ja/plan/start</loc>
   1 <loc>https://seichigo.com/ja/posts</loc>
   1 <loc>https://seichigo.com/plan/start</loc>
   1 <loc>https://seichigo.com/posts</loc>
### G. JSON-LD sameAs
"sameAs":["https://x.com/xixingshu"]
### A. 三个干净入口
-- /plan/start
  title      : AI 规划｜动漫圣地巡礼行程助手 | SeichiGo
  canonical  : https://seichigo.com/plan/start
  hreflang   : zh=https://seichigo.com/plan/start | en=https://seichigo.com/en/plan/start | ja=https://seichigo.com/ja/plan/start | x-default=https://seichigo.com/plan/start
  robots     : index, follow
  h1         : 1 | AI 规划
  shells     : 1 header / 1 main / 1 footer
  nav        : 巡礼地图→/map | 巡礼攻略→/posts | AI 规划→/plan/start | 巡礼城市→/city | 套餐→/pricing
  intro      : 输入作品、目的地和天数，规划每天的巡礼路线与交通建议。登录后可生成并继续调整行程。
-- /en/plan/start
  title      : AI Planner | Anime Pilgrimage Itineraries | SeichiGo
  canonical  : https://seichigo.com/en/plan/start
  hreflang   : zh=https://seichigo.com/plan/start | en=https://seichigo.com/en/plan/start | ja=https://seichigo.com/ja/plan/start | x-default=https://seichigo.com/plan/start
  robots     : index, follow
  h1         : 1 | AI Planner
  shells     : 1 header / 1 main / 1 footer
  nav        : Pilgrimage Map→/en/map | Pilgrimage Guides→/en/posts | AI Planner→/en/plan/start | Pilgrimage Cities→/en/city | Pricing→/en/pricing
  intro      : Enter your anime, destinations and travel dates to plan dail
-- /ja/plan/start
  title      : AIプランナー｜アニメ聖地巡礼の旅行プラン | SeichiGo
  canonical  : https://seichigo.com/ja/plan/start
  hreflang   : zh=https://seichigo.com/plan/start | en=https://seichigo.com/en/plan/start | ja=https://seichigo.com/ja/plan/start | x-default=https://seichigo.com/plan/start
  robots     : index, follow
  h1         : 1 | AIプランナー
  shells     : 1 header / 1 main / 1 footer
  nav        : 巡礼マップ→/ja/map | 巡礼ガイド→/ja/posts | AIプランナー→/ja/plan/start | 都市ガイド→/ja/city | プラン→/ja/pricing
  intro      : 作品・行き先・日数を入力して、日ごとの巡礼ルートと交通の提案をまとめます。ログイン後にプランを作成・調整できます。
### D. 栏目页与页头/页脚
-- /
  title      : SeichiGo | 动漫圣地巡礼攻略 · AI 规划 + 全球巡礼点位地图
  h1         : 1 | 动漫圣地巡礼行程，AI 规划师帮你排好
  shells     : 1 header / 1 main / 1 footer
  nav        : 巡礼地图→/map | 巡礼攻略→/posts | AI 规划→/plan/start | 巡礼城市→/city | 套餐→/pricing
  footer     : SeichiGo→/ | 巡礼地图→/map | 巡礼攻略→/posts | AI 规划→/plan/start | 巡礼城市→/city | 套餐→/pricing | 作品→/anime | 资源→/resources | 圣地巡礼礼仪→/resources/pilgrimage-etiquette
-- /en
  title      : SeichiGo | Anime Pilgrimage Guides · AI Planner + Global Location Map
  h1         : 1 | Anime pilgrimage itineraries, planned by
  shells     : 1 header / 1 main / 1 footer
  nav        : Pilgrimage Map→/en/map | Pilgrimage Guides→/en/posts | AI Planner→/en/plan/start | Pilgrimage Cities→/en/city | Pricing→/en/pricing
  footer     : SeichiGo→/en | Pilgrimage Map→/en/map | Pilgrimage Guides→/en/posts | AI Planner→/en/plan/start | Pilgrimage Cities→/en/city | Pricing→/en/pricing | Anime→/en/anime | Resources→/en/resources | Pilgrimage Etiquette→/en/resources/pilgrimage-etiquette
-- /ja
  title      : SeichiGo | アニメ聖地巡礼ガイド · AIプランナー + 世界の聖地マップ
  h1         : 1 | アニメ聖地巡礼の旅程を、AIプランナーが組み立てる
  shells     : 1 header / 1 main / 1 footer
  nav        : 巡礼マップ→/ja/map | 巡礼ガイド→/ja/posts | AIプランナー→/ja/plan/start | 都市ガイド→/ja/city | プラン→/ja/pricing
  footer     : SeichiGo→/ja | 巡礼マップ→/ja/map | 巡礼ガイド→/ja/posts | AIプランナー→/ja/plan/start | 都市ガイド→/ja/city | プラン→/ja/pricing | 作品→/ja/anime | リソース→/ja/resources | 聖地巡礼マナー→/ja/resources/pilgrimage-etiquette
-- /map
  title      : 巡礼地图｜动画巡礼地标与截图 | SeichiGo
  h1         : 1 | 巡礼地图
-- /ja/map
  title      : 巡礼マップ | SeichiGo
  h1         : 1 | 巡礼マップ
-- /en/map
  title      : Pilgrimage Map | SeichiGo
  h1         : 1 | Pilgrimage Map
-- /city
  title      : 巡礼城市｜按目的地查找动漫圣地巡礼路线 | SeichiGo
  h1         : 1 | 巡礼城市
-- /en/city
  title      : Pilgrimage Cities | Anime Travel by Destination in Japan | SeichiGo
  h1         : 1 | Pilgrimage Cities
-- /ja/city
  title      : 都市ガイド｜アニメ聖地巡礼の目的地を探す | SeichiGo
  h1         : 1 | 都市ガイド
-- /posts
  title      : 巡礼攻略｜动漫圣地巡礼路线与攻略全集 | SeichiGo
  h1         : 1 | 巡礼攻略
-- /en/posts
  title      : Pilgrimage Guides | Anime Pilgrimage Routes and Walkthroughs | SeichiGo
  h1         : 1 | Pilgrimage Guides
-- /ja/posts
  title      : 巡礼ガイド｜アニメ聖地巡礼ルートまとめ | SeichiGo
  h1         : 1 | 巡礼ガイド
### H. 带 draft 的 200 页 canonical
  title      : AIプランナー｜アニメ聖地巡礼の旅行プラン | SeichiGo
  canonical  : https://seichigo.com/ja/plan/start
```

### 生产 curl

（待补）
