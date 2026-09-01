# 计划 Agent 与信息架构重构 · 设计文档

- 日期：2026-08-31
- 状态：已批准（2026-08-31 用户确认；M1 范围调整见文末变更记录）
- 范围：计划 agent v1 + 站点信息架构语义改造
- 明确不在本期：探索页（业务有价值，但形态未想清楚，且与计划页无依赖，后续单独立项讨论）

## 1. 背景与问题

SeichiGo 现状覆盖了巡礼用户旅程的前半段，后半段断裂：

| 阶段 | 用户行为 | 现状 |
|---|---|---|
| 发现 | 云旅游、看攻略、按作品/城市索引 | ✅ 地图 + 文章 + 索引页，最强资产 |
| 收集 | 攒想去的点位 | ✅ 地图收藏 |
| 整理/规划 | 排成"哪天去哪、什么顺序" | ⚠️ RouteBook 存在但使用率低 |
| 出行 | 当天导航、按序打卡 | ❌ 无 |
| 记录/回流 | 打卡、分享、反哺内容 | ❌ 无 |

核心观察（来自真实用户行为，非臆想）：

1. 用户整理完点位后**导出到自己的谷歌地图路线/行程工具**，而不是留在站内。整理需求成立，但我们没有提供合格的承载与导出，用户在"整理"这一步就理性迁移了。RouteBook 卡在链条中间：上游承接收集，下游是断头路（无导航 handoff、无导出格式）。
2. 大量散客的路径是**地图发现作品 → 云旅游/看攻略**，并不出行。地图是很重的承载载体，这部分价值必须保留。
3. 本地点位数据库远大于实际巡礼需求，爱好者基本止步于热门作品的热门线路。

由此确定两个产品定位：

- **地图：不动。** 定位为"云旅游 / 用户手动查询的圣地数据库"。
- **计划：新建。** agent 驱动的对话式巡礼行程规划，是本期核心，承接"整理/规划"并打通"出行"的导出。

## 2. 信息架构改造

现有导航语义不准："文章"实为巡礼攻略，"作品/城市"实为两种索引维度。目标导航：

```
计划 | 地图 | 热门攻略 | 热门城市 | 我的
```

| 导航项 | 路由 | 改造内容 |
|---|---|---|
| 计划 | `/plan`（新） | 计划 agent 主界面 + 我的计划列表，见 §3 |
| 地图 | `/map` | 不动。定位：云旅游/点位数据库 |
| 热门攻略 | `/posts` | 文章列表默认按热门排序；**作品降级为页内二级索引**——页面顶部提供"按作品筛选"入口，点击后切换为按作品聚合视图（形态类似现有 `/anime` 页）。`/anime/[id]` 等现有 URL 全部保留不动（SEO），仅导航层级调整 |
| 热门城市 | `/city` | 页面不动，导航文案改为"热门城市"。定位：SEO 入口 + 按城市索引 |
| 我的 | `/me` | 聚合：点位收藏、攻略订阅（v1 即现有文章收藏 MdxFavorite，以"订阅的攻略"语义呈现，不新建订阅机制）、足迹/我的计划（含存量 RouteBook 入口） |

导航中移除"资源""投稿"的一级位置（收入页脚或"我的"下），减少一级项，突出计划。`resources`、`submit` 路由本身保留。

## 3. 计划 Agent v1

### 3.1 交互参考基准

参考产品：圆周旅迹（截图存档于产品讨论记录）。其展示水平被定为 v1 验收线。吸收的五个交互模式：

1. **对话中嵌入结构化组件**：问日期弹日历（"具体日期/灵活天数"双 tab）、问关键维度给可点选项 + 确认按钮。agent 每轮只问一个关键维度，尽量用组件收答案，降低打字负担。
2. **回复中的实体全部超链接**：点位名、作品名、攻略链到站内详情页（带取景对比图）。我们有自建详情页，此模式对我们的增益大于参考产品。
3. **计划是有生命周期的对象**：状态机 draft → upcoming → ongoing → done；计划卡片带随身工具（问一问/清单/天气）；基于计划完整性缺口的主动提示（如"还有 3 晚没安排住宿"）。
4. **先调研、再提问、给理由**：agent 拿到输入先输出调研结论（"京吹核心在宇治市，京都站 JR 奈良线约 20 分钟"），再问下一维度；每个安排附"为什么这么排"。
5. **交付物是结构化日程**：Day1~DayN，每天点位卡片带图、交通衔接、行程总览——不是一段聊天文字。

