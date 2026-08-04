# AdSense 就绪度 — 第二轮任务交接

**交接给：** Codex（执行方）
**交接自：** Claude Code
**日期：** 2026-08-04
**前置文档：** [`HANDOFF.md`](./HANDOFF.md)（第一轮）、[`../superpowers/plans/2026-08-04-adsense-readiness-fixes.md`](../superpowers/plans/2026-08-04-adsense-readiness-fixes.md)（主计划）
**当前 HEAD：** `2218ac0`（`main` == `origin/main`）

---

## 0. 背景：第一轮结果与两处判断修正

第一轮（Task 0–10）已完成并上线，工程侧修复全部生效。你在汇报中提出的"严格验收缺口"，经实测后结论如下——**两条都不需要你改代码**：

### 修正一：sitemap 根 URL 的 307 不是缺陷，是验收命令写错了

`HANDOFF.md` §12 的抽样命令我写成了 `-A "Mozilla/5.0"`，那不是爬虫 UA。实测 `https://seichigo.com/`：

| User-Agent | 响应 |
|---|---|
| `Googlebot/2.1` | **200** |
| `Mediapartners-Google` | **200** |
| `AdsBot-Google` | **200** |
| `Google-InspectionTool/1.0` | **200** |
| `Mozilla/5.0`（普通浏览器） | 307 → `/ja` |

所有 Google 爬虫在根 URL 都直接拿到 200。你测出的那一条 307 是命令本身造成的。**不要动首页地域分流逻辑，改验收标准即可**（见 T1）。你提的两个选项都不用选。

### 修正二：Task 14 的性质与主计划的假设不同

主计划让你 `grep` 组件找硬编码中文。**那套方法修不了实际问题**——残留中文不在组件里，在内容数据层。详细诊断数据见 T3，那是本轮的主任务。

---

## 1. 硬性禁止（继承第一轮 + 本轮新增）

| 禁止 | 原因 |
|---|---|
| **不要改首页地域分流** | 见修正一。爬虫已全部 200，改动只会引入新风险 |
| **不要做"首页语言提示横幅"改造** | 这是已记入 backlog 的可选优化，属 UX 改动，需独立验证周期。**申请提交前绝对不动** |
| **不要碰 Cloudflare 控制台** | 规范域已由站主处理完毕（apex 为规范，www 单跳 308 到 apex，`seichigo-apex-redirect` Worker） |
| **不要执行部署命令、不要 `git push`** | 仓库约定：部署前必须跑 `seichigo-predeploy-guard`；从不自动推送 |
| **不要重构 root layout / 不要改 `<html lang>`** | 主计划 Task 15 已明确决定不做 |
| **不要动 Phase 5（Task 16–19）** | `ads.txt`、CMP、广告位规范必须等 AdSense 批准后 |
| **不要修改 frontmatter 的 `animeId`** | 那是标识符不是展示文本，改了会断链（见 T3 §3.4） |
| **不要用 CJK 字符数当日文页的质量指标** | 日文本身用汉字，`[一-龥]` 必然命中，这个信号对 ja 无意义（见 T3 §3.5） |

---

## 2. 本轮任务清单

| 优先级 | 任务 | 阻塞申请？ | 预估 |
|---|---|---|---|
| **P0** | T1 修正 `HANDOFF.md` §12 验收标准并重跑取证 | 否（但影响判定） | 20 分钟 |
| **P0** | T2 提交未跟踪的文档 | 否 | 10 分钟 |
| **P1** | T3 三语内容翻译缺口（原 Task 14 重新定义） | 否，审核期并行 | 1–2 天 |
| **P2** | T4 评论审核与举报机制（原 Task 13） | 否，审核期并行 | 1 天 |

**站主并行在做的事（与你无关，不要等）：** 主计划 Task 11 的 7 项账户确认、Task 12 在 AdSense 后台添加站点并提交审核。

---

## T1 — 修正验收标准并重新取证【P0】

**Files:** `docs/adsense/HANDOFF.md`

- [ ] **Step 1: 把 §12 与 §11 中所有线上验证命令的 UA 换成真实爬虫 UA**

