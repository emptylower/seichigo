import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 首页生成脚本共用的 .env.local 加载器：Next.js 运行时会自动读 .env.local，
 * tsx 不会——脚本按文档命令直接运行时在这里补上。只填充未设置的键，
 * 不覆盖显式传入的环境变量，也不打印任何值。
 */
export function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local')
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]!
    let value = match[2]!.trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

/**
 * 解析 `--name value` 或 `--name=value` 形式的 CLI 参数；未传时返回 undefined。
 * 注意 indexOf 命不中时不能取 argv[indexOf+1]（会错拿 argv[0]）。
 */
export function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1]
  const prefix = `${name}=`
  const hit = argv.find((arg) => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}
