# 分享 v2 Track A 评审修复简报

评审对象：分支 `feat/share-v2` 的 `060fbab..HEAD`。每条一个 commit（低危可合并一个），先测试后实现。commit message 末尾带：
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```
约束同执行简报：只动 Track A 文件 + `lib/share/**`；不 push、不迁移库、不部署、不新建 worktree。`prisma/migrations/20260908020000_anitabi_point_address` 未应用到任何库，需要时可直接改。

## F1（中）`isInJapan` 改为对真实轮廓做点在多边形内判定
两矩形并集把五岛列岛（32.70N,128.84E，《ばらかもん》全部点位）判成海外，又把釜山、海参崴判成日本。改法：
1. 把 `components/share/data/japan-outline.json` 复制为 `lib/share/data/japan-outline.json`（Track B 会改为从这里 import 并删掉旧文件，你不要碰 components 下那份）。
2. `lib/share/types.ts` 的 `isInJapan(lat, lng)`：先用整体 bbox 快速排除，再对 34 个环做射线法（ray casting）判定，任一环内为 true。1097 个点，成本可忽略。
3. 测试用例：五岛福江岛 (32.70,128.84) → true；对马 (34.4,129.3) → true；东京 → true；釜山 (35.18,129.08) → false；海参崴 (43.12,131.9) → false；首尔、台北、上海 → false；与那国岛 (24.45,122.93) → false 并注明轮廓数据本身不含。
4. `JAPAN_BBOX` 导出改为从 JSON 的 bbox 派生，注释改为「整体外接框，仅供参考；判定见 isInJapan」。`tests/share/types.test.ts` 那条「bbox 四角都在框内」的用例删掉，换成上面的点集。

## F2（中）地理编码未命中时缩短公共缓存
`lib/share/handlers/pointContext.ts`：`geo != null && address == null` 时 `cache-control: public, max-age=300`，否则 86400。测试两条。

## F3（中）限流表跨日清理 + 全局日预算
1. `checkPointContextRate`：跨日且 `rateCounters.size > 5000` 时删掉所有 `day !== today` 的 key。
2. `PointContextRepo` 加 `countResolvedSince(since: Date): Promise<number>`（内存与 Prisma 都实现，Prisma 数 `AnitabiPointAddress.resolvedAt >= since`）；handler 在调 geocode 前检查当日已回填数 `>= 2000` 则跳过 geocode（address 留 null，按 F2 短缓存）。常量 `DAILY_GEOCODE_BUDGET = 2000` 导出。测试：预算耗尽时 `geocode` 不被调用。

## F4（中）`animeTitle` 兜底按 locale 确定
`pointContextRepo.ts` 行类型加 `bangumiTitles: { zh: string|null, jaRaw: string|null, original: string|null, romaji: string|null, english: string|null }`，Prisma 与内存实现填充；handler：`localizedBangumiTitle || (ja: jaRaw||original; en: english||romaji; zh: zh) || candidates[0]`。Prisma 的 `bangumi.i18n` 查询加 `orderBy: { language: 'asc' }`。测试三种 locale 的兜底。

## F5（低，一个 commit）
- `displayName.ts` 的 `foldTitleText`：`toLowerCase` 逐字符做，长度变化时放弃折叠该字符；注释改为「全角 ASCII + 表意空格折叠，不含半角片假名」。测试 `'İX カフェ'` 用例。
- `geocode.ts`：`/` 取前段只对 `zh` 生效。
- `handlers/pointContext.ts`：`findPoint` 与 `findAddress` 用 `Promise.all` 并发。
- `prisma/schema.prisma` 的 `AnitabiPointAddress` 注释补一句「不建外键：anitabi 同步管线会整表覆盖点位，外键会级联删除或阻塞写入；孤儿行接受」。
- 海外点位（`!isInJapan`）地址拼接补上 `country` 段（en 末尾 `, Japan` 风格；zh/ja 前置）。测试一条旧金山 fixture。

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；`npx prisma validate` 通过。汇报每条 commit 与测试关键行。
