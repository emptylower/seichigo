# 分享卡片 v2.1：让人一眼看懂「这张图能干什么」

站长看了横版卡片的反馈：右列文字区与底部轮廓/二维码之间大片空白；二维码下方的小 logo 太小没意义；整张卡没有告诉看的人它是什么、能干什么。

本轮只改前端卡片绘制与三语文案。分支 `feat/share-card-v2-1`（基于 main），worktree `/Users/mac/Desktop/seichigo-wt-share-b`。

## 先读
- `components/share/pointShareCardDraw.ts`（几何常量、`buildCardLayout`、`buildCardTextPlan`、`CARD_FONT_SIZES`、`CARD_FOOTER_SIZES`、`addressPinMetrics`）
- `components/share/PointShareCard.tsx`（渲染顺序、`metaLine`、地址行、note、轮廓、二维码、页脚与 logo）
- `components/share/PointSharePanel.tsx` 里 `cardInput` 的组装（`context.geo` 已经拿到但卡片没用）
- `lib/share/types.ts` 的 `PointContextResponse.geo`（`[lat, lng] | null`）
- `lib/i18n/locales/{zh,en,ja}.json` 的 `share` 段与 `tests/i18n/shareKeys.test.ts`
- `tests/components/pointShareCard.test.tsx`、`pointShareCardDraw.test.ts`

## 要做的（每条一个 commit，先测试后实现，message 末尾带两行）
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

### C1 卡片输入加坐标，文字区新增「坐标行」
- `PointShareCardInput` 加 `geo: [number, number] | null`；面板传 `context?.geo ?? null`。
- 文字区在 note 之后新增坐标行：左侧画一个小的 GPS 十字圆标（圆环 + 十字线，品牌粉 `#ec4899`，尺寸同地址图钉），右侧文字 `35.4735, 138.5867`（纬度在前，保留 4 位小数，逗号后一个空格），字体用 `ui-monospace, SFMono-Regular, Menlo, monospace`，字号同 note 行，颜色 `#334155`。`geo` 为 null 时不画该行。
- `buildCardTextPlan` 加 `coord` 行类型；几何测试：坐标行存在时仍在底部带之上。

### C2 「价值行」
- 坐标行之后空 6px，画一行品牌粉小字（字号 = note 字号 - 2，`font-weight 600`）：三语 key `share.cardValueLine`
  - zh：`动画取景地 · 实地坐标 · 一键导航`
  - ja：`アニメの舞台 · 現地座標 · ワンタップで案内`
  - en：`Anime location · Real coordinates · One-tap navigation`
- 横版右列若剩余高度不足以放下价值行（按几何算），则省略 note 行保住价值行；竖版空间足够，两者都画。

### C3 二维码说明替换小 logo
- 删除 `loadImage('/brand/web-logo.png')` 与页脚右侧 logo 绘制。
- 二维码下方（横版：二维码正下方，居中对齐二维码；竖版同）画两行：
  - 第一行 `share.cardQrTitle`（品牌粉 `#db2777`，`font-weight 700`，字号 = 页脚字号）：zh `扫码获取点位导航` / ja `スキャンで現地ナビ` / en `Scan for directions`
  - 第二行 `share.cardQrSub`（`#64748b`，字号 = 页脚字号 - 6）：zh `地图 · 交通 · 周边点位` / ja `地図 · 交通 · 周辺スポット` / en `Map · Transit · Nearby spots`
- 二维码尺寸与位置按需要上移，保证两行说明在页脚之上且不与轮廓框重叠；更新 `buildCardLayout` 的 `qr` 与新增 `qrCaptionY`。

### C4 页脚补站点说明
- 页脚左侧保持 `⛩ seichigo.com`；右侧（横版右对齐到画布右边距，竖版同）画 `share.cardTagline`（`#94a3b8`，字号 = 页脚字号 - 4）：zh `5 万+ 动画取景地 · AI 巡礼行程` / ja `5万+ のアニメ聖地 · AI 巡礼プラン` / en `50,000+ anime locations · AI trip planner`
- 若右侧与左侧文字宽度之和超过可用宽度，省略右侧。

### C5 横版右列重排（把空白用掉）
右列从上到下：点位名（1 行）→ 作品·集数 → 地址行 → note（1 行）→ 坐标行 → 价值行 → 底部带（轮廓 150 左，二维码 110 右 + 两行说明）→ 页脚。重算常量，几何测试覆盖：
- 所有文字行底部 < 底部带顶部；二维码说明第二行底部 < 页脚顶部；轮廓框与二维码列水平不重叠；文字右缘 ≤ 画布右边距。
竖版同样插入坐标行与价值行，底部带位置按需要下调，几何测试同上。

## 约束
- 只动 `components/share/**`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`。`lib/share/**` 只 import。
- 不 push、不切分支、不新建 worktree、不 build、不部署。`node scripts/check-line-budget.mjs` 必须 OK。
- 新 key 三语齐全并在 `tests/i18n/shareKeys.test.ts` 登记；删除不再使用的 key 也要同步测试。

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；汇报每条 commit sha、测试关键行、与简报出入处。