`HANDOFF.md` §11 的"部署后线上复验命令"里，sitemap 抽样那一段：

```bash
# 改成这样（UA 换成 Googlebot）
GBOT="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
curl -s "$BASE/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' | head -20 | while read -r u; do printf '%-58s ' "${u:0:56}"; curl -s -o /dev/null -w '%{http_code}\n' -A "$GBOT" "$u"; done
```

- [ ] **Step 2: 在 §12 的判定条件中，把 sitemap 那一条改写清楚**

原文：`sitemap 抽样 20 条 URL 全部直接 200，无 3xx`
改为：`sitemap 抽样 20 条 URL 在 Googlebot UA 下全部直接 200，无 3xx。（根 URL `/` 对普通浏览器 UA 返回 307 → 语言首页，属首页地域分流的预期行为，不是缺陷——所有 Google 爬虫 UA 均直接 200。）`

- [ ] **Step 3: 重跑取证，把输出贴进汇报**

```bash
BASE=https://seichigo.com
GBOT="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
curl -s "$BASE/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' | head -20 | while read -r u; do printf '%-58s ' "${u:0:56}"; curl -s -o /dev/null -w '%{http_code}\n' -A "$GBOT" "$u"; done
```

预期：20/20 全部 `200`。若仍有 3xx，**停下汇报**，不要自行推断原因。

- [ ] **Step 4: 补齐页脚链接的取证（替代"浏览器点击截图"）**

原验收要求"三语页脚逐个浏览器点击"，改用可复现的命令取证：

```bash
GBOT="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
for base in "" /en /ja; do
  echo "--- 语言前缀: ${base:-/(zh)} ---"
  curl -s -A "$GBOT" "https://seichigo.com${base:-/}" | grep -oE 'href="[^"]*(help|status)[^"]*"' | sort -u
done
echo "--- 确认全站无占位链接 ---"
for base in "" /en /ja; do printf '%-6s href="#" 出现次数: ' "${base:-/}"; curl -s -A "$GBOT" "https://seichigo.com${base:-/}" | grep -c 'href="#"'; done
```

预期：三语各自输出指向本语言前缀的 `/help`、`/status`；`href="#"` 计数三行全为 `0`。

- [ ] **Step 5: 提交**

```bash
git add docs/adsense/HANDOFF.md && git commit -m "docs(adsense): correct verification UA and clarify homepage 307 exemption"
```

---

## T2 — 提交未跟踪的文档【P0】

当前工作区有未跟踪文件，其中 `docs/adsense/HANDOFF.md` 是第一轮的交接依据，必须入库。

- [ ] **Step 1: 查看未跟踪清单**

```bash
git status --porcelain
```

- [ ] **Step 2: 提交 AdSense 相关文档**

至少包含 `docs/adsense/HANDOFF.md`、`docs/adsense/HANDOFF-ROUND-2.md`（本文件）、`docs/superpowers/plans/2026-08-04-adsense-readiness-fixes.md`。

其余未跟踪文件（`docs/in-app-navigation-roadmap.md`、`docs/product-business-spec.md`、`docs/superpowers/specs/*` 等）**与本任务无关，不要顺手提交**——它们属于别的工作线，混进来会污染提交历史。若不确定某个文件归属，在汇报里列出来问，不要自己决定。

```bash
git add docs/adsense/ docs/superpowers/plans/2026-08-04-adsense-readiness-fixes.md
git commit -m "docs(adsense): track handoff and remediation plan"
```

---

## T3 — 三语内容翻译缺口【P1，本轮主任务】

**这是主计划 Task 14 的重新定义。原描述（grep 组件硬编码中文）无效，以本节为准。**

### 3.1 诊断数据（我已实测，不需要你重新采集）

**线上英文页中文字符数**（用 Googlebot UA 抓取，已剔除 `<script>`）：

| 页面 | 中文字符数 | 性质 |
|---|---|---|
| `/en/posts/sound-euphonium-kumiko-bench-prefectural-shrine-jr-uji`（文章正文） | **0** | ✅ 干净 |
| `/en/anime` | 5 | 轻微 |
| `/en/city` | 21 | 轻微 |
| `/en`（首页卡片列表） | 294 | 主要来源 |

