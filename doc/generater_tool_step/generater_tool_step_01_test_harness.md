# 01｜测试基建（先让 `npm run test` 跑起来）

## 目标
在不改业务代码的前提下，引入可持续的测试基建，确保后续每个里程碑都能“先写测试→实现→回归”。

## 交付物
- 新增 `npm run test`（默认跑 unit + lightweight component tests）
- 支持 TypeScript、ESM、React 组件测试（jsdom）
- 提供一个示例测试作为 smoke test

## 先写测试（Test First）
1. 新增 `tests/smoke.test.ts`
   - 用例：`hashPassword()` 生成的 hash 能被 `verifyPassword()` 验证通过
   - 依赖现有代码：`lib/auth/admin.ts`
   - 预期：测试先失败（因为此时还没有测试运行器/脚本）

## 再实现（让测试能跑）
1. 安装依赖（需要网络权限时再执行）：
   - `vitest`
   - `@vitest/coverage-v8`（可选）
   - `jsdom`
   - `@testing-library/react`
   - `@testing-library/jest-dom`
2. 新增/修改文件：
   - `vitest.config.ts`：使用 `test.projects` 区分环境：
     - `tests/**/*.test.ts` 走 `node`
     - `tests/**/*.test.tsx` 走 `jsdom`
   - `vitest.config.ts`：开启 `esbuild.jsx="automatic"`，避免 React 组件文件必须显式 `import React`
   - `tests/setup.ts`：
     - 引入 `@testing-library/jest-dom`
     - 注册 `afterEach(cleanup)`，避免 jsdom 组件测试 DOM 累积影响后续用例
   - `package.json`：新增脚本
     - `test`: `vitest run`
     - `test:watch`: `vitest`
3. TS 配置（如需要）：
   - `tsconfig.json`：加入 `types: ["vitest/globals"]` 或在测试文件里显式 import（按现有 tsconfig 风格决定）

## 根据测试结果修正
- 若因 ESM/CJS 或 Next.js/React 版本导致测试运行失败：
  - 优先调整 `vitest.config.ts` 与 TS 配置
  - 避免在测试里 import 需要 Next runtime 的模块（比如 `next/navigation`），后续会通过“依赖注入/薄 Route 包装”方式规避

## 验收（独立可测）
- 运行 `npm run test`：
  - 预期：`tests/smoke.test.ts` 通过
