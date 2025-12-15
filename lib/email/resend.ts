type SendEmailInput = {
  apiKey: string
  to: string
  from: string
  subject: string
  text: string
  html: string
}

export async function sendEmailWithResend(input: SendEmailInput): Promise<void> {
  const apiKey = String(input.apiKey || '').trim()
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend send failed: ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`)
  }
}