### 3.2 相对参考产品的差异化（必须做出来的三点）

- **地图渲染为一等公民**：每一天 = 地图上一条路线；切换 Day 地图飞到对应区域，路线 + 点位 + 取景图上图。参考产品是列表流，地图弱。
- **作品锚定**：点位来自库内 AnitabiPoint ground truth（坐标/集数/截图），而非大模型通用知识，杜绝点位错漏。
- **攻略联动**：计划中的天/点位挂接站内巡礼攻略（"Day2 宇治线路，参考这篇攻略"），内容体系与工具体系互相导流。

### 3.3 能力分层与 v1 边界

| 档 | 能力 | v1 |
|---|---|---|
| 一档·巡礼骨架 | 点位查询 → 地理聚类 → 按天分组 → 顺序优化 → 交通方式建议 → 地图渲染 → 存为计划 | ✅ 核心 |
| 二档·轻增强 | 天气（免费 API，如 Open-Meteo）；"附近经典景点"提醒（**人工精选静态清单**，热门巡礼城市各 ≤20 条，不调 API）；美食推荐（Places API，每天行程限 2–3 次调用） | ✅ |
| 三档·重外部 | 航班、酒店实时价格、精确预算 | ⛔ 降级为"建议 + 外链"：住宿给区域建议与理由 + Booking 搜索外链；预算给区间估算。不接预订/航班 API |

理由：一档是护城河（ChatGPT 无准确点位库，anitabi 无规划能力），二档便宜可控，三档是无底洞且参考产品实际也止步于建议级。

### 3.4 交付物与导出

- 界面形态：桌面端左对话右计划（日程卡片 + 地图）；移动端上下分屏或 tab 切换。
- 用户说"第二天太赶"，agent 修改的是计划对象，界面实时联动，不是重新生成文字。
- **导出（承接真实用户行为）**：每个 Day 由点位坐标生成 `google.com/maps/dir/A/B/C` 多点路线链接，一键把当天路线存进用户自己的谷歌地图。零 API 成本。后续可扩展 ICS/GPX，v1 只做 Google Maps 链接。

### 3.5 数据模型

新建四张表，**不动现有 RouteBook**（存量数据保留，"个人地图"作为轻量收藏工具与"计划"并存，语义不同；后续视使用情况再决定迁移/合并）：

```
TripPlan                          一次出行
├─ id / userId / title
├─ status                         draft | upcoming | ongoing | done
├─ startDate? / dayCount          精确日期或灵活天数两种模式
├─ bangumiIds Int[]               锚定作品
├─ preferences Json               交通偏好/节奏/预算档位（agent 问答获得）
├─ createdAt / updatedAt

TripPlanDay
├─ planId FK / dayIndex / date? / citySlug / summary
├─ weatherCache Json?             天气快照，含取数时间

TripPlanItem                      一天内的时间线条目
├─ dayId FK / sortOrder
├─ type                           point | transit | meal | lodging | attraction | free
├─ pointId? FK → AnitabiPoint     type=point 时必填
├─ timeHint / title / note
├─ reason                         “为什么这么排”，agent 写入
├─ payload Json                   type 专有数据：transit{from,to,mode,durationMin}、
                                  meal{name,rating,link}、lodging{area,reason,searchLink}

PlanConversation / PlanMessage    agent 会话，挂 planId
├─ 计划卡片"问一问"需带上下文续聊，会话必须可恢复
```

取舍：

- 异构条目用 `type + payload Json`，不按类型开表——外部数据本来是弱结构建议；点位是核心资产，单独外键保证关联查询。
- **缺口检测不存库，实时算**：住宿缺口、聚类间无交通段等提示由 days/items 纯函数推导，避免状态不同步。
- 导出链接是派生能力，不落库。

