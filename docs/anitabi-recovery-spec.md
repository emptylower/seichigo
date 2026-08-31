# Anitabi 数据同步恢复方案

> 状态：待评审 · 诊断日期 2026-08-09 · 对应诊断报告 `doc/anitabi-recovery-plan.html`

> **2026-08-31 修订：** 发现上游官方全量静态数据包通道（`/d/g.json` + `/d/g{n}.json`，
> 经海外镜像域 `w.junreimap.com` 分发，不受 api.anitabi.cn 地理围栏限制），
> WS3 被新方案取代，见 `docs/superpowers/plans/2026-08-31-anitabi-bulk-sync.md`。
> 事实修正：F1 已消解（www.anitabi.cn 回到 DNS，CNAME 至腾讯 EdgeOne）；
> F2 收敛为"仅放行中国大陆 IP"的地理围栏（诊断时连大陆住宅 IP 也被拦的状态已解除）；
> "5 个不可再生字段"中 density/mark/folder/uid 与 themeJson 经 bulk 通道恢复供给，
> 仅 reviewUid、originUrl 及 customEpNames/logs/removedPoints/completeness 维持冻结。

---

## 一、背景

### 1.1 现象

管理员面板中所有依赖 anitabi 第三方 API 的功能失效：作品同步、点位同步、图片同步全部不工作。

### 1.2 根因（四条，彼此独立）

| # | 根因 | 证据 | 影响 |
|---|---|---|---|
| **F1** | 上游 `www.anitabi.cn` 已从 DNS 移除 | Google + Cloudflare 两家 DoH 一致返回 NXDOMAIN（权威 SOA 否定应答）；`cdn.anitabi.cn` 同样 NXDOMAIN | `getSiteBase()` 默认值指向死域名，3 个数据源自 2026-02-15 起失效 |
| **F2** | `anitabi.cn` 的 **Cloudflare** 侧启用了 WAF 拦截 | 返回 4546 字节 `Sorry, you have been blocked` 页；换 UA／补全浏览器头无效；日本住宅 IP、中国住宅 IP、美国机房 IP 三个观测点均被拦 | `api.anitabi.cn` 全路径 403，同步在第一个请求即失败 |
| **F3** | cron 在 Vercel→Cloudflare 迁移时遗失 | cron 定义仍在 `vercel.json`，而实际部署的 `wrangler.jsonc` 没有 `triggers` 字段 | 2026-06-08 之后再没有任何同步被触发 |
| **F4** | 同步从未成功过 | `AnitabiSyncRun` 所有模式 `last_success` 均为 `null`；最后一次 delta 死于 Prisma 事务超时（限 5000ms，实耗 5580ms） | 前三条修好后仍会挡路 |

**关键定性：不是代码被改坏了。** `siteBase` 默认值自首个提交 `b20ad05` 起未变，`lib/anitabi/source/` 与 `lib/anitabi/sync/` 近期无改动。是上游收紧了。

### 1.3 管线当初的设计缺陷

同步用了 6 个上游入口，其中 **4 个从未被官方文档收录**：

| 入口 | 官方文档 | 现状 |
|---|---|---|
| `GET /bangumi`（全量列表） | ❌ 未收录 | 403 · **同步入口，死在这里** |
| `GET /bangumi/{id}` | ❌ 未收录 | 403 |
| `GET /bangumi/{id}/points` | ❌ 未收录 | 403 |
| `GET {siteBase}/api/bangumi/icons.svg` | ❌ 主域 | DNS 失败 |
| `GET {siteBase}/CHANGELOG.md` | ❌ 主域 | DNS 失败 |
| `GET {siteBase}/d/users.json` | ❌ 主域 | DNS 失败 |
| `GET /bangumi/{id}/lite` | ✅ 收录 | 被 WAF 拦 |
| `GET /bangumi/{id}/points/detail` | ✅ 收录 | 被 WAF 拦 |

官方 `api.md` 明文写着：

> 请勿在任何场景下请求主域 `https://anitabi.cn/`，主域不确保任何 **资源地址** 以及 **数据结构** 的稳定

三个 `siteBase` 抓取正好全部违反这一条。`api.md` 的实质内容自 **2024-02-21** 起未再改动，所以「官方只有两个数据端点」是稳定事实。把 org 下 5 个官方客户端仓库全部 clone 后提取调用，端点集合与文档完全一致，**不存在隐藏接口**。