**`content/generated/public-posts-en.json`（41 篇）的 frontmatter 含中文字段统计：**

| 字段 | 命中篇数 | 处理方式 |
|---|---|---|
| `city` | 36 / 41 | **不改内容，改渲染层查表**（见 3.3） |
| `tags` | 36 / 41 | 同上 |
| `title` | **3 / 41** | **直接修内容，最高优先级**（见 3.2） |
| `description` | 3 / 41 | 同上 |
| `seoTitle` | 2 / 41 | 同上 |
| `animeId` | 30 / 41 | **不要动**，是标识符（见 3.4） |

### 3.2 最高优先级：3 篇英文文章的标题与描述整体是中文

这三篇在 `/en/posts/` 下线上可访问，AdSense 审核员会看到英文站点里出现纯中文标题——这是本轮最需要修的东西，比卡片标签严重得多。

| slug | 当前 title | 当前 seoTitle |
|---|---|---|
| `2-sound-euphonium` | 《吹响吧！上低音号》圣地巡礼②：黄檗・上学路 | Sound Euphonium Pilgrimage Obaku School Road Uji Anime Locations（这条已是英文） |
| `kamisuwa-your-name` | 上诹访：你的名字圣地巡礼，探访糸守湖的真实灵感 | 上诹访 你的名字 圣地巡礼 糸守湖 诹访湖 长野 动漫景点 |
| `part1` | 《你的名字》圣地巡礼：东京新宿篇 | 你的名字 圣地巡礼 东京 新宿 \| Kimi no Na wa Seichi Junrei Part 1 |

三篇的 `description` 也全是中文。

- [ ] **Step 1: 定位这三篇的源文件**

```bash
for s in 2-sound-euphonium kamisuwa-your-name part1; do echo "--- $s ---"; grep -rl "slug: *\"\?$s\"\?" content/en content/zh 2>/dev/null; done
```

`content/generated/` 是构建产物，**不要直接改它**——找到 `content/en/` 下的源文件改。

- [ ] **Step 2: 翻译 title / seoTitle / description**

作品名用官方英文译名，不要音译：
- 《吹响吧！上低音号》→ `Sound! Euphonium`
- 《你的名字》→ `Your Name.`（官方英文片名带句点）

地名用通行罗马字：上诹访 → `Kamisuwa`，糸守湖 → `Lake Itomori`，诹访湖 → `Lake Suwa`，黄檗 → `Ōbaku`，新宿 → `Shinjuku`，须贺神社 → `Suga Shrine`。

`seoTitle` 保持 SEO 关键词密度，参照同目录下已经是英文的那些文章的写法。

- [ ] **Step 3: 重新生成 content/generated 并验证**

```bash
npm run build   # 或仓库中生成 content/generated 的对应脚本，先确认是哪个
node -e "
const d=require('./content/generated/public-posts-en.json');const cjk=/[一-龥]/;
const bad=d.filter(p=>cjk.test(p.frontmatter?.title||'')||cjk.test(p.frontmatter?.description||'')||cjk.test(p.frontmatter?.seoTitle||''));
console.log('仍含中文的 EN 文章数:',bad.length, bad.map(p=>p.frontmatter.slug));
"
```

预期：`0 []`。

- [ ] **Step 4: 提交**

```bash
git commit -m "fix(content): translate remaining Chinese titles in English posts"
```

### 3.3 城市名与作品名：改渲染层查表，不要改 41 篇 frontmatter

**架构判断（请遵守）：** `city` 在 36 篇 frontmatter 里重复出现，逐篇翻译会产生 36 处可漂移的副本。数据库里**已经有现成的翻译字段**：

```prisma
model City {
  name_zh String
  name_en String?     // ← 已有
  name_ja String?     // ← 已有
  ...
}

model Anime {
  name       String
  name_en    String?  // ← 已有
  name_ja    String?  // ← 已有
  summary_en String?
  summary_ja String?
}
```

正确做法是**渲染层按当前 locale 查表取显示名，回退到中文**，而不是改内容文件。