### 3.6 Agent 架构

- 形态：LLM tool-use 循环（Claude API），工具全部是站内 API/内部函数：
  - `searchPoints(bangumiId | citySlug, …)` — 查库内点位
  - `clusterPoints(pointIds)` — 地理聚类（本地算法，非 LLM）
  - `getDirections(from, to, mode)` — Directions API（Google/Mapbox，按量计费）
  - `getWeather(lat, lng, dateRange)` — Open-Meteo
  - `getCityHighlights(citySlug)` — 人工精选经典景点清单（静态数据）
  - `searchFood(lat, lng)` — Places API，限额调用
  - `readPlan / mutatePlan(patch)` — 读写 TripPlan 对象，agent 的一切产出都通过 mutatePlan 落到结构化对象上
  - `linkArticles(citySlug | bangumiId)` — 挂接站内攻略
- 前端通过流式接口同步 mutatePlan 造成的计划变更，驱动日程卡片与地图渲染。
- 对话组件协议：agent 回复可携带 `component` 指令（datePicker | optionSelect | confirm），前端渲染对应控件，控件结果作为下一轮用户输入。

### 3.7 成本与风控

- 单次完整规划为长 tool-use 链（点位查询×N + Directions×N + 天气 + 多轮修改），估算单次成本量级为几毛到几元人民币。
- **登录后可用 + 每日次数配额**（初始值上线前定，建议 3 次/日起步观察），同时作为注册转化钩子（"登录解锁 AI 巡礼规划"）。
- Directions/Places 设日预算上限与熔断，超限降级：交通段给"JR 约 X 分钟"级别的粗估（由聚类距离推算），美食模块隐藏。

## 4. 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 数据模型 + `/plan` 页骨架 + agent 一档能力（骨架规划 → 地图渲染 → 保存计划）+ 导航/IA 改造 | 一句"帮我安排下月中旬京都京吹巡礼"产出可保存、地图可视的多日计划 |
| M2 | 对话结构化组件 + 实体超链接 + 攻略联动 + Google Maps 导出 | 达到圆周旅迹交互基准的对话体验；每日路线一键存谷歌地图 |
| M3 | 二档增强（天气/精选景点/美食）+ 三档降级建议（住宿区域/预算区间）+ 计划状态机与缺口提示 | 完整 v1 验收线 |

后续（不承诺时间）：探索页（单独立项）、出行中模式、取景对比打卡、ICS/GPX 导出、公开计划/UGC。

## 5. 风险

- **Directions 成本失控** → 配额 + 熔断 + 粗估降级路径（见 §3.7）。
- **agent 排程质量不稳**（顺序不合理、时间估算离谱）→ 聚类与排序用本地确定性算法，LLM 只做选择与解释，不做数值计算；上线前用热门作品（京吹/你的名字/孤独摇滚等）人工校验路线合理性。
- **移动端体验**：参考产品是原生 App，我们是 Web。M1 优先保桌面 + 移动 Web 可用，不追求原生手感。
- **点位数据口径**：规划只使用热门作品的已同步点位；库内长尾数据不影响 agent 检索质量（searchPoints 按作品/城市过滤）。

## 6. 成功标准

- 计划创建数、计划保存率（创建对话 → 存下计划）、Google Maps 导出点击率。
- 反向指标：RouteBook 时代"整理后流失"的行为是否被导出功能显性承接（导出即留痕，不再是黑盒流失）。

## 7. 变更记录

- 2026-08-31（M1 计划评审后）：
  - 会话表简化：M1 每计划单会话，只建 `TripPlanMessage`（含 kind: human/assistant/tool），`PlanConversation` 留待多会话需求出现时再加。
  - "热门攻略"导航 v1 指向 `/`（首页即攻略列表，已含热门内容与作品二级入口）；独立 `/posts` 索引页与页内"按作品切换视图"移入 M2。
  - 一档的"交通方式建议"在 M1 用本地启发式（距离→步行/公共交通+耗时估算）实现，Google Directions 真实路线接入移入 M2。
