/**
 * 浏览器翻译 × React 的 DOM 兜底补丁（React issue #11538 的社区方案）。
 *
 * ## 背景
 * iPhone Chrome 打开 /ja 会自动整页翻译：Google 翻译把文本节点包进 `<font>`、
 * 把节点从原父节点下搬走。React 手里还留着搬走前的引用，之后一旦要更新那一片
 * （`insertBefore` / `removeChild`），参照节点已经不是自己的子节点了，
 * 于是抛 `NotFoundError: The object can not be found here.`，整页崩到错误边界。
 *
 * ## 做法
 * 给 `Node.prototype` 的这两个方法加一层判断：父子关系对不上就**放弃这次操作**并
 * 打一条 warn，而不是让浏览器抛异常。页面会有一小块内容显示不对（那块本来就已经被
 * 翻译插件改乱了），但不会整页白掉。
 *
 * `insertBefore` 这里刻意**只返回 newNode、不插入**，不做 `appendChild` 兜底：
 * 参照节点位置已经不可信，追加到末尾会把内容插到错误的地方，反而更难排查；
 * 保守地什么都不做，交给 React 后续的重渲染自己收敛。
 *
 * 这是全站兜底，不是根治手段——真正会按时序增删节点的组件（首屏手机演示）
 * 已经改成静态 DOM，这里只兜别处没料到的情况。
 */

type GuardWindow = Window & { __seichigoTranslateGuard?: boolean }

const FLAG = '__seichigoTranslateGuard'

/**
 * 打补丁，返回是否真的打上了（已经打过 / 不在浏览器里都返回 false）。
 * 幂等：靠 `window.__seichigoTranslateGuard` 标记，重复调用不会层层包裹。
 */
export function installTranslateGuard(): boolean {
  if (typeof window === 'undefined' || typeof Node === 'undefined') return false

  const scope = window as GuardWindow
  if (scope[FLAG]) return false
  scope[FLAG] = true

  const originalRemoveChild = Node.prototype.removeChild
  const originalInsertBefore = Node.prototype.insertBefore

  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      console.warn('[translate-guard] removeChild：子节点已不在该父节点下（多半被浏览器翻译搬走了），跳过', child, this)
      return child
    }
    return originalRemoveChild.call(this, child) as T
  }

  Node.prototype.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.warn(
        '[translate-guard] insertBefore：参照节点已不在该父节点下（多半被浏览器翻译搬走了），本次不插入',
        newNode,
        referenceNode,
        this,
      )
      // 保守：不 appendChild 兜底，插错位置比不插更难排查
      return newNode
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T
  }

  return true
}
