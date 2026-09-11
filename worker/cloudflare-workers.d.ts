/**
 * Phase 1-A（2026-09-11）：`cloudflare:workers` 内建模块的最小结构声明。
 *
 * 根目录 worker-configuration.d.ts（wrangler types 生成）有完整版但刻意不进
 * 任何 tsconfig include（先例见 lib/anitabi/cf/bindings.ts 的注释：lib/worker
 * 代码不直接引用全局生成类型）。worker/ 的 Durable Object 子类在 tsc 侧只需
 * 一个可 extends 的基类形状，故就地声明最小子集。运行时由 workerd 提供，
 * 测试由 vi.mock('cloudflare:workers') 提供。
 */
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown, Props = unknown> {
    protected constructor(ctx: unknown, env: Env)
  }
}
