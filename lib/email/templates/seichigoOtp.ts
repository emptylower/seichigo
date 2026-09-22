import type { SupportedLocale } from '@/lib/i18n/types'

export type SeichigoOtpEmail = { subject: string; text: string; html: string }

export function renderSignupOtpEmail(code: string, locale: SupportedLocale = 'zh'): SeichigoOtpEmail {
  const cleaned = String(code || '').trim()
  const copy = {
    zh: {
      subject: '✨和seichigo一起启程',
      greeting: '欢迎你，巡礼者。',
      scene: '有些地方，只有在动画里见过；',
      feeling: '有些情感，只有亲自站在那里，才会再次想起。',
      ready: '你的圣地巡礼之旅，已经准备就绪。',
      codeLabel: '本次验证码是：',
      instruction: '输入验证码，即可踏上第一站。',
      closing: '—— 愿你在现实与作品之间，找到属于自己的那一刻。',
    },
    en: {
      subject: '✨ Your first stop with SeichiGo',
      greeting: 'Welcome, pilgrim.',
      scene: 'Some places you have only seen in anime;',
      feeling: 'some feelings only come back when you are standing there.',
      ready: 'Your pilgrimage is ready to begin.',
      codeLabel: 'Your verification code:',
      instruction: 'Enter it to take your first stop.',
      closing: '— May you find, somewhere between the screen and the street, a moment that is yours.',
    },
    ja: {
      subject: '✨ SeichiGoと一緒に、旅のはじまり',
      greeting: 'ようこそ、巡礼者さん。',
      scene: 'アニメの中でしか見たことのない場所。',
      feeling: 'その場に立ってはじめて、よみがえる気持ち。',
      ready: 'あなたの聖地巡礼の準備が整いました。',
      codeLabel: '認証コード：',
      instruction: 'コードを入力して、最初の一歩を。',
      closing: '—— 作品と現実のあいだで、あなただけの瞬間に出会えますように。',
    },
  }[locale]
  const subject = copy.subject

  const text =
    `${copy.greeting}\n\n` +
    `${copy.scene}\n` +
    `${copy.feeling}\n\n` +
    `${copy.ready}\n\n` +
    `${copy.codeLabel}\n` +
    `${cleaned}\n\n` +
    `${copy.instruction}\n\n` +
    copy.closing

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto;line-height:1.6;color:#111827">` +
    `<p>${copy.greeting}</p>` +
    `<p>` +
    `${copy.scene}<br/>` +
    copy.feeling +
    `</p>` +
    `<p>${copy.ready}</p>` +
    `<p style="margin:16px 0 6px">${copy.codeLabel}</p>` +
    `<div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#db2777;margin:0 0 16px">${cleaned}</div>` +
    `<p>${copy.instruction}</p>` +
    `<p style="color:#6b7280;margin-top:18px">${copy.closing}</p>` +
    `</div>`

  return { subject, text, html }
}

export function renderSigninOtpEmail(code: string, locale: SupportedLocale = 'zh'): SeichigoOtpEmail {
  const cleaned = String(code || '').trim()
  const copy = {
    zh: {
      subject: '🌸欢迎回来，继续巡礼',
      greeting: '欢迎回来，巡礼者。',
      scene: '那些走过的圣地，那些留在心底的画面，',
      feeling: '正在等你继续书写。',
      codeLabel: '本次登录验证码是：',
      instruction: '输入验证码，即可继续这一程。',
      closing: '—— 愿这一段旅途，依旧有风景与回忆相伴。',
    },
    en: {
      subject: '🌸 Welcome back, pilgrim',
      greeting: 'Welcome back, pilgrim.',
      scene: 'The places you have walked, the scenes you still carry,',
      feeling: 'are waiting for the next chapter.',
      codeLabel: 'Your sign-in code:',
      instruction: 'Enter it to pick up where you left off.',
      closing: '— May this leg of the journey bring new views and old memories.',
    },
    ja: {
      subject: '🌸 おかえりなさい、巡礼の続きへ',
      greeting: 'おかえりなさい、巡礼者さん。',
      scene: '歩いてきた聖地も、心に残った風景も、',
      feeling: '続きを待っています。',
      codeLabel: 'ログイン用の認証コード：',
      instruction: 'コードを入力して、旅の続きへ。',
      closing: '—— この道のりにも、景色と思い出が寄り添いますように。',
    },
  }[locale]
  const subject = copy.subject

  const text =
    `${copy.greeting}\n\n` +
    `${copy.scene}\n` +
    `${copy.feeling}\n\n` +
    `${copy.codeLabel}\n` +
    `${cleaned}\n\n` +
    `${copy.instruction}\n\n` +
    copy.closing

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto;line-height:1.6;color:#111827">` +
    `<p>${copy.greeting}</p>` +
    `<p>` +
    `${copy.scene}<br/>` +
    copy.feeling +
    `</p>` +
    `<p style="margin:16px 0 6px">${copy.codeLabel}</p>` +
    `<div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#db2777;margin:0 0 16px">${cleaned}</div>` +
    `<p>${copy.instruction}</p>` +
    `<p style="color:#6b7280;margin-top:18px">${copy.closing}</p>` +
    `</div>`

  return { subject, text, html }
}

export const renderSeichigoOtpEmail = renderSignupOtpEmail