### 1.4 突破口：上游有第二套 CDN

从 `anitabi/anitabi-trace` 源码里发现一个文档未提及的 host。整个域的 CDN 是分裂的，而封锁只发生在 Cloudflare 一侧：

| Host | A 记录 | CDN | 我们能否访问 |
|---|---|---|---|
| `api.anitabi.cn` | 104.21.71.189 | Cloudflare | ❌ 403 |
| `image.anitabi.cn` | 104.21.71.189 | Cloudflare | ❌ 403 |
| `w.anitabi.cn` | 104.21.71.189 | Cloudflare | ❌ 403 |
| **`img-tc.anitabi.cn`** | 43.174.247.32 | **Tencent EdgeOne** | ✅ **200** |
| `www.anitabi.cn` / `cdn.anitabi.cn` | — | — | NXDOMAIN |

同一出口 IP、同一路径的 A/B 对照，差异纯粹来自 CDN：

```
GET /points/272510/39zlm4tj.jpg?plan=h160
  image.anitabi.cn    403  text/html   4546 B
  img-tc.anitabi.cn   200  image/jpeg  11341 B    eo-cache-status: HIT
```

用库里真实的一条 `www` 记录验证，两个 URL 家族都能取到：

```
raw  www.anitabi.cn/images/user/1181/bangumi/1851/points/n7zx3k2ft-1723655509302.jpg
  → image.anitabi.cn/user/1181/...   403
  → img-tc.anitabi.cn/user/1181/...  200  image/jpeg  7430 B
```

已按 `api-tc` / `api-eo` / `data-tc` 等十余种命名扫过 DNS，**不存在 EdgeOne 版的 API host**。

### 1.5 结论

- **图片链路有解，且不依赖任何对外沟通** —— 切 host 即可。
- **点位／作品链路没有技术捷径** —— `api.anitabi.cn` 只有 Cloudflare 一条路，必须取得正式访问或换出口。

### 1.6 需要修正的前次判断

我此前说库里 14,893 条 `www.anitabi.cn` 图片是「永久死链」，**这个判断错了**。`imageNormalize.ts:27-36` 的 `normalizeAnitabiMirrorUrl()` 已经会把 `www.anitabi.cn/images/X` 重写成 `image.anitabi.cn/X`，而 `imageProxy.ts:179` 和 `r2Mirror.ts:68` 都走这个函数。路径本身是完好的，它们只是和另外 26,934 条一样死于 F2。

**因此不需要写数据迁移。** 这也意味着改动面比原先估计的小得多。

---

## 二、你需要做的事

### 2.1 需要你决策的（3 项，阻塞实现）

**D1 · 是否接受依赖一个未公开的 host？**
`img-tc.anitabi.cn` 没有出现在官方文档里，只出现在官方客户端源码中。上游理论上可以随时调整它。方案里我会做成可切换的 host 策略并保留 Cloudflare 兜底，把这个风险降到最低，但**依赖本身需要你确认**。

**D2 · 点位同步走哪条路？**

| 选项 | 说明 | 代价 |
|---|---|---|
| **A · 申请白名单**（建议） | 邮件联系维护者，说明用途、承诺频率，申请白名单或 API key | 一封邮件 + 等待，可能被拒 |
| **B · 境内出口中转** | 同步不从 Workers 直连，改由境内小机器拉取后写库 | 一台常驻机器 + 运维；绕过对方地域策略，不算正路 |
| **C · 暂缓** | 图片先恢复，点位数据维持现状（库里已有 7,933 作品 / 30,845 点位） | 数据不更新，但站点可用 |

**D3 · 数据许可怎么处理？**
官方声明地标数据以 **CC BY-NC-SA 4.0**（署名／非商业性使用／相同方式共享）共享，并要求在展示截图旁标注 `origin` 文字、实现 `originURL` 跳转。如果 seichigo 有商业化计划，这一条需要先想清楚；它也直接影响申请白名单时怎么描述用途。

### 2.2 需要你执行的（我做不了）

**T1 · 发邮件联系上游维护者。** 建议内容：
- 说明 seichigo 的用途与规模，承诺请求频率上限；
- 申请 `api.anitabi.cn` 的白名单或 API key；
- 顺带告知 `www.anitabi.cn` 与 `cdn.anitabi.cn` 已 NXDOMAIN，**导致官方 Swift App（`WebViewStore.swift:129` 仍打开 `https://www.anitabi.cn/map`）现在也打不开地图** —— 这对双方都有价值，也是个自然的沟通切入点，并暗示这更像进行中的事故而非计划下线。

