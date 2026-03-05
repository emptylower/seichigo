# Complete Mode 交互适配计划（Anitabi 逻辑继承版）

## 目标

在本项目的**完整底图模式（complete mode）**中，继承 Anitabi 的“缩放分层展示逻辑”，但做页面级适配，不做逐像素复刻。

需要满足：

1. 与当前页面交互兼容，尤其要考虑本项目的全景切换阈值（`PANORAMA_TRIGGER_ZOOM`）。
2. 继承“选中作品后，纯色点会切换/叠加为作品截图展示”的行为。
3. 全部逻辑仅作用于完整底图模式，不影响精简模式（simple mode）。

---

## 既有事实（调研结论）

### Anitabi 的核心机制（已验证）

1. 作品头像层（`bangumis`）在低缩放显示，`maxzoom = 13`。
2. 纯色点层（`bangumi-point`）一直存在，但用 `zoom + priority` 的阶梯过滤控制稀疏/密集。
3. 选中作品时，有作品截图图层（`bangumi-points-theme`），并在高缩放前段显示（`maxzoom = 18`）。
4. 更高缩放时切换到截图卡片层（`points-image`），其数据只在 `zoom > 18` 时灌入。
5. `priority` 是按最近邻距离（米）计算，越孤立越容易在低缩放出现。

### 本项目当前能力（已存在）

1. 已有 complete/simple 模式切换。
2. 已有 complete mode 的全局点源、优先级计算、图层刷写流程。
3. 已有主题截图切片能力（`cutSpriteSheet`）与封面 LRU 加载器（`CoverAvatarLoader`）。
4. 已有点位缩略图加载器（`ThumbnailLoader`），可复用到高缩放截图层。
5. 本项目全景触发缩放阈值：`PANORAMA_TRIGGER_ZOOM = 18.4`。

---

## 适配策略（不是照搬阈值）

### 1) 缩放分层逻辑（完整模式）

使用“相对全景阈值”的适配常量，避免和全景交互冲突：

- `AVATAR_MAX_ZOOM = 13`
- `DETAIL_THEME_MIN_ZOOM = 15.8`（可调）
- `IMAGE_BUILD_ZOOM = max(16.8, PANORAMA_TRIGGER_ZOOM - 0.9)`  
  默认约 `17.5`，提前构建截图卡片数据
- `IMAGE_SHOW_ZOOM = max(17.2, PANORAMA_TRIGGER_ZOOM - 0.5)`  
  默认约 `17.9`，在进入全景前完成“截图层可见”

### 2) 图层职责拆分（complete mode）

1. `complete-bangumi-covers`（已有，改造）  
   仅在未选中作品且 `zoom < AVATAR_MAX_ZOOM` 时显示。

2. `complete-dots`（已有）  
   始终保留，用优先级阶梯过滤（当前 20-tier 保留）。

3. `complete-theme-icons`（新增/由现有 `complete-icons` 改造）  
   仅在“已选中作品”且 `DETAIL_THEME_MIN_ZOOM <= zoom < IMAGE_SHOW_ZOOM` 时显示。  
   图标来自主题切片 sprite（`sprite-*`）。

4. `complete-point-images`（新增）  
   `zoom >= IMAGE_SHOW_ZOOM` 显示。  
   数据由视口内点位动态生成，图片用 `thumb-*` MapImage 管理（LRU）。

### 3) “选中作品后显示截图”继承规则

选中作品时：

1. 点源先按 `bangumiId` 过滤为当前作品（现有逻辑已支持）。
2. 中高缩放优先显示 `complete-theme-icons`（主题截图）。
3. 若某些点无主题 sprite，但有 `imageUrl`，则在 `complete-point-images` 阶段用缩略图补齐。
4. 纯色点 `complete-dots` 始终保留作兜底，避免空层。

---

## 实施方案（文件级）

## Phase 1：图层与常量重构

1. `components/map/CompleteModeLayers.ts`
   - 新增 layer/source 常量：
     - `COMPLETE_THEME_ICONS_LAYER_ID`
     - `COMPLETE_POINT_IMAGES_SOURCE_ID`
     - `COMPLETE_POINT_IMAGES_LAYER_ID`
   - 将现有 `COMPLETE_ICONS_LAYER_ID` 职责收敛为“主题截图层”。
   - 新增 `buildPointImagesLayerSpec(imageShowZoom: number)`。
   - 新增图层显隐 helper（按 `detail + zoom` 统一切换）。
   - `complete-bangumi-covers` 增加 `maxzoom: AVATAR_MAX_ZOOM`（或运行时 visibility 控制）。