- 2026-08-31（模型选型，用户决策）：
  - agent 模型不用 Claude/GPT（成本 10-30 倍），改用 DeepSeek `deepseek-v4-flash`（OpenAI 兼容端点，`PLAN_AGENT_API_KEY/BASE_URL/MODEL` 三环境变量可整体切换供应商）。
  - 作品简称解析定为三级管线：站内库 → bgm.tv 公开搜索 API（subject id 与点位库同源）→ 向用户确认官方名称。模型对简称的理解只用于生成查询，不作为事实落库，幻觉结构性无害化。
- 2026-09-01（M3 交互升级，设计扩展——执行简报 `2026-09-01-plan-agent-m3-interaction-upgrade.md`）：
  - **强制 ask_user 协议**：任何需要用户回答的问题必须走 `ask_user` 工具渲染成结构化卡片；解释文字与提问卡片允许同轮并存。服务端有窄域守卫（中文疑问句式/问号/祈使措辞）对"纯文字提问"重试一次纠正，再犯发可恢复协议错误，绝不留下无法回答的悬空提问。
  - **自定义回答兜底**：single/multi choice 卡片末位由服务端固定追加"其他（自行输入）"选项（模型选项上限 19，总上限 20）；点选后展开卡片内输入框；ask 待回答期间全局输入框直发即作为该 ask 的 `custom` 答案（携带 askId），不另起聊天轮。历史 ask 载荷（无新字段）仍可渲染。
  - **媒体/来源阶梯**：作品封面复用 `/map` 的候选梯+代理（Anitabi 作品封面 → 站内 Anime 映射封面 → bgm.tv 条目封面），UI 不另立第二套图片 URL 策略；选项携带 sourceKind/sourceUrl/fetchedAt/imageAttribution 溯源字段，无可靠来源不配图。
  - **Google 地点持久化**：非巡礼地点（如东京迪士尼）经 `resolve_place`（Places Text Search，自动取首个结果）落为 `TripPlanItem.payload.place`（provider/placeId/name/address/lat/lng/mapsUri/photo/fetchedAt），`pointId` 允许为空；与站内点位同样参与时间轴、编号、地图与路线。placeId 计划内去重 + 有界缓存 + 限速；查无结果返回 typed 错误，绝不编造坐标。
  - **图片安全与 R2 镜像**：Google 照片经 `/api/google/place-photo?ref=...`（keyless，登录态）代理：MIME 校验、大小上限、重定向白名单（仅 maps.googleapis.com）；canonical URL 与 R2 metadata 一律不含 API key；R2 read-through + 后台镜像（失败非致命，回退安全代理直显）。
  - **时间归一化**：save_plan_days 前由确定性归一化器解析每条目为本地时间区间（显式 HH:mm 优先，"午后/傍晚"换算参考时刻并保留原词为备注，缺失时间按日起点 09:00+游览时长+交通时长顺延），全部条目按时间排序重建 sortOrder；显式时间冲突/非法区间/缺坐标/外部点缺 payload.place → 显式报错绝不静默丢点；前端按结构化时间防御性二次排序，每个点位卡显示具体时钟时间 + 参考/预估标注。
  - **真实交通**：`estimate_travel` 复用共享 Google Directions 客户端（walking/transit/driving + 精确日期 departure_time），完整保留 leg/step（线路、上下车站、站数、步行段、时刻），`transportPayload` 原样落 transit 条目 payload.transport；地图优先 provider 折线（overview_polyline 解码），取不到才回退通用路网并标注"参考路线（示意）"。
  - **公交不便必问**：transit `ZERO_RESULTS` 不再静默转步行（typed 错误 + ask_user 引导）；软触发（换乘 ≥3、步行段 ≥25 分钟、耗时明显不合理）同样先问后行，选项含自驾/租车、公交、混合、自定义；用户选定后同区域路段沿用。
  - **配额与错误**：Places/Directions 沿用现有 per-key/per-plan 限速与配额错误映射（REQUEST_DENIED→配置错误、OVER_QUERY_LIMIT→限流），全部中文化转述，绝不吞错编数。