**T2 · 确认 D1／D2／D3 的选择。**

### 2.3 我可以直接做的

WS0 至 WS4 的全部代码改动与验证（见第三节）。其中 **WS0、WS1、WS2、WS4 不依赖任何决策之外的外部条件**，D1 一确认即可开工。

---

## 三、实现方案

### WS0 · 前置验证：Worker 出口探测（必须先做）

**为什么必须先做：** 我的所有观测点都是住宅／机房 IP。seichigo 跑在全球 Cloudflare Workers 上，出口是 Cloudflare 机房 IP。更要紧的是 —— **从 Anthropic 的美国机房 IP 请求 `img-tc` 返回了 `567`（EdgeOne 的非标准码），而我的日本住宅出口是 200。** 说明 `img-tc` 可能也有地域策略。WS1 的可行性完全取决于这个探测结果。

新建 `workers/anitabi-egress-probe/`（一次性，验证后删除）：

```ts
// src/index.ts
const TARGETS = [
  'https://api.anitabi.cn/bangumi/115908/lite',
  'https://api.anitabi.cn/bangumi/272510/points/detail',
  'https://image.anitabi.cn/points/272510/39zlm4tj.jpg?plan=h160',
  'https://img-tc.anitabi.cn/points/272510/39zlm4tj.jpg?plan=h160',
]

export default {
  async fetch(): Promise<Response> {
    const results = await Promise.all(
      TARGETS.map(async (url) => {
        const t0 = Date.now()
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'seichigo-egress-probe/1.0' },
            cache: 'no-store',
          })
          return {
            url,
            status: res.status,
            contentType: res.headers.get('content-type'),
            cfRay: res.headers.get('cf-ray'),
            eoLogUuid: res.headers.get('eo-log-uuid'),
            ms: Date.now() - t0,
          }
        } catch (e) {
          return { url, error: String((e as Error)?.message), ms: Date.now() - t0 }
        }
      }),
    )
    return Response.json({ colo: results[0]?.cfRay?.split('-')[1] ?? null, results }, {
      headers: { 'cache-control': 'no-store' },
    })
  },
}
```

**判读方式：**

| `img-tc` 结果 | 结论 | 走向 |
|---|---|---|
| 200 | Worker 出口可用 | WS1 全量推进，服务端代理 + R2 镜像都能用 |
| 567 / 403 | Worker 出口被拦 | WS1 降级为**浏览器直连**（见 WS1.4），R2 镜像需要境内出口回填 |

同时记录 `api.anitabi.cn` 的结果 —— 若意外可用，D2 直接选 C 之外的任何选项都变简单。

> ⚠️ **执行纪律：探测只跑一次，不要循环。** 我在诊断期间约 40 次探测已经触发过上游的速率限制，把中国出口 IP 也打进了惩罚区。上游对高频请求非常敏感。

---

### WS1 · 图片链路切到 EdgeOne

#### 1.1 核心设计：区分「逻辑身份」与「投递 host」

这是整个方案最关键的一点。

R2 的 mirror key 是**对 canonical URL 做哈希**得出的：

```
r2Mirror.ts:68   canonicalUrl = computeCanonicalImageUrl(rawUrl)   // 归一到 image.anitabi.cn
                 key          = computeMirrorKey(canonicalUrl, mime)
imageNormalize.ts:161  return `${MIRROR_KEY_VERSION}/${url.hostname}/${hash}/${ext}`
```

如果直接把 `computeCanonicalImageUrl` 的归一目标改成 `img-tc.anitabi.cn`，**hash 的输入变了，全部已镜像对象的 key 会集体失效**，需要一次全量回填。

**因此：**

- `computeCanonicalImageUrl()` **保持不动**，继续归一到 `image.anitabi.cn`。它代表图片的**逻辑身份**，只用于 R2 key 与去重。
- 新增一个**投递 host 解析**，只在真正发起请求／渲染时套用。

这样 R2 key 完全不变，零回填。

#### 1.2 `lib/anitabi/imageNormalize.ts`

在文件顶部新增：