- [ ] **Step 1: 查明当前翻译覆盖率**

`lib/translation/` 已有覆盖率与未翻译项的现成能力（`adminCoverage.ts`、`handlers/untranslated`、`handlers/backfill`）。先用 admin 接口或直接查库统计 `Anime.name_en / name_ja` 与 `City.name_en / name_ja` 的空值比例，把数字写进汇报。**不要凭感觉估。**

- [ ] **Step 2: 补齐缺失的 `name_en` / `name_ja`**

走已有的翻译队列（`lib/translation/service.ts` + `mapTaskEnqueue.ts`），不要绕过它手写 SQL。作品名必须用**官方译名**而非机翻——`吹响吧！上低音号` 的英文是 `Sound! Euphonium`、日文是 `響け！ユーフォニアム`，机翻会给出错误结果。这类专有名词建议人工确认后再入库，或先入 `TranslationTask` 走审批流。

- [ ] **Step 3: 渲染层改为查表**

定位首页卡片、`/anime`、`/city` 列表的渲染组件，把直接显示 `frontmatter.city` / `anime.name` 改为按 locale 取 `name_en` / `name_ja`，空值回退中文。**这一步要有单元测试**：给定 locale 与一条 `name_en` 为空的记录，断言回退到中文且不抛错。

- [ ] **Step 4: 线上验证（部署后由站主执行，你只需给出命令）**

```bash
GBOT="Mozilla/5.0 (compatible; Googlebot/2.1;)"
for p in /en /en/anime /en/city; do printf '%-12s 中文字符数: ' "$p"; curl -s -A "$GBOT" "https://seichigo.com$p" | sed 's/<script[^>]*>.*<\/script>//g' | grep -o "[一-龥]" | wc -l | tr -d ' '; done
```

目标：`/en` 从 294 降到接近 0；`/en/anime`、`/en/city` 归零。

### 3.4 `animeId` 不要动

统计显示 30 篇的 `animeId` 含中文。**这是标识符不是展示文本**，用于关联 `Anime` 表与路由。修改会断链、破坏已索引的 URL。**保持原样。**

如果它在某处被当作展示文本渲染了（这才是真问题），定位后改成显示 `Anime.name_en/name_ja`，而不是改 ID 本身。

### 3.5 日文内容：CJK 计数无效，真实问题是作品名用了中文译名

`content/generated/public-posts-ja.json` 的 41 篇里，`title`/`seoTitle`/`description`/`city`/`tags` **全部命中 `[一-龥]`**。这不代表有问题——**日文本来就用汉字**，这个正则对 ja 没有判别力。不要用它当指标，也不要据此"修复"日文内容。

真实问题需要人工目检。已发现的一例：

```
content/generated/public-posts-ja.json
title: 「吹響吧！上低音號」聖地巡礼①：六地蔵・木幡・京都散点（路線＆点位速覽）
```

`吹響吧！上低音號` 是繁体中文译名，日文原名应为 `響け！ユーフォニアム`。同理 `路線＆点位速覽` 的 `速覽` 也不是日语用词。

- [ ] **Step 1: 抽查 ja 内容的作品名与栏目用词**

不要写正则，改为：列出 41 篇 ja 文章的 `title` 与 `seoTitle`，人工（或让模型逐条判断）标出使用了中文译名/中文用词的条目，产出一份清单。

- [ ] **Step 2: 按清单修正**

作品名统一用日文官方名。修正前**先跑 `npm run glossary:build`** 并参考 `lib/i18n/glossary.json`，保证与站内其他位置一致。

- [ ] **Step 3: 若清单较长，分批提交**，每批一个提交，提交信息说明修了哪几篇。

### 3.6 T3 验收

- [ ] `content/generated/public-posts-en.json` 中 `title`/`description`/`seoTitle` 含中文的篇数为 **0**
- [ ] 线上 `/en` 中文字符数显著下降（给出改前 294 / 改后的实测数字）
- [ ] `/en/anime`、`/en/city` 中文字符数为 0
- [ ] ja 作品名清单已产出，已修正的条目有提交记录，未修正的在汇报中列出并说明原因
- [ ] 渲染层回退逻辑有单元测试覆盖
- [ ] `npm test`、`npm run typecheck:app`、`npm run typecheck:tests` 全绿

