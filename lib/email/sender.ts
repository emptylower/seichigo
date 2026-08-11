import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { DEFAULT_EMAIL_FROM } from '@/lib/email/addresses'

type SendMailInput = {
  to: string
  from?: string
  subject: string
  text: string
  html: string
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM
}

function parseFromAddress(from: string): string | { name: string; email: string } {
  const match = from.match(/^\s*(.+?)\s*<([^<>]+)>\s*$/)
  if (!match) return from

  return {
    name: match[1].replace(/^['"]|['"]$/g, '').trim(),
    email: match[2].trim(),
  }
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const to = String(input.to || '').trim()
  const from = String(input.from || getFromAddress()).trim()
  const subject = String(input.subject || '').trim()
  const text = String(input.text || '')
  const html = String(input.html || '')

  if (!to) throw new Error('Missing email recipient')
  if (!from) throw new Error('Missing email from')
  if (!subject) throw new Error('Missing email subject')

  const cloudflareEmail = getCfBindings()?.env?.EMAIL
  if (cloudflareEmail) {
    await cloudflareEmail.send({
      to,
      from: parseFromAddress(from),
      subject,
      text,
      html,
    })
    return
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Email provider is not configured (set the Cloudflare EMAIL binding)')
  }

  console.log(`[DEV EMAIL] To: ${to}\nSubject: ${subject}\n\n${text}`)
}
