<!--
Thanks for contributing to SeichiGo!
感谢你向 SeichiGo 提交 PR。

Please keep the PR focused. If you are touching multiple unrelated areas,
prefer splitting into separate PRs.
请保持 PR 聚焦；若涉及多个无关模块，建议拆分。
-->

## Summary / 摘要

<!-- One or two sentences. What changed and why. -->

## Type of change / 变更类型

- [ ] feat — new feature / 新功能
- [ ] fix — bug fix / 缺陷修复
- [ ] perf — performance improvement / 性能优化
- [ ] refactor — code restructuring, no behavior change / 重构
- [ ] docs — documentation only / 仅文档
- [ ] chore / config / deploy
- [ ] test — adding or improving tests / 测试

## Area / 模块

<!-- Map · Editor · Auth · Admin · Anitabi sync · Translation · SEO · Build/Deploy · Other -->

## Screenshots / 截图

<!-- For UI changes. Before / after if possible. -->

## How to verify / 验证方式

<!--
List the exact commands or steps a reviewer can run.
e.g.
- npm test -- tests/article
- npm run typecheck
- visit /zh and verify map loads
-->

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] Manual smoke test on `npm run dev` (if UI)

## Checklist / 自查

- [ ] My change follows the patterns documented in the nearest `AGENTS.md`
- [ ] I have not bypassed `sanitizeRichTextHtml` for user-supplied HTML
- [ ] I have not introduced direct Prisma instantiation outside `lib/db/prisma`
- [ ] If I added a file over 800 lines, I updated `line-budget.allowlist.json`
- [ ] Tests pass locally (`npm test`)
- [ ] If this touches deploy, I read `docs/deployment.md`
- [ ] If this changes public behavior, I added a `CHANGELOG.md` entry

## Linked issues / 关联 issue

<!-- Closes #..., Refs #... -->

## Notes for reviewer / 给评审的说明