2. `features/map/anitabi/shared.ts`
   - 新增适配常量计算函数：
     - `resolveImageBuildZoom(panoramaZoom)`
     - `resolveImageShowZoom(panoramaZoom)`
   - 保持 `PANORAMA_TRIGGER_ZOOM` 为单一真值源。

## Phase 2：完整模式数据管线扩展

1. `components/map/utils/globalFeatureCollection.ts`
   - `InputPoint` 增加 `imageUrl?: string | null`、`density?: number | null`。
   - `FeatureProperties` 增加 `imageUrl`、`density` 字段，供高缩放筛选。

2. `features/map/AnitabiMapPageClientImpl.tsx`
   - 构建 `allInputPoints` 时注入 `point.image` 到 feature properties。
   - complete mode 初始化时创建 `COMPLETE_POINT_IMAGES_SOURCE_ID`。
   - 新增 `ThumbnailLoader` 引用和生命周期管理。
   - 在 `moveend/zoomend`（或节流后的 `move`）中执行：
     - `zoom < IMAGE_BUILD_ZOOM`：清空 point-images source；
     - `zoom >= IMAGE_BUILD_ZOOM`：从当前视口候选点构建图片 features；
     - `zoom >= IMAGE_SHOW_ZOOM`：显示 point-images layer。

3. 候选点策略（性能关键）
   - 先从渲染层命中取候选（优先 `complete-dots` / 过滤后数据）。
   - 仅保留：
     - `imageUrl` 存在；
     - `priority` 满足动态阈值；
     - 点数上限（例如 80~120，按设备分级）。
   - 缩略图通过 `ThumbnailLoader.updateViewport()` 增量加载/淘汰。

## Phase 3：交互继承与命中顺序

1. `features/map/AnitabiMapPageClientImpl.tsx` 点击命中顺序改为：
   - `complete-point-images`
   - `complete-theme-icons`
   - `complete-bangumi-covers`
   - `complete-dots`

2. 保持“选中作品后过滤点源”的现有逻辑，同时驱动主题层显隐。

3. 在 `mapViewMode === 'panorama'` 时可隐藏 point-images，减少视觉冲突（可选）。

## Phase 4：验证与回归

1. `tests/map` 增加：
   - 阈值计算单测（与 `PANORAMA_TRIGGER_ZOOM` 的相对关系）
   - complete mode 分层显隐状态单测
   - 选中作品后截图继承逻辑单测

2. 手工验证清单：
   - 未选中作品：低缩放头像、中缩放纯点、高缩放截图卡片；
   - 选中作品：中缩放主题截图、高缩放截图卡片；
   - `zoom` 接近全景阈值时无“截图全消失”断层；
   - 样式切换（street/satellite）后图层和图片缓存可恢复。

---

## 验收标准

1. 完整模式下，点位展示必须体现“分层切换”而不是单层缩放。
2. 选中作品后，截图展示逻辑必须可见且稳定。
3. 不触发明显性能退化：
   - 高频缩放不应产生大量重复 `addImage/removeImage` 抖动；
   - 缩略图加载受并发与 LRU 上限控制。
4. 不破坏现有：
   - simple mode；
   - 全景模式入口/退出；
   - 点位点击与详情打开流程。

---

## 风险与规避

1. 风险：高缩放图片层和全景入口冲突  
   规避：采用相对阈值（`IMAGE_SHOW_ZOOM < PANORAMA_TRIGGER_ZOOM`）并在临界区预热。

2. 风险：图片层内存抖动  
   规避：复用 `ThumbnailLoader`，严格限制 maxLoaded 与并发。

3. 风险：样式切换后图片丢失  
   规避：在 style reload 后重刷 source + 重新 `updateViewport`。

---

## 新上下文执行顺序（建议）

1. 先做 Phase 1 + Phase 2（层与数据管线），提交一次。
2. 再做 Phase 3（命中与交互细节），提交一次。
3. 最后做 Phase 4（测试与回归），提交一次。

这样即使中途打断，也能保持每次提交都可运行、可回退。
