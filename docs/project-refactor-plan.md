# 全业务重构总计划（执行版）

## 新增前置约束（2026-03-04）
1. `main` 分支冻结用于本次重构开发，不承载任何中间改动。
2. 所有重构变更必须在 `codex/project-refactor` 分支完成。
3. 只有在通过阶段验收后，才允许通过 PR 合并回 `main`。

## 业务目标（完整覆盖）
1. 统一后端架构：`app/api/**/route.ts` 只保留 transport，业务逻辑迁移到 `lib/*/handlers`，依赖从 `lib/*/api.ts` 注入。
2. 降低前端维护成本：拆解超大组件为 container + orchestrator hooks + dumb components。
3. 建立硬性可维护性门槛：`app/components/lib` 单文件 `<= 800` 行（上限，不是目标值）。
4. 提升可靠性：修复测试不稳定点、恢复清晰的类型检查边界、补齐关键 contract tests。
5. 保持业务行为稳定：对外 API、管理后台关键流程、投稿与地图关键流程不改变语义。

## 实施阶段
### Phase 0：基线与护栏
1. 行数检查脚本与白名单（单调下降）。
2. 修复测试基线（含 `useMapMode`）。
3. TS 检查边界拆分（`tsconfig.app.json`、`tsconfig.tests.json`）。

### Phase 1：API 架构一致性
1. 迁移 `admin/translations/*`、`admin/users/*`、`admin/dashboard/summary`、`admin/review/queue` 到 `lib/*/handlers`。
2. 统一 `routeError` 与参数解析策略。

### Phase 2：中等复杂文件拆分模板
1. 优先拆 `admin/ops/ui.tsx`、`admin/seo/ui.tsx`、`admin/translations/[id]/ui.tsx`、`submit/ArticleComposerClient.tsx`、`lib/anitabi/read.ts`。
2. 固化 container + hooks + services + presentational 模板。

### Phase 3：编辑器域深拆
1. 拆 `RichTextEditor.tsx` 与 `FigureImage.tsx`。
2. 严格对齐 `sanitizeRichTextHtml` 契约。

### Phase 4：后台翻译状态机深拆
1. 拆 `admin/translations/ui.tsx`，迁移长流程到 orchestrator hooks。

### Phase 5：地图页重构收口
1. 拆 `AnitabiMapPageClient.tsx` 为多模块编排。

### Phase 6：约束硬化与收尾
1. 超限白名单清零，改为全量硬失败。
2. 输出模块边界文档，作为后续约束。
