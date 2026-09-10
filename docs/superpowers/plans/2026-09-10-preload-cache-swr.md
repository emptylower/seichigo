# preload 边缘缓存加真 stale-while-revalidate（当前 TTL 在真实流量下几乎不命中）

## 问题：实测证据

预览版（version override 定向）实测：

```
连续两次（间隔 3 秒）  → hit, 0.478s / 0.448s
等 310 秒后再打        → miss, 3.950s      ← s-maxage=300 过期
```

Cloudflare Worker 日志，`/map` 过去 24 小时 **1053 次请求**（24 分钟分桶）：

- 日本白天高峰：每桶 24–83 次 ≈ 1–3.5 次/分钟
- 其余时段：大量桶 0–5 次，多个桶为空
- 全天平均 ≈ 0.73 次/分钟，且要再分散到全球各边缘节点

`caches.default` 是**按 colo 分别缓存**的。TTL 只有 300 秒，而单个 colo 在这个流量下经常十几分钟都等不到第二个请求 —— 结论是**真实访客大多数落在冷缓存上**，当前实现的收益在生产几乎兑现不了。

（此前测出的「点位数据 18.6s → 6.2s」是连续猛打出来的热缓存结果，不代表真实体验。）

## 要做的事

在 `lib/anitabi/preloadEdgeCache.ts` 里实现**真正的 stale-while-revalidate**：

1. 缓存条目除了内容，还要记录写入时间（例如写入时附加一个自定义头，如 `x-preload-cached-at`），以便判断新鲜度。
2. 读取时分三种情况：
   - **新鲜**（未超过 fresh TTL）→ 直接返回，标 `hit`。
   - **过期但在 stale 窗口内** → **立刻返回旧内容**（标 `stale`），同时经 `ctx.waitUntil` 在后台重新 compute 并回写缓存。访客不等待。
   - **超出 stale 窗口或无缓存** → 正常 compute，标 `miss`。
3. TTL 取值建议（可在实现时按你判断微调，但要在注释里说明依据）：fresh 300s 保持不变，stale 窗口放到 24 小时量级 —— 点位数据变化很慢，镜像 cron 也只是 5 分钟跑一次增量，落后一个 fresh 周期完全可接受。
4. 缓存条目本身的存活时间要 ≥ fresh+stale，否则 stale 窗口没意义（注意：写入 `caches.default` 时的 TTL 由响应的 `Cache-Control` 决定，需要把用于**存储**的响应头与返回给**浏览器**的响应头区分开——别把长 TTL 泄漏给浏览器，浏览器侧仍应是 s-maxage=300 的口径）。
5. 后台 revalidate 要防并发风暴：同一 key 同时只允许一个在飞的 revalidate（模块级 in-flight Map 即可，跟现有 `sharedState` 类似的思路）。
6. `x-preload-edge-cache` 头的取值扩展为 `hit` / `stale` / `miss`，方便监控区分。

## 验收

- 单测：新鲜期内 → `hit`，不触发 revalidate。
- 单测：进入 stale 窗口 → **立刻**返回旧内容且标 `stale`，并且**确实**经宿主 `ctx.waitUntil`（沿用刚修好的严格宿主替身，能抓 `this` 绑定）调度了一次后台 revalidate。
- 单测：后台 revalidate 完成后，缓存里是新内容。
- 单测：同一 key 并发进入 stale 时只发起一次 revalidate。
- 单测：超出 stale 窗口 → `miss`，走正常 compute。
- 单测：返回给调用方的响应头里**不含**用于存储的长 TTL（浏览器侧仍是 s-maxage=300 口径）。
- 无 Cloudflare context / 无 caches 时优雅退化为直通，行为不变。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支 `perf/map-integration`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。只加新提交，不要 rebase。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令，不要跑 `npm run build`。
- 不要碰 `lib/anitabi/imageNormalize.ts` / `imageMirrorVariants.ts` / `features/map/**` / `components/map/**`。
- 保持既有缓存 key 口径（endpoint + locale + index）不变。
- 完成后用简短中文汇报：TTL 取值与依据、stale 分支怎么测的、测试结果。
