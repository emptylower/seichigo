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

（待补：本地 workerd 与生产 curl 的原始输出）
