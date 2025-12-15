export function renderSeichigoOtpEmail(code: string): { subject: string; text: string; html: string } {
  const cleaned = String(code || '').trim()
  const subject = '✨和seichigo一起启程'

  const text =
    `欢迎你，巡礼者。\n\n` +
    `有些地方，只有在动画里见过；\n` +
    `有些情感，只有亲自站在那里，才会再次想起。\n\n` +
    `你的圣地巡礼之旅，已经准备就绪。\n\n` +
    `本次验证码是：\n` +
    `${cleaned}\n\n` +
    `输入验证码，即可踏上第一站。\n\n` +
    `—— 愿你在现实与作品之间，找到属于自己的那一刻。`

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto;line-height:1.6;color:#111827">` +
    `<p>欢迎你，巡礼者。</p>` +
    `<p>` +
    `有些地方，只有在动画里见过；<br/>` +
    `有些情感，只有亲自站在那里，才会再次想起。` +
    `</p>` +
    `<p>你的圣地巡礼之旅，已经准备就绪。</p>` +
    `<p style="margin:16px 0 6px">本次验证码是：</p>` +
    `<div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#db2777;margin:0 0 16px">${cleaned}</div>` +
    `<p>输入验证码，即可踏上第一站。</p>` +
    `<p style="color:#6b7280;margin-top:18px">—— 愿你在现实与作品之间，找到属于自己的那一刻。</p>` +
    `</div>`

  return { subject, text, html }
}