---

## T4 — 评论审核与举报机制【P2】

即主计划 Task 13，范围与设计不变，此处只强调边界。

**最小可行范围，不要扩大：**

1. `prisma/schema.prisma` 的 `Comment`（约第 367 行）增加 `status String @default("visible")`（取值 `visible` / `hidden`）、`hiddenAt DateTime?`、`hiddenBy String?`。默认 `visible` 保证现有评论行为不变。
2. 新增 `CommentReport` 模型：`id`、`commentId`、`reporterId`、`reason`、`createdAt`，加 `@@unique([commentId, reporterId])` 防重复举报。
3. `lib/comment/handlers/comments.ts` 的 `list` 只返回 `status = 'visible'`。
4. 举报接口：**必须遵守仓库的分层约定** —— `app/api/**/route.ts`（薄包装）→ `lib/comment/api.ts`（`getCommentApiDeps` 注入）→ `lib/comment/handlers/*.ts`（逻辑）。不要把逻辑写进 route。举报需登录。
5. 评论 UI 加举报按钮。
6. 复用已有 `/admin` 后台，加评论管理页：查看被举报评论、隐藏 / 恢复 / 删除。

**明确不做先审后发。** 评论需登录且量小，事后审核足够；先审后发会压死社区活跃度。

**迁移命令：**

```bash
npm run db:migrate:dev -- --name comment_moderation
```

**必读：** `lib/comment/AGENTS.md`（repo 模式与 memory double 的写法）、`app/api/AGENTS.md`（route 包装与响应约定）。测试参照 `tests/comment/` 已有用例。

---

## 3. 仓库约定提醒（与第一轮相同，容易忘的几条）

- **行数预算 750 行**（`line-budget.allowlist.json`，`AGENTS.md` 里写的 800 已过时）。`npm test` 会先跑预算检查，不过则测试根本不启动。
- **测试扩展名决定环境**：`.test.ts` → node，`.test.tsx` → jsdom。T3 的渲染层测试若渲染 React 组件，用 `.test.tsx`。
- **路径别名**：`@/lib/*`、`@/components/*`，不要写相对路径。
- **Prisma 单例** `@/lib/db/prisma`，不要新建客户端。
- **不要用 `as any` / `@ts-ignore`**。
- 一个 Task 一次提交，conventional commits 格式。

---

## 4. 汇报要求

做完 T1 + T2 立刻汇报一次（它们很快，且 T1 关系到申请判定）。T3、T4 各自完成后再汇报。

**每次汇报必须包含：**

- 实际命令输出，不要凭印象声称结果。特别是 T1 Step 3 的 sitemap 20 行输出、T3 的中文字符数改前改后对比。
- 每个 Task 的提交 hash 与提交信息。
- 有没有动 `line-budget.allowlist.json`。
- **遇到与本文档诊断数据矛盾的现象时，停下汇报，不要自行修改结论或扩大范围。**

**汇报中需要明确回答的问题：**

1. T2 里那些与 AdSense 无关的未跟踪文件（`docs/in-app-navigation-roadmap.md` 等），归属是哪条工作线？（列出来即可，不要自行处理）
2. T3 §3.3 的翻译覆盖率实际数字是多少？
3. T3 §3.5 的 ja 作品名问题清单有多少条？其中多少条你能确定官方日文名、多少条需要人工确认？

---

## 5. 提交申请的当前判定

工程侧已不阻塞。剩余阻塞项全部在站主侧：

- [ ] 主计划 Task 11 的 7 项账户确认（**最关键两条**：若已有旧 AdSense 账户必须在旧账户内添加站点，重复开户会封号；开户表单不要勾"面向儿童"）
- [ ] 主计划 Task 12：后台添加 `seichigo.com`、安装验证代码、提交审核

**T3 与 T4 不阻塞提交。** 英文文章正文已实测 0 中文字符，残留集中在索引页卡片与 3 篇文章的标题——建议站主先提交申请，T3 在审核期并行完成。
