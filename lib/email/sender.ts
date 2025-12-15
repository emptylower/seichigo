import nodemailer from 'nodemailer'
import { sendEmailWithResend } from '@/lib/email/resend'

type SendMailInput = {
  to: string
  from?: string
  subject: string
  text: string
  html: string
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM || 'no-reply@example.com'
}

function buildSmtpConfig(): any | null {
  const smtpHost = process.env.EMAIL_SERVER_HOST
  const smtpPort = process.env.EMAIL_SERVER_PORT ? Number(process.env.EMAIL_SERVER_PORT) : undefined
  const smtpUser = process.env.EMAIL_SERVER_USER
  const smtpPass = process.env.EMAIL_SERVER_PASSWORD

  if (smtpHost && smtpPort && smtpUser && smtpPass) {
    return {
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    }
  }

  const uri = process.env.EMAIL_SERVER
  return uri ? uri : null
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

  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim()
  if (resendApiKey) {
    await sendEmailWithResend({ apiKey: resendApiKey, to, from, subject, text, html })
    return
  }

  const smtp = buildSmtpConfig()
  if (!smtp) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email provider is not configured (set RESEND_API_KEY or SMTP EMAIL_SERVER*)')
    }
    console.log(`[DEV EMAIL] To: ${to}\nSubject: ${subject}\n\n${text}`)
    return
  }

  const transport = nodemailer.createTransport(smtp)
  await transport.sendMail({ to, from, subject, text, html })
}
