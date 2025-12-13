# Step 01｜测试基建（已完成）

## 目标
为后续“测试先行”提供统一入口：`npm run test` 可跑 TypeScript 单测与 React 组件测试（jsdom）。

## 本次完成内容
- 引入 Vitest 作为测试运行器，并新增脚本：
  - `npm run test`
  - `npm run test:watch`
- 新增 Vitest 配置：
  - `test.projects` 将 `*.test.ts`（node）与 `*.test.tsx`（jsdom）拆分运行
  - 配置 `@` alias 指向仓库根，支持 `@/lib/...` 形式 import
  - 启用 `esbuild.jsx="automatic"`，避免测试环境要求组件显式 `import React`
- 新增测试初始化：
  - `@testing-library/jest-dom` 扩展断言
  - `afterEach(cleanup)` 防止 jsdom DOM 累积影响用例
- 新增 smoke test（验证测试链路与 alias 可用）：
  - 使用 `lib/auth/admin.ts` 的 `hashPassword/verifyPassword`

## 变更文件
- `package.json`
- `vitest.config.ts`
- `tests/setup.ts`
- `tests/smoke.test.ts`

## 验收方式（独立可测）
- 运行：`npm run test`
- 预期：所有测试通过（至少包含 `tests/smoke.test.ts`）

