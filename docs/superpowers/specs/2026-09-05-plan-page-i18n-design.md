# plan 页多语言设计（2026-09-05）

## 背景

`/plan/[id]`（规划师页）与 `/plan/start` 是站内唯一的非前缀路由（没有 `/en/plan`、`/ja/plan`）。现状：

- `app/(authed)/plan/[id]/**` 12 个文件没有一处引用 `lib/i18n`，界面文案硬编码中文（约 440 处，含注释）。
- `page.tsx` 不感知语言；authed 布局 `SiteShellPublic` 没传 `locale`，页头页脚也是中文。
- `/plan/start` 是唯一接了 `t()` 的 authed 页，语言来自首页跳转带的 `?locale=`，创建成功后 `router.push('/plan/<id>')` 把语言丢了。
- 助手：`PLAN_AGENT_SYSTEM_PROMPT` 写死"中文回复"；思维链状态短语、网络错误文案、餐厅/交通补齐文案、配额与登录错误都是服务端中文。

用户决定：**plan 页语言与站点当前显示语言一致**——站点按浏览器语言判断，plan 页也按同一规则。

## 目标

1. `/plan/start`、`/plan/[id]`、以及它们的页头页脚，按站点统一规则解析语言（zh / en / ja）。
2. plan 页所有静态界面文案三语化。
3. 助手回复跟随**用户提问的语言**（用什么语言问就用什么语言答，不限于中英日），由模型自行判断；只在提示词里约束它不要被中文提示词带偏。服务端固定文案（思维链短语、补齐标题、错误）按站点语言三语化。
4. 一次改完后，新增文案有测试兜底，不再出现"英文站看到中文"。

## 非目标

- 不做 `/en/plan`、`/ja/plan` 路径前缀（authed 页不需要 SEO，避免全站链接改造）。
- 不翻译已落库的历史消息、历史行程标题；老计划打开时界面按当前语言，历史内容原样显示。
- 模型侧提示词正文、工具 description、供模型自纠的错误信息保持中文原样不动（避免措辞变化影响规划质量）；只追加语言指令（见 0.5）。
- 路书导出（`exportRouteBook.ts`）、后台管理页不在本轮范围。
- 不加数据库字段、不跑迁移。

## §0 契约

### 0.1 语言解析规则（全站统一，一个函数）

新增 `lib/i18n/resolveRequestLocale.ts`：

```ts
resolveRequestLocale(input: { pathname: string; cookieHeader: string | null; acceptLanguage: string | null }): SupportedLocale
```

优先级：

1. 路径前缀 `/en`、`/ja` → 对应语言（与现有 `detectLocale` 一致）。
2. `NEXT_LOCALE` cookie 取值为 `zh|en|ja` → 该语言。
3. `pickLocaleFromAcceptLanguage(acceptLanguage)`（zh→zh，ja→ja，其它→en，空/`*`→null）。
4. 兜底 `zh`。

`middleware.ts` 用它计算 `x-seichigo-locale` 请求头（现在只按路径前缀，非前缀路径永远是 zh）。**不改变**现有重定向逻辑：只有裸 `/` 参与浏览器语言跳转，深链接仍不跳。`/api/**` 也走这一步，让 API 路由能读到语言。

`lib/i18n/getLocale.ts` 改为优先读 `x-seichigo-locale` 请求头，缺失时才解析 `accept-language`（middleware 未命中的场景，如测试）。

### 0.2 start 页与 cookie

- `/plan/start` 的语言：显式 `?locale=` 合法值 > `getLocale()`。`parseStartLocale` 保留但返回 `null` 代替默认 zh，由页面回落到 `getLocale()`。
- start 页客户端在 `?locale=` 显式给出且与 cookie 不一致时写 `NEXT_LOCALE`（与 `LanguageSwitcher` 相同的 cookie 参数）。这样从 `/ja` 首页进来的用户，创建后跳到 `/plan/<id>` 仍是日文；这本来就是该 cookie 的用途（隐私条款已说明）。

### 0.3 locale 传递

