# SeichiGo 代码审计修复计划（2026-02-04）

## 目标

- 优先修复安全风险（XSS/SSRF/权限绕过/上传风险）。
- 修复审计过程中暴露的稳定性问题（测试失败、mock/依赖耦合）。
- 在不改变产品行为的前提下，逐步让项目回到“可持续维护”的状态（可测试、可升级）。

## 范围（本轮修复）

### P0（必须做）

1. **JSON-LD 注入/XSS 防护**
   - 统一替换所有 `application/ld+json` 的输出序列化方式，避免 `</script>` 等字符序列导致脚本上下文逃逸。
2. **资源上传与资源服务加固**
   - 禁止 SVG（或至少强制下载/隔离），并加上 `X-Content-Type-Options: nosniff` 等防护头。
3. **Link Preview SSRF 加固**
   - 增加 DNS 解析校验与重定向链路校验，避免通过域名/重定向访问内网地址。

### P1（应该做）

4. **权限与账号状态一致性**
   - 统一 `isAdmin` 的判定方式；修复评论模块误用 `session.user.role`。
   - `disabled` 用户必须被服务端强制阻断（至少对 API 与后台）。
5. **测试稳定性修复**
   - `revalidatePath` 在 Vitest 环境抛错：改为安全封装，避免影响业务流程与测试。
   - 将“可选的 DB 读取/同步逻辑”改为 best-effort（失败不影响主流程），避免测试里因为 mock 不完整而 500。

### P2（可选/后续）

6. **依赖漏洞升级**
   - 根据 `npm audit` 建议升级 `next` / `preact` 等依赖到已修复版本，并跑一轮回归。
7. **工具链补齐**
   - 目前 `npm run lint` 运行失败（eslint 不存在）；按需补齐 ESLint 或移除脚本，避免“假通过”。

## 执行步骤（按顺序）

1. 建立统一的 JSON-LD 安全序列化工具函数（例如 `serializeJsonLd()`），并替换全站引用点。
2. 资源上传：
   - 增加 allowlist（jpeg/png/webp/gif…），显式拒绝 `image/svg+xml`。
   - 资源响应增加 `X-Content-Type-Options: nosniff`（必要时再加 CSP/下载策略）。
3. Link Preview：
   - 对 hostname 做 DNS lookup（all records），阻断解析到私网/环回/链路本地等地址。
   - 使用手动跟随重定向并逐跳校验目标 URL（限制最大跳数）。
4. 认证/权限：
   - 评论删除/管理判断统一使用 `session.user.isAdmin`（或 `isAdminEmail`）。
   - 在 `getServerAuthSession()` 或 NextAuth 回调内加入 disabled 判定并阻断。
5. 测试与类型：
   - 引入 `safeRevalidatePath()` 封装，替换直接调用点。
   - 为可能缺失的 Prisma model 访问加 try/catch（best-effort），修复现有单测失败。
   - 视情况补齐 `tsconfig.json` 的 `paths`（例如加 `@/*`），让 `npx tsc -p tsconfig.json` 能通过或至少减少噪音。
6. 依赖升级：
   - 执行 `npm audit fix` 或显式升级相关包。
   - 跑 `npm test` +（可选）`npm run build` 做回归。

## 验收标准

- 安全：
  - JSON-LD 输出不会因为包含 `<`/`</script>` 等内容导致脚本注入。
  - `/assets/:id` 不允许同源 SVG 执行脚本（禁用或隔离）。
  - `/api/link-preview` 不能访问内网地址（含 DNS 解析与重定向）。
- 工程：
  - `npm test` 全绿。
  - `npm audit --omit=dev` 不再报当前 high（或有明确升级记录与原因说明）。

## 风险与回滚

- 依赖升级（Next.js/React 生态）可能带来行为差异：优先通过“小版本升级 + 回归测试”控制风险。
- 上传限制可能影响既有内容：若线上已存在 SVG 资源，需要在上线前扫描/迁移或提供兼容策略（例如强制下载）。