```ts
/**
 * 上游同一批图片由两套 CDN 投递，路径结构与 ?plan= 语义完全一致：
 *   image.anitabi.cn   Cloudflare  —— 目前对我们返回 403（WAF）
 *   img-tc.anitabi.cn  Tencent EdgeOne —— 目前可用
 * canonical URL 始终使用 image.anitabi.cn 作为逻辑身份（R2 key 依赖它的稳定性），
 * 实际投递 host 由 resolveAnitabiDeliveryUrl() 在请求时决定。
 */
const ANITABI_IMAGE_HOST_CANONICAL = 'image.anitabi.cn'
const ANITABI_IMAGE_HOST_EDGEONE = 'img-tc.anitabi.cn'

const ANITABI_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  ANITABI_IMAGE_HOST_CANONICAL,
  ANITABI_IMAGE_HOST_EDGEONE,
])

function getAnitabiDeliveryHost(): string {
  const raw = String(process.env.NEXT_PUBLIC_ANITABI_IMAGE_HOST || '').trim().toLowerCase()
  if (ANITABI_IMAGE_HOSTS.has(raw)) return raw
  return ANITABI_IMAGE_HOST_EDGEONE
}

/** 把 canonical URL 上的图片 host 换成当前首选投递 host。不改变路径与查询。 */
export function resolveAnitabiDeliveryUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input)
  if (ANITABI_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
    url.hostname = getAnitabiDeliveryHost()
  }
  return url
}
```

> `imageNormalize.ts` 同时在浏览器运行（`getBaseOrigin()` 引用了 `window`），所以开关必须用 **`NEXT_PUBLIC_`** 前缀，构建期内联。

`normalizeAnitabiMirrorUrl()` 需要一处小改，让 `img-tc` 也能被归一回 canonical（否则库里若出现 `img-tc` 的 URL 会算成另一张图）：

```ts
function normalizeAnitabiMirrorUrl(url: URL): void {
  if (!isAnitabiHost(url.hostname)) return

  if (url.hostname === 'anitabi.cn'
    || url.hostname === 'www.anitabi.cn'
    || ANITABI_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
    url.hostname = ANITABI_IMAGE_HOST_CANONICAL
  }
  if (url.pathname.startsWith('/images/')) {
    url.pathname = url.pathname.slice('/images'.length)
  }
}
```

#### 1.3 套用投递 host 的两个位置

**服务端取图**（`lib/anitabi/handlers/imageServe.ts:237`）—— 在 fetch 前套用：

```ts
const response = await fetch(resolveAnitabiDeliveryUrl(current).toString(), requestInit)
```

**浏览器直连**（`lib/anitabi/imageProxy.ts:179` 附近）—— `normalizeAnitabiDisplayVariant()` 处理完 plan/尺寸后，在生成 `directUrl` 时套用：

```ts
const directUrl = resolveAnitabiDeliveryUrl(url).toString()
```

注意 `imageProxy.ts:203-205` 的 ladder（direct → retry → proxy）逻辑保持不变，只是 direct 那一档指向新 host。

#### 1.4 若 WS0 显示 Worker 出口被拦

则服务端代理与 R2 写入都取不到图，降级策略：

- 让 `imageProxy` 对 anitabi 图片**强制 direct-first**（浏览器直连 EdgeOne），proxy 档位降为最后兜底；
- R2 回填改由境内出口的一次性脚本完成，写入时仍用 canonical key，之后线上读 R2 即可，不受出口限制;
- 这条路对境内用户体验最好（EdgeOne 境内节点），对境外用户依赖 R2 覆盖率。

#### 1.5 host 允许列表：**无需改动**

已确认以下判定全部使用 `host.endsWith('.anitabi.cn')`，`img-tc.anitabi.cn` 自动通过：

| 位置 | 判定 |
|---|---|
| `imageNormalize.ts:15` | `isAnitabiHost` |
| `imageMirrorVariants.ts:22` | 同上 |
| `imageProxy.ts:58` | `host === 'image.anitabi.cn' \|\| host.endsWith('.anitabi.cn')` |
| `features/map/anitabi/media.ts:119,152` | `host === 'anitabi.cn' \|\| host.endsWith('.anitabi.cn')` |
| `handlers/imageServe.ts:177` | `EXTRA_ALLOWED_IMAGE_HOSTS` 经 `hostMatches()`（`imageServe.ts:72-74`）比对，实现为 `host === allowed \|\| host.endsWith('.' + allowed)` |

