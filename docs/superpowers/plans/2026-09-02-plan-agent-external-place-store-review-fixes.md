# 地点库改动 · 评审修复清单（2026-09-02）

对应实现：`docs/superpowers/plans/2026-09-02-plan-agent-external-place-store.md`；设计：`docs/superpowers/specs/2026-09-02-plan-agent-external-place-store-design.md`。
工作方式：先 `git status` / `git diff` 通读现状；每条先补失败测试再改实现。不要 git commit；不要碰 `components/map/**` 与 `tests/map/**`；不要对任何数据库执行迁移。
完成标准：`npx vitest run tests/googlePlaces tests/planAgent tests/plan` 全绿；`npx tsc --noEmit` 无错；简短中文汇报每条修了什么、加了哪些测试。

## 必修（评审 major）

1. **代理参数路由绕过** `lib/googlePlaces/handlers/placePhoto.ts`：现在门槛是 `!isValidPhotoReference(ref) && !isValidPlaceId(placeId)`，路由却是 `if (placeId && !ref)`，于是 `?ref=zz&placeId=<合法id>` 会带着未校验的 ref 走旧路径打到 Google。改为：带 placeId 时 placeId 必须合法（否则 400）并直接走 placeId 路径、忽略 ref；否则 ref 必须合法（否则 400）。测试：`?ref=zz&placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho` 不得触发任何 fetch 且走 placeId 路径；`?placeId=x` 返回 400。
2. **库写入失败仍落 `?placeId=` URL** `lib/googlePlaces/places.ts`：只有 `store.upsert` 真正成功才把 `photo.displayUrl` 生成为 `?placeId=`；store 缺省或 upsert 抛错时回退为 `buildPlacePhotoDisplayUrl({ photoReference })` 的 `?ref=`（否则库不可用/迁移未跑时落库 URL 永久 404）。`safeStore` 对返回 void 的 upsert 无法区分成败，让包装返回布尔。测试：无 store → `?ref=`；store 抛错 → `?ref=`；store 正常 → `?placeId=`。
3. **镜像状态写错** `placePhoto.ts` 的 `finishWithUpstream`：无 bucket 时也调用 background 写成 mirrored；有 bucket 时 put 失败被 catch 后仍写 mirrored。改为：无 bucket 不写状态（保持 none）；put 成功才 `setPhotoMirror({ status: 'mirrored', key: written.key, mirroredAt: new Date() })`；put 失败写 `failed`。`lib/googlePlaces/photoMirror.ts` 的 `mirrorPlacePhoto` 成功时同样补 `mirroredAt`。测试覆盖三个分支。
4. **照片刷新重置 TTL** `storePrisma.ts` / `storeMemory.ts`：`updatePhotoReference` 不得更新 `fetchedAt`（照片引用刷新不能延长 30 天元数据 TTL）。补内存实现测试。

## 顺手修（评审 minor，改动小）

5. `lib/planAgent/placeBackstop.ts`：catch 分支的 `skipped.reason` 用固定文案"地点解析服务异常"，不把 `err.message` 暴露给模型；模糊词不要用 `/自由|…/` 子串匹配（误杀"自由が丘"），改为整词短语：自由时间|自由活动|自由漫步|休息|机动|返程|准备|待定，测试"自由が丘 被解析、自由时间 被跳过"；传给 `resolveByText` 的 query 用 `rawQuery.trim()`（resolver 内部自己归一化做缓存键），归一化值只用于长度/模糊词判断。
6. `lib/planAgent/tools.ts` 的 `save_plan_days`：只对"存在兜底候选条目"的天调用 `points.getPointsByIds` 计算质心，没有候选的天不查库。
7. `lib/googlePlaces/photoFetch.ts`：重定向次数超限与非白名单重定向返回可区分的 status（如 `'redirect'`），handler 映射为 502 并保留原有文案"不支持的重定向"/"重定向过多"。

## 未纳入本轮（记录）
- 403 `denied` 触发引用刷新会在 key 故障期间让每张图多打一次 Google。
- 质心在兜底前冻结，同一天先解析出的地点不会收紧后续条目的 50 km 守卫。
- `storePrisma` 复合外键 upsert 无运行时测试。
