import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const HOME_DIR = path.join(ROOT, 'components/home')
const EXTENSIONS = ['.ts', '.tsx']

/**
 * 把一个源文件里的**静态** import（`import x from 'm'` / `import 'm'` /
 * `export … from 'm'`）抽出来。刻意排除：
 * - `import type …` —— 编译期擦除，不进包；
 * - `await import('m')` —— 按需加载，正是我们想要的形态。
 */
export function staticImportSpecifiers(source: string): string[] {
  const lines = source.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (!/^\s*(?:import|export)\b/.test(line)) continue
    if (/^\s*(?:import|export)\s+type\b/.test(line)) continue
    // `import 'm'`：整条语句就在这一行
    const bare = /^\s*import\s*['"]([^'"]+)['"]/.exec(line)
    if (bare) {
      out.push(bare[1]!)
      continue
    }
    // 可能跨多行，往下找到 `from 'm'` 为止（最多看 40 行，避免误吞整份文件）
    let statement = line
    let cursor = i
    while (!/\bfrom\s*['"][^'"]+['"]/.test(statement) && cursor - i < 40 && cursor + 1 < lines.length) {
      cursor += 1
      statement += `\n${lines[cursor]!}`
    }
    const match = /\bfrom\s*['"]([^'"]+)['"]/.exec(statement)
    if (match) {
      out.push(match[1]!)
      i = cursor
    }
  }
  return out
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string | null = null
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier)
  else if (specifier.startsWith('@/')) base = path.join(ROOT, specifier.slice(2))
  if (!base) return null
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base!, `index${ext}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && EXTENSIONS.includes(path.extname(candidate))) return candidate
  }
  return null
}

/** 从 components/home/** 出发，递归展开源码里的静态 import 图 */
function collectExternalSpecifiers(): { specifiers: Set<string>; visited: Set<string> } {
  const queue = readdirSync(HOME_DIR)
    .filter((name) => EXTENSIONS.includes(path.extname(name)))
    .map((name) => path.join(HOME_DIR, name))
  const visited = new Set<string>()
  const specifiers = new Set<string>()
  while (queue.length) {
    const file = queue.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    for (const specifier of staticImportSpecifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveSpecifier(specifier, file)
      if (resolved) queue.push(resolved)
      else specifiers.add(specifier)
    }
  }
  return { specifiers, visited }
}

/**
 * 高-2：首页首屏不许静态引到 MapLibre。地图预览自己 `await import('maplibre-gl')`，
 * 展示计划的 DayMap 走 `next/dynamic`——两条路径都不能出现在静态 import 图里，
 * 否则 ~200 KB 的地图库会被打进首页首屏 chunk。
 */
describe('components/home 静态 import 图', () => {
  const { specifiers, visited } = collectExternalSpecifiers()

  it('确实展开到了多份源码（守住这条断言本身有效）', () => {
    expect(visited.size).toBeGreaterThan(10)
  })

  it('不静态引入 maplibre-gl（含其 CSS）', () => {
    const offenders = [...specifiers].filter((s) => s === 'maplibre-gl' || s.startsWith('maplibre-gl/'))
    expect(offenders).toEqual([])
  })

  it('只忽略 `import type`，普通 import 仍被记录', () => {
    const source = ["import type { A } from 'type-only'", "import b from 'value-mod'", "import 'side-effect.css'"].join('\n')
    expect(staticImportSpecifiers(source)).toEqual(['value-mod', 'side-effect.css'])
  })

  it('不把 await import() 记成静态依赖', () => {
    expect(staticImportSpecifiers("const m = await import('maplibre-gl')")).toEqual([])
  })
})