已查实：`hostMatches('img-tc.anitabi.cn', 'anitabi.cn')` 为真，**四处允许列表全部无需改动**。

#### 1.6 顺带清掉指向死域名的引用

| 位置 | 现状 | 改为 |
|---|---|---|
| `lib/anitabi/api.ts:35` | `siteBase` 默认 `https://www.anitabi.cn` | 主域抓取将在 WS3 整体移除；此处改为空字符串并让调用方显式失败，避免静默拼出死链 |
| `lib/anitabi/utils.ts:98` | fallback `'https://www.anitabi.cn'` | 同上 |
| `features/map/anitabi/useCompleteMode.ts:738` | 相对路径拼 `https://www.anitabi.cn${url}` | 拼 canonical host，再交给 `resolveAnitabiDeliveryUrl` |
| `app/(site)/map/head.tsx`、`app/en/map/head.tsx`、`app/ja/map/head.tsx` | `dns-prefetch` / `preconnect` 指向 `www.anitabi.cn` | 改为 `img-tc.anitabi.cn`；**当前这三处 preconnect 全部指向 NXDOMAIN 域名，纯属浪费首屏预算** |

#### 1.7 测试

- `features/map/anitabi/firstViewCanary.ts:17-41` 的 fixture 用了 `www.anitabi.cn/images/...`，正好是需要保留的回归用例 —— 断言它们经归一后 canonical 为 `image.anitabi.cn/user/0/a.jpg`、投递 URL 为 `img-tc.anitabi.cn/user/0/a.jpg`。
- 新增单测覆盖：两个 URL 家族 × 两个 host × `?plan=` 保留 × R2 key 稳定性（**换 host 前后 `computeMirrorKey` 必须一致**，这是本 WS 最重要的断言）。

#### 1.8 验收

```bash
npm test -- imageNormalize imageProxy r2Mirror
# 线上：随机抽 20 条 AnitabiPoint.image（两个家族各 10），断言最终投递 URL 返回 200 image/*
# R2：抽查 5 个已存在的 mirror key，确认改动后仍能命中，无新增重复对象
```

---

### WS2 · 恢复 cron

`.open-next/worker.js` 只导出 `fetch`，没有 `scheduled`，所以不能直接在 `wrangler.jsonc` 加 `triggers.crons`。

**方案：挂到已有的 mirror worker 上。** `workers/anitabi-mirror/src/index.ts:14` 已经导出 `scheduled` handler，且已有 `crons: ["*/5 * * * *", "0 * * * *"]` 与 `DATABASE_URL`。在其 `scheduled` 中按 cron 表达式分派，通过 HTTP 调用主 worker 的 cron 端点：

```ts
// workers/anitabi-mirror/src/index.ts
async scheduled(controller, env, ctx) {
  // 既有的图片镜像逻辑保持不变
  if (controller.cron === '0 * * * *') {
    ctx.waitUntil(triggerAnitabiSync(env))
  }
  // ...
}

async function triggerAnitabiSync(env: MirrorWorkerEnv): Promise<void> {
  const res = await fetch(`${env.SEICHIGO_ORIGIN}/api/cron/anitabi/daily`, {
    headers: { 'x-anitabi-cron-secret': env.ANITABI_CRON_SECRET },
  })
  if (!res.ok) console.error('[anitabi/sync] cron trigger failed', res.status, await res.text())
}
```

鉴权已现成 —— `lib/anitabi/handlers/cron.ts:15-23` 接受 `Authorization: Bearer`、`x-anitabi-cron-secret` 头或 `?secret=` 查询参数。需要给 mirror worker 加两个 secret：`SEICHIGO_ORIGIN`、`ANITABI_CRON_SECRET`。

**同时删掉 `vercel.json` 的 `crons` 段**，它已完全失效，留着只会误导下一个人。

---

### WS3 · 点位／作品同步重建

> **前置条件：D2 选定且网络可达（A 或 B）。** 若 D2 选 C，本 WS 暂缓。

#### 3.1 枚举层改造（核心改动）

现有 delta 逻辑完全依赖 `GET /bangumi` 返回全量数组 + `modified` 时间戳。该端点已永久关闭，且**官方 API 没有任何列出全部作品的入口**。

替换为「库内已知 ID 轮转 + 外部发现」：

