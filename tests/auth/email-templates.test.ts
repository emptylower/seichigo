import { describe, expect, it } from 'vitest'
import { renderSigninOtpEmail, renderSignupOtpEmail } from '@/lib/email/templates/seichigoOtp'

const cases = [
  {
    purpose: 'signup', locale: 'zh', render: renderSignupOtpEmail,
    subject: '✨和seichigo一起启程',
    text: `欢迎你，巡礼者。

有些地方，只有在动画里见过；
有些情感，只有亲自站在那里，才会再次想起。

你的圣地巡礼之旅，已经准备就绪。

本次验证码是：
123456

输入验证码，即可踏上第一站。

—— 愿你在现实与作品之间，找到属于自己的那一刻。`,
  },
  {
    purpose: 'signup', locale: 'en', render: renderSignupOtpEmail,
    subject: '✨ Your first stop with SeichiGo',
    text: `Welcome, pilgrim.

Some places you have only seen in anime;
some feelings only come back when you are standing there.

Your pilgrimage is ready to begin.

Your verification code:
123456

Enter it to take your first stop.

— May you find, somewhere between the screen and the street, a moment that is yours.`,
  },
  {
    purpose: 'signup', locale: 'ja', render: renderSignupOtpEmail,
    subject: '✨ SeichiGoと一緒に、旅のはじまり',
    text: `ようこそ、巡礼者さん。

アニメの中でしか見たことのない場所。
その場に立ってはじめて、よみがえる気持ち。

あなたの聖地巡礼の準備が整いました。

認証コード：
123456

コードを入力して、最初の一歩を。

—— 作品と現実のあいだで、あなただけの瞬間に出会えますように。`,
  },
  {
    purpose: 'signin', locale: 'zh', render: renderSigninOtpEmail,
    subject: '🌸欢迎回来，继续巡礼',
    text: `欢迎回来，巡礼者。

那些走过的圣地，那些留在心底的画面，
正在等你继续书写。

本次登录验证码是：
123456

输入验证码，即可继续这一程。

—— 愿这一段旅途，依旧有风景与回忆相伴。`,
  },
  {
    purpose: 'signin', locale: 'en', render: renderSigninOtpEmail,
    subject: '🌸 Welcome back, pilgrim',
    text: `Welcome back, pilgrim.

The places you have walked, the scenes you still carry,
are waiting for the next chapter.

Your sign-in code:
123456

Enter it to pick up where you left off.

— May this leg of the journey bring new views and old memories.`,
  },
  {
    purpose: 'signin', locale: 'ja', render: renderSigninOtpEmail,
    subject: '🌸 おかえりなさい、巡礼の続きへ',
    text: `おかえりなさい、巡礼者さん。

歩いてきた聖地も、心に残った風景も、
続きを待っています。

ログイン用の認証コード：
123456

コードを入力して、旅の続きへ。

—— この道のりにも、景色と思い出が寄り添いますように。`,
  },
] as const

describe('OTP email translations', () => {
  it.each(cases)('$purpose $locale preserves the exact subject and body', ({ locale, render, subject, text }) => {
    const email = render(' 123456 ', locale)
    expect(email.subject).toBe(subject)
    expect(email.text).toBe(text)

    const paragraphs = text.split('\n\n')
    const expectedHtml = '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto;line-height:1.6;color:#111827">' +
      paragraphs.map((paragraph, index) => {
        if (paragraph.endsWith('\n123456')) {
          const label = paragraph.split('\n')[0]
          return `<p style="margin:16px 0 6px">${label}</p>` +
            '<div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#db2777;margin:0 0 16px">123456</div>'
        }
        if (index === paragraphs.length - 1) {
          return `<p style="color:#6b7280;margin-top:18px">${paragraph}</p>`
        }
        return `<p>${paragraph.replaceAll('\n', '<br/>')}</p>`
      }).join('') + '</div>'
    expect(email.html).toBe(expectedHtml)
  })

  it('defaults to the unchanged Chinese signup and signin emails', () => {
    expect(renderSignupOtpEmail('123456')).toEqual(renderSignupOtpEmail('123456', 'zh'))
    expect(renderSigninOtpEmail('123456')).toEqual(renderSigninOtpEmail('123456', 'zh'))
  })
})
