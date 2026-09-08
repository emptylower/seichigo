# 分享卡片 v2.1：导航胶囊版（站长已定稿）

设计稿（横版 B 已选定，竖版按同一结构）：https://claude.ai/code/artifact/8680d7d0-e302-4f4e-afd8-6fa255e7285e
本轮只改前端卡片绘制与三语文案。分支 `feat/share-card-v2-1`，worktree `/Users/mac/Desktop/seichigo-wt-share-b`。

## 定稿版面

### 横版 1200×630
- 左：动画截图 640 宽（有实拍则左右各 320）。
- 右列 x 从 672 起，右边距 36，上边距 34：
  1. 点位名 40px/700 `#0f172a`，1 行省略
  2. 作品行 26px/600 `#db2777`：`《作品》 · 第 N 集`（ja 用『』，en 无书名号；时间戳保留在作品行末尾，如 ` · 19:54`）
  3. 地址行 24px `#334155`，左侧矢量图钉（现有）
  4. 说明 22px `#64748b`，**最多 2 行**省略
  5. 弹性留白
  6. **导航胶囊**：背景 `#fdf2f8`，边框 1px `#fbcfe8`，圆角 16，内边距 14×16，横向排列、垂直居中、间距 14：
     - 左：日本轮廓 100×100（现有绘制，无 `inJapan` 时不画，胶囊左侧直接从文字开始）
     - 中（弹性）：三行——`share.cardQrTitle` 22px/700 `#be185d`；坐标行 19px 等宽 `#334155`，左侧 GPS 十字圆标（圆环 + 四向短线，`#ec4899`，尺寸同字号）；`share.cardQrSub` 15px `#64748b`
     - 右：二维码 100×100，白底、边框 1px `#fbcfe8`、圆角 8、内边距 4
  7. 页脚（胶囊下方 16px）：左 `⛩ seichigo.com` 20px/500 `#64748b`（鸟居用现有矢量或现有字符均可，保持与 v2 一致）；右 `share.cardTagline` 16px `#94a3b8` 右对齐；宽度不够时省略右侧。
- **删除**二维码下方的小 logo 绘制与 `/brand/web-logo.png` 加载。

### 竖版 1080×1440
- 顶：截图 640 高（有实拍则上下各 320）。
- 文字区左右边距 64，上边距 36：点位名 60px/700 最多 2 行 → 作品行 38px/600 → 地址行 34px → 说明 32px 最多 2 行。
- 弹性留白。
- 导航胶囊（同横版结构，尺寸放大）：圆角 24，内边距 24×28，间距 24；轮廓 180×180；中列三行 34px/700、28px 等宽、22px；二维码 180×180，内边距 6，圆角 12。
- 页脚（胶囊下方 24px）：左 30px/500，右 `share.cardTagline` 24px。
- 几何必须保证：胶囊底部 + 24 + 页脚高度 ≤ 1440 − 36；说明 2 行时依然成立（用 `size*1.2` 作行高）。

### 无坐标 / 无地址 / 非日本
- `geo` 为 null：坐标行不画，胶囊中列只剩两行，垂直居中。
- 地址为空：地址行不画，下面的行上移。
- `inJapan` 为 false：胶囊不画轮廓，中列左移。

## i18n 新 key（三语齐全，`tests/i18n/shareKeys.test.ts` 登记）
| key | zh | ja | en |
|---|---|---|---|
| `share.cardQrTitle` | 扫码获取点位导航 | スキャンで現地ナビ | Scan for directions |
| `share.cardQrSub` | 地图 · 交通 · 周边点位 | 地図 · 交通 · 周辺スポット | Map · Transit · Nearby spots |
| `share.cardTagline` | 5 万+ 动画取景地 · AI 巡礼行程 | 5万+ のアニメ聖地 · AI 巡礼プラン | 50,000+ anime locations · AI trip planner |

v2 的 `share.cardValueLine` 若已存在则删除并同步测试（定稿里没有价值行，胶囊标题承担这个作用）。

## 输入
- `PointShareCardInput` 加 `geo: [number, number] | null`；`PointSharePanel` 传 `context?.geo ?? null`。坐标显示 `纬度, 经度`，各保留 4 位小数，逗号后一个空格，字体 `ui-monospace, SFMono-Regular, Menlo, monospace`。

## 工作方式与约束
- 顺序：C1 输入与坐标行几何 → C2 胶囊几何与绘制（横版）→ C3 竖版 → C4 页脚与 logo 删除 → C5 i18n 与三语测试。每条一个 commit，先测试后实现，message 末尾带：
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```
- 先读：`components/share/pointShareCardDraw.ts`、`PointShareCard.tsx`、`PointSharePanel.tsx` 的 `cardInput`、`lib/share/types.ts`、`lib/i18n/locales/*.json` 的 `share` 段、`tests/components/pointShareCard*.test.ts*`、`tests/i18n/shareKeys.test.ts`。
- 只动 `components/share/**`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`；`lib/share/**` 只 import。不 push、不切分支、不新建 worktree、不 build、不部署。`node scripts/check-line-budget.mjs` 必须 OK。
- 几何测试：胶囊各元素在画布内且互不重叠；两种版式说明 2 行时页脚仍在画布内；无坐标 / 无地址 / 非日本三种情况各一条。

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；汇报每条 commit sha、测试关键行、与简报出入处。