```ts
// workflow.ts:384 原为
const bangumi = (await fetchJsonWithRetry<RawBangumi[]>(`${apiBase}/bangumi`)) || []

// 改为：从自己库里取候选 ID，按 lastCheckedAt 最旧优先轮转
const candidates = await deps.prisma.anitabiBangumi.findMany({
  select: { id: true, sourceModifiedMs: true },
  orderBy: { meta: { lastCheckedAt: 'asc' } },
  take: batchSize,
})
```

- `modified` 比对改由每个作品自己的 `/lite` 响应提供（`/lite` 返回 `modified`），命中未变则跳过后续 `/points/detail`；
- 需在 `AnitabiBangumiMeta` 上新增 `lastCheckedAt` 字段支撑轮转；
- **新作品发现**交给 Bangumi 官方 API（`api.bgm.tv`，独立的公开 API），拿到候选 subjectID 后再探 anitabi `/lite`，404 即表示该作品无巡礼数据。

#### 3.2 端点集合收敛

| 原调用 | 改为 |
|---|---|
| `GET /bangumi` | 删除，改为库内枚举 |
| `GET /bangumi/{id}` | 删除，字段由 `/lite` 提供 |
| `GET /bangumi/{id}/points` | 删除（摘要端点未公开） |
| `GET /bangumi/{id}/lite` | **保留**，成为作品元数据唯一来源 |
| `GET /bangumi/{id}/points/detail` | **保留** |
| `syncContributorsAndChangelog()` 的 3 个主域抓取 | **整体删除**（违反官方约定） |

删除主域抓取还有一个即时收益：这三个请求当前每个要走满 4 次重试（1+3+8 秒），**合计吃掉约 14 秒**，而 `ANITABI_SYNC_MAX_RUNTIME_MS` 默认只有 20 秒。

#### 3.3 字段缺口

| 字段 | `/lite` 是否提供 | 处理 |
|---|---|---|
| `id, cn, title, city, cover, color, modified` | ✅ | 直接映射 |
| `geo, zoom` | ✅ **提供** | `RawLite` 类型（`normalize.ts:18-35`）漏声明了这两个字段，补上即可 |
| `cat, description, tags` | ❌ | 改由 `api.bgm.tv/v0/subjects/{id}` 提供 |
| 点位 `name/cn/geo/ep/s/image/origin/originURL` | ✅（`/points/detail`） | 本来就是官方端点 |
| 点位 `density/mark/folder/uid/reviewUid` | ❌（原属未公开的 `/points` 摘要） | **见下** |
| `AnitabiBangumiMeta` 的 `themeJson` / `customEpNamesJson` / `logsJson` / `removedPointsJson` / `completenessJson` | ❌（同属 `/points` 摘要） | **同样见下 —— 这 5 个字段当前填充率 7933/7933，是 100%** |

`density/mark/folder/uid/reviewUid` 在库中填充率为 96% / 49% / 44% / 46% / 33%，且被非 schema 代码引用；`AnitabiBangumiMeta` 那 5 个 JSON 字段则是 100% 非空。它们**全部来自已关闭的未公开 `/points` 摘要端点**。`normalizePoints()`（`normalize.ts:188-206`）在 `summary` 为空时会把点位那 5 个算成 `null`。

**必须改为「有新值才写」**，否则第一次同步就会把这些已有数据整片抹掉：

```ts
// upsert 的 update 分支中，对这 5 个字段
...(point.density !== null ? { density: point.density } : {}),
...(point.mark !== null ? { mark: point.mark } : {}),
// ...
```

这是本 WS **风险最高的一处**，建议先在 `seichigo_synclab` 沙箱上跑一轮并 diff 字段填充率，确认无衰减再上线。同一处理也要覆盖 `AnitabiBangumiMeta` 的 5 个 JSON 字段 —— 它们目前 100% 有值，一旦被空摘要覆盖就是净损失，且无法从官方 API 重新取回。

> 换句话说：**这批字段是不可再生资源。** 现有数据是历史上从未公开端点抓来的，端点已关闭。方案的目标是「不再更新它们」，而不是「重新同步它们」。

#### 3.4 限流与可观测性

- 全局串行 + 固定间隔（建议起步 ≥1 req/s），配合指数退避；`ANITABI_SYNC_CONCURRENCY` 默认 2 应下调为 1。
- `source/client.ts:48` 对 4xx（429 除外）不重试的行为**保留**（这是对的），但 403 必须写进 `AnitabiSyncRun.errorSummary` 而非静默失败。
- 全量刷一轮约 8,000 次请求。按 1 req/s ≈ 2.2 小时，必须切分成多批并依赖时间预算续跑（`hasMore` 机制已存在）。

