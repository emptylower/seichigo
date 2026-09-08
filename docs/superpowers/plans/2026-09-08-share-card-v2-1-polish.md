# 分享卡片 v2.1 收尾两处

本地真机渲染后发现两处，改掉即可，仍然测试先行，每条一个 commit，message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## P1 横版说明行断行把收尾标点挤到第二行
现象：说明「東京【CLANNAD　羽村駅周辺＋DVDジャケット】」在横版渲染成两行，第二行只有一个「】」。
原因：`wrapLines` 的可用宽度按 `textWidth` 算，但实际绘制起点/右边距与之有出入，尾字符正好越界一点点。
改法：横版说明行的换行宽度改为 `textWidth - 8`（留 8px 安全余量），并在断行结果只剩一个「孤字」（第二行渲染宽度 < 该行字号 × 2）时，把它并入上一行并以省略号收尾。抽成 `pointShareCardDraw.ts` 的纯函数 `avoidOrphanTail(lines, measure, maxWidth, fontSize)`，两种版式的说明行与点位名都走它。
测试：给定「…ジャケット】」这类尾部，2 行限制下不出现只含 1-2 个字符的末行；正常长文本断行结果不变。

## P2 竖版说明只有 1 行时上方留白过大
现象：竖版说明占 1 行时，文字块与胶囊之间空出很大一块。
改法：竖版主视觉高度由固定 640 改为「基础 640 + 文字块少于满行时的补偿」，具体：先按实际行数算出文字块高度 `textBlockH`，主视觉高度 = `min(760, 640 + (满行textBlockH − 实际textBlockH))`，其余几何跟着算；满行时维持现有 640，胶囊与页脚位置不变。compare 布局（有实拍）同样适用，上下两张各占一半。
测试：说明 1 行时主视觉高度 > 640 且胶囊 y 不变；说明 2 行 + 点位名 2 行（满行）时主视觉仍为 640；主视觉高度上限 760 不被突破。

## 约束
只动 `components/share/**`、`tests/components/**`。不 push、不切分支、不 build、不部署。`tsc` 0 错误、`npm test` 全绿、line-budget OK。