- `app/(authed)/layout.tsx`：`const locale = await getLocale()`，传给 `SiteShellPublic`（页头页脚随之三语）。
- `app/(authed)/plan/[id]/page.tsx`：`locale` 传给 `PlanPlanner`。
- 客户端组件统一接收 `locale: SupportedLocale` prop（`PlanPlanner` 向下逐层传，不引入 context；缺省 `'zh'` 以兼容现有测试）。
- 文案键统一放 `lib/i18n/locales/{zh,en,ja}.json` 的 `pages.plan.*`，按组件分子命名空间：`sidebar`、`composer`、`chat`、`thinking`、`ask`、`day`、`transit`、`map`、`thumbnail`、`errors`。占位用现有 `{name}` 风格。
- 日期时间格式：`useClientFormattedTime`、侧栏更新时间等用 `Intl.DateTimeFormat` 按 locale 映射（zh→`zh-CN`，en→`en-US`，ja→`ja-JP`）。

### 0.4 点位名显示

`PlanView.item.point` 增加 `nameEn: string | null`（`repoPrisma` 从 `AnitabiPointI18n(language='en').name` 取，`repoMemory` 同步字段）。新增纯函数 `lib/tripPlan/pointDisplayName.ts`：

- zh → `nameZh ?? name`
- ja → `name`（日文原名）
- en → `nameEn ?? name`（无英文译名时显示日文原名，不显示中文）

用于地图弹层、缩略图 alt、导航链接等需要点位名的地方。行程条目标题 `item.title` 由助手按回复语言写，展示逻辑不变。

### 0.5 助手回复语言：模型自行跟随用户语言

用户决定：**不做语言判定代码，模型自己有能力按用户提问的语言回复（不限于中英日）；我们只加约束，告诉它不要被中文提示词影响。提示词正文不改。**

两层语言并存，边界如下：

| 内容 | 语言来源 |
| --- | --- |
| 页面静态文案、页头页脚、点位显示名、日期格式 | 站点语言（0.1） |
| 服务端固定文案：思维链状态短语、补齐兜底标题/备注、接口错误 | 站点语言（三语字典，0.6） |
| 助手回复、模型自己输出的过程文字、模型写的条目标题/note/reason/追问选项 | 用户最近一条消息的语言，由模型判断 |

**提示词**：`PLAN_AGENT_SYSTEM_PROMPT` 正文原样保留（中文）。改动只有两处：

1. "语气"段里的"中文回复"四字删掉，其余语气要求保留。
2. 末尾追加固定一段（不随 locale 变化，无需 `buildSystemPrompt(locale)`）：

```
## 回复语言
- 始终使用用户最近一条消息所用的语言回复，不限于中文、英文、日文。用户换语言，你就跟着换。
- 本提示词、工具说明、工具返回结果都是中文，这不代表要用中文回复；不要被它们带偏。
- 条目标题、note、reason、追问选项也用用户的语言写；日本地名保留原文，必要时加对应语言的说明。
- 餐食条目标题用该语言的"午餐 / 晚餐"对应词。
```

`PlanAgentDeps` 增加 `locale: SupportedLocale`，取值为**站点语言**（agent 路由从 `getLocale()` 取），只用于 0.6 的服务端固定文案，不参与模型回复语言。

**思维链**：服务端状态短语（工具在做什么）是固定集合，走 0.6 三语字典按站点语言取；模型自己输出的过程文字受上面语言段约束。

### 0.6 服务端用户可见文案

新增 `lib/planAgent/serverText.ts`：TS 字典，键固定、三语齐全，签名 `serverText(locale): ServerTextDict`。收纳：

- `statusPhrases.ts` 的思维链短语（按工具名映射）。
- `netErrors.ts` 的瞬时网络错误文案。
- 服务端补齐写入的用户可见标题/备注：餐食兜底标题、交通直线估算标签（`步行 · 约 N 分钟` 类）、餐厅/图片补齐 note。
- 路由与 handler 的错误响应：未登录、每日创建上限、计划忙碌、停止确认等（`plans.ts`、`planById.ts`、`agent/route.ts` 共约 16 处）。

调用方：agent 循环与补齐器用 `deps.locale`；handler 用 `getLocale()`。两者都是站点语言。

## 组件改造与行数

- `ui.tsx` 现 742 行，已贴近 750 上限；接文案前先拆出 `components/PlanComposer.tsx`（输入框、草稿、发送/停止按钮）和 `components/ChatPane.tsx`（消息列表 + 思维链挂载），拆分为纯搬运，不改行为。
- `DayCards.tsx` 676 行，只替换文案；若超限，把点位卡操作按钮组拆到 `DayPointActions.tsx`。
- 其余组件只替换文案并接 `locale` prop。

