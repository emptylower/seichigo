/**
 * 抛出方式向上通知："当前 agent 运行已被新请求接管，这次写操作被原子拦
 * 下"。tools.ts 的工具执行器有自己的 catch-all（把异常转成 JSON 错误结果
 * 返给模型），必须特判这个类型再往上抛，不能被当成普通工具错误吞掉。
 */
export class RunFencedError extends Error {
  constructor() {
    super('run token superseded by a newer agent run')
    this.name = 'RunFencedError'
  }
}
