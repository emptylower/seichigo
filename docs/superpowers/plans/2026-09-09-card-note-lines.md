# 卡片说明行填满留白

## 现象
卡片右列的点位说明只显示 2 行，说明到底部胶囊之间大片空白（站长截图确认）。

## 改法
`lib/share/cardHtml.ts`：
1. `.clamp2` 是写死的（`-webkit-line-clamp:2; max-height:2.7em`）。改为按 metrics 生成的通用类：`.clampN{-webkit-line-clamp:${n}; max-height:${(n*1.35).toFixed(2)}em}`，`clamp1` 保留。说明行用 `metrics.noteLines`。
2. 两套 metrics 的 `noteLines` 从 2 调大到刚好填满 name/anime/address 与胶囊之间的空间：**横版先取 8、竖版先取 5**，然后按下面的几何测试校验；放不下就逐级减 1 直到通过，最终值写进 metrics 常量。
3. 说明所在的 `.row.note` 允许在空间不足时收缩：容器加 `min-height:0`，`.spacer` 保持现有 `flex:1` 行为不变（说明短时仍靠 spacer 顶开）。

## 必须新增的几何测试（`tests/share/cardHtml.test.ts`）
用 metrics 里的数值直接算，不依赖浏览器：
- 对两种版式，令说明取满 `noteLines` 行，断言
  `columnTop + 各行高度合计 + capsuleTopGap + 胶囊高度 + footerGap + footerSize + columnBottom <= 画布高度`
  其中行高按 `fontSize * 1.35` 计，行间距用现有 rowGap 常量。
- 断言 `noteLines` 横版 >= 6、竖版 >= 4（防止以后被误改回 2）。
- 断言生成的 HTML 里说明行的 class 与 `metrics.noteLines` 一致。

## 约束
只动 `lib/share/cardHtml.ts` 与 `tests/share/**`。不碰 `components/**`、`app/**`。不 push、不 build、不部署。
每条一个 commit，先测试后实现，message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿。汇报最终采用的 noteLines 数值与测试关键行。