## 测试

- `tests/i18n/resolveRequestLocale.test.ts`：前缀 / cookie / Accept-Language / 兜底四级优先级，非法 cookie 值忽略。
- `tests/middleware/i18n-redirect.test.ts` 补：`/plan/x` 带 `NEXT_LOCALE=ja` 时 `x-seichigo-locale=ja`；无 cookie 英文浏览器为 `en`；重定向行为不变。
- `tests/i18n/planKeys.test.ts`：`pages.plan.*` 三语叶子键一致（复用 `homeKeys.test.ts` 的 `flatten`）。
- 组件测试（`tests/plan/**`）：每个组件补 `locale='en'` 用例，断言渲染文本不含 CJK（`/[一-龥぀-ヿ]/`），点位名除外；`locale='ja'` 至少一处关键文案。
- `tests/tripPlan/pointDisplayName.test.ts`：三语回退。
- `tests/planAgent/prompt.test.ts`：提示词不含"中文回复"，含"## 回复语言"段；其余段落与改动前逐字一致。
- 路由测试：`NEXT_LOCALE=en` 请求下 `runPlanAgent` 收到 `locale: 'en'`，SSE 状态短语为英文。
- `tests/planAgent/serverText.test.ts`：三语键齐全；`statusPhrases`/`netErrors` 现有测试改为按 locale 断言。
- 主会话验收：Playwright 分别带 `NEXT_LOCALE=zh/en/ja` 打开预览的 `/plan/<id>`，截图并检查页面文本；在同一计划里依次用中、英、日各发一条消息，确认每轮回复与模型过程文字跟随该条消息的语言；思维链状态短语为站点语言。

## 分批与分工

文件不相交，两条 lane 并行；§0 定义的 prop 与字典形状即接口。

- **A 后端 / 数据（opencode glm-5.3 max）**：`lib/i18n/{resolveRequestLocale,getLocale}.ts`、`middleware.ts`、`app/(authed)/layout.tsx`、`app/(authed)/plan/[id]/page.tsx`、`app/(authed)/plan/start/{page.tsx,locale.ts}`、`app/api/me/plans/[id]/agent/route.ts`、`lib/tripPlan/{view,repoPrisma,repoMemory,pointDisplayName}.ts`、`lib/tripPlan/handlers/**`、`lib/planAgent/{prompt,loop,serverText,statusPhrases,netErrors}.ts`、`lib/planAgent/enrich/**`、`lib/planAgent/placeBackstop.ts`，及对应 `tests/i18n`、`tests/middleware`、`tests/tripPlan`、`tests/planAgent`。
- **B 前端（Claude Opus）**：`app/(authed)/plan/[id]/{ui.tsx,components/**,hooks/**}`、`app/(authed)/plan/start/ui.tsx`（写 cookie）、`lib/i18n/locales/*.json`（`pages.plan.*`）、`tests/plan/**`、`tests/i18n/planKeys.test.ts`、`tests/components/**` 中受影响的页头测试。
- **C 主会话**：合并、全量 vitest / tsc / typecheck:tests / line-budget、预览部署与三语验收。

## 风险与取舍

- 提示词正文不动，只追加语言段，对规划质量影响最小；回复语言完全靠模型判断，不苛求百分百。验收时三语各真跑一次完整规划，若发现被中文工具结果带偏，再加强语言段措辞。
- 服务端思维链短语只能三语且跟站点语言；用户用第四种语言（如韩文）提问时，回复是韩文而短语是站点语言，可接受。
- 页面静态文案跟站点语言、对话跟提问语言，两者可能不一致（英文站用中文提问 → 英文界面 + 中文对话）。这是用户明确要的行为。
- 三份 locale JSON 会随 `t()` 进客户端包，plan 页已因 start 页引入过，增量约 150 键 × 3，可接受。
- 英文用户看到日文原名点位是有意为之：巡礼导航时原名比中译名更有用；有 `AnitabiPointI18n` 英文名时优先英文。
- 老计划（中文历史）在英文站打开会出现"中文历史 + 英文界面"的混排，属预期；不回写历史。
- `NEXT_LOCALE` cookie 一旦写入，裸 `/` 不再按浏览器语言跳转（现有逻辑），与 `LanguageSwitcher` 行为一致，不算回归。
