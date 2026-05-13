# Wireframes

W1「我的手帐」首页的两份对照物料。任何手帐页相关的代码改动，请同时对照这两份验收。

## 文件清单

| 文件 | 内容 | 状态 |
|---|---|---|
| `owner-journal.html` | Tailwind 实现的低保真线框（开浏览器可见）| ✅ 已落库 |
| `owner-journal-target.png` | AI 生成的高保真目标设计稿（视觉验收基准）| ⏳ 待人工保存 |

## owner-journal-target.png 的获得方式

这张图是用 `docs/product-charter.md` 里描述的视觉系统通过 AI 图像模型生成的。
生成对话已在产品讨论中完成（2026-05-13），最终一版通过了视觉验收。

**请把那张通过验收的目标图保存到** `docs/wireframes/owner-journal-target.png`。

> 注：Claude Code 当前没法把对话里贴的图片提取成文件，所以这一步需要人工完成。
> 文件保存后，本 README 里的「待人工保存」标记可以清除。

## 验收一致性

两份物料的目标完全一致——区别只是保真度：

- `.html` 用于**结构、文案、词汇、布局比例**的回归基准（开发改 HTML/React 时对照）
- `.png` 用于**视觉气质、颜色、纸张质感、印章位置、装饰元素**的回归基准（前端做样式时对照）

任何一处不一致，应同时改两份。如果改不动 PNG（因为是 AI 生成），改 HTML 后用 charter §8 视觉系统去验证一致性，然后**注释在 charter 附录 A 增加一条决策**。

## 引用

- 产品宪章: [../product-charter.md](../product-charter.md)
- 架构总览: [../architecture.md](../architecture.md)
