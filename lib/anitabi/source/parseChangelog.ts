import { normalizeText } from '@/lib/anitabi/utils'

export type ParsedChangelogEntry = {
  date: string
  title: string
  body: string
  links: Array<{ label: string; url: string }>
}

const HEADING_RE = /^#{2,4}\s+(.+)$/
const DATE_RE = /(20\d{2}-\d{2}-\d{2})/
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

function extractLinks(text: string): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = []
  for (const match of text.matchAll(LINK_RE)) {
    const label = normalizeText(match[1])
    const url = normalizeText(match[2])
    if (!label || !url) continue
    links.push({ label, url })
  }
  return links
}

function normalizeHeading(raw: string): { title: string; date: string } {
  const line = normalizeText(raw)
  const dateMatch = line.match(DATE_RE)
  const date = dateMatch?.[1] || ''
  const title = normalizeText(line.replace(DATE_RE, '').replace(/[|｜·•]+/g, ' '))
  return {
    title: title || (date ? `更新 ${date}` : '更新'),
    date,
  }
}

export function parseChangelogMarkdown(markdown: string): ParsedChangelogEntry[] {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const entries: ParsedChangelogEntry[] = []

  let currentHeading = ''
  let currentDate = ''
  let bodyBuffer: string[] = []

  const flush = () => {
    const body = normalizeText(bodyBuffer.join('\n'))
    if (!currentHeading || !body) {
      bodyBuffer = []
      return
    }
    entries.push({
      date: currentDate || '',
      title: currentHeading,
      body,
      links: extractLinks(body),
    })
    bodyBuffer = []
  }

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      flush()
      const heading = normalizeHeading(headingMatch[1] || '')
      currentHeading = heading.title
      currentDate = heading.date
      continue
    }

    if (!currentHeading) continue
    bodyBuffer.push(line)
  }

  flush()

  if (!entries.length) return []

  return entries
    .filter((entry) => entry.body.length > 0)
    .slice(0, 500)
}