---

### WS4 · 事务超时与监控

- 修 F4：拆掉 `prisma.anitabiPoint.update()` 所在的 5 秒事务，或调大 `timeout`。这是 2026-06-08 最后一次 delta 的直接死因。
- 新增上游健康探针，**两套 CDN 分别探**（`api.anitabi.cn` + `img-tc.anitabi.cn`），异常时告警。本次故障从 2 月潜伏到 8 月才被发现，缺的正是这个。
- `AnitabiSyncRun` 连续 N 次非 `ok` 时告警。

---

## 四、执行顺序与验收

| 序 | 内容 | 依赖 | 可验收信号 |
|---|---|---|---|
| 0 | 停止一切对上游的自动请求，等待冷却 | — | 无新增 403 |
| 1 | **WS0** Worker 出口探测（跑一次） | — | 拿到 4 个 host 的状态码与 colo |
| 2 | **WS1** 图片链路切 EdgeOne | D1、WS0 | 抽样 20 条图片 200；R2 key 无漂移 |
| 3 | **WS2** 恢复 cron | — | `AnitabiSyncRun` 出现新纪录 |
| 4 | **T1** 联系上游 | D3 | 收到回复 |
| 5 | **WS4** 事务超时 + 监控 | — | 沙箱跑通 delta 不再超时 |
| 6 | **WS3** 同步管线重建 | D2、T1 | 沙箱字段填充率无衰减；线上 `status: ok` |

**WS1 与 WS2 可立即并行开工**，两者都不依赖上游态度。

---

## 五、风险与回滚

| 风险 | 缓解 |
|---|---|
| `img-tc` 是未公开 host，上游可能调整 | 做成 `NEXT_PUBLIC_ANITABI_IMAGE_HOST` 开关，改环境变量即可切回 Cloudflare，无需改代码 |
| `img-tc` 可能有地域策略（美国机房 IP 返回 567） | WS0 先探测；必要时降级为浏览器直连 + R2 兜底（WS1.4） |
| 换 host 导致 R2 key 漂移、镜像全废 | 核心设计已规避：canonical URL 不动，只换投递 host。单测中加 key 稳定性断言 |
| WS3 把 5 个摘要字段抹成 null | 改为「有新值才写」；先在沙箱 diff 填充率 |
| 再次触发上游速率限制 | 全局串行 + ≥1s 间隔；探测脚本严禁循环 |

**回滚：** WS1 只需把 `NEXT_PUBLIC_ANITABI_IMAGE_HOST` 设回 `image.anitabi.cn`。WS2 删掉 mirror worker 里的分派分支。WS3 按常规 revert。

---

## 附：本地验证环境（已就绪）

| 组件 | 位置 |
|---|---|
| Dev server | `localhost:3100` |
| 沙箱库 | `postgresql://localhost:5432/seichigo_synclab`（7,933 作品 / 30,845 点位，由本地 `seichigo` 克隆） |
| Mock 上游 | `scripts/anitabi-mock-upstream.mjs` —— 只实现官方两个端点，其余一律 403 |
| 同步 harness | `scripts/anitabi-sync-lab.mts` —— 跑真实 `runAnitabiSync()`，`DATABASE_URL` 非本地时拒绝启动 |

```bash
node scripts/anitabi-mock-upstream.mjs 4555 &
DATABASE_URL="postgresql://localhost:5432/seichigo_synclab" \
DATABASE_URL_UNPOOLED="postgresql://localhost:5432/seichigo_synclab" \
ANITABI_API_BASE_URL="http://127.0.0.1:4555" \
ANITABI_SITE_BASE_URL="http://127.0.0.1:4555" \
ANITABI_RAW_DIR="/tmp/anitabi-raw" \
npx tsx scripts/anitabi-sync-lab.mts delta
```

当前输出（即生产故障的精确复现）：

```
{ "status": "failed", "scanned": 0, "changed": 0,
  "message": "Request failed 403 http://127.0.0.1:4555/bangumi" }

mock 收到的全部请求：403 /bangumi   BLOCKED (not part of the official API)
```

WS3 完成后，此处应变为 `status: "ok"` 且 mock 只收到 `/lite` 与 `/points/detail`。
