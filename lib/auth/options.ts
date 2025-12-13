import type { NextAuthOptions } from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/db/prisma'
import nodemailer from 'nodemailer'
import { ADMIN_DEFAULT_PASSWORD, hashPassword, isAdminEmail, verifyPassword } from '@/lib/auth/admin'

const emailFrom = process.env.EMAIL_FROM || 'no-reply@example.com'

const smtpHost = process.env.EMAIL_SERVER_HOST
const smtpPort = process.env.EMAIL_SERVER_PORT ? Number(process.env.EMAIL_SERVER_PORT) : undefined
const smtpUser = process.env.EMAIL_SERVER_USER
const smtpPass = process.env.EMAIL_SERVER_PASSWORD

const emailServer =
  smtpHost && smtpPort && smtpUser && smtpPass
    ? {
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      }
    : process.env.EMAIL_SERVER

function buildTransport() {
  if (!emailServer) return null
  return nodemailer.createTransport(emailServer)
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  // Credentials Provider 需要 JWT Session（NextAuth 文档要求）
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    async jwt({ token, user }) {
      // 首次登录/刷新 token 时把用户信息写入 JWT
      if (user) {
        token.id = (user as any).id
        token.email = user.email
        token.name = user.name
        token.mustChangePassword = (user as any).mustChangePassword ?? token.mustChangePassword
      }
      token.isAdmin = isAdminEmail((token.email as string | undefined) ?? null)
      return token
    },
    async session({ session, token }) {
      if (!session.user) return session

      const id = token.id || token.sub
      if (id) session.user.id = String(id)
      session.user.isAdmin = isAdminEmail(session.user.email)

      // 强制改密需要实时读取 DB（避免 JWT 里值过期造成循环/失效）
      let mustChangePassword = Boolean(token.mustChangePassword)
      if (id) {
        try {
          const u = await prisma.user.findUnique({
            where: { id: String(id) },
            select: { mustChangePassword: true },
          })
          if (u) mustChangePassword = u.mustChangePassword
        } catch {
          // ignore (e.g. DB not ready in early boot)
        }
      }
      session.user.mustChangePassword = mustChangePassword

      return session
    },
  },
  providers: [
    CredentialsProvider({
      name: '管理员账号',
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || '').trim().toLowerCase()
        const password = String(credentials?.password || '')
        if (!email || !password) return null
        if (!isAdminEmail(email)) return null

        const existing = await prisma.user.findUnique({ where: { email } })
        if (!existing) {
          if (password !== ADMIN_DEFAULT_PASSWORD) return null
          const created = await prisma.user.create({
            data: {
              email,
              name: email.split('@')[0] || 'admin',
              emailVerified: new Date(),
              passwordHash: hashPassword(ADMIN_DEFAULT_PASSWORD),
              mustChangePassword: true,
            },
          })
          return {
            id: created.id,
            email: created.email,
            name: created.name,
            mustChangePassword: created.mustChangePassword,
          } as any
        }

        if (!existing.passwordHash) {
          // Bootstrap admin from default password if password hash wasn't set yet.
          if (password !== ADMIN_DEFAULT_PASSWORD) return null
          const updated = await prisma.user.update({
            where: { id: existing.id },
            data: { passwordHash: hashPassword(ADMIN_DEFAULT_PASSWORD), mustChangePassword: true },
          })
          return {
            id: updated.id,
            email: updated.email,
            name: updated.name,
            mustChangePassword: updated.mustChangePassword,
          } as any
        }

        if (!verifyPassword(password, existing.passwordHash)) return null
        return {
          id: existing.id,
          email: existing.email,
          name: existing.name,
          mustChangePassword: existing.mustChangePassword,
        } as any
      },
    }),
    EmailProvider({
      server: emailServer,
      from: emailFrom,
      async sendVerificationRequest({ identifier, url, provider }) {
        const transport = buildTransport()
        const site = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000').host
        if (!transport) {
          console.log(`[DEV EMAIL] Sign in link for ${identifier}:\n${url}`)
          return
        }
        try {
          await transport.sendMail({
            to: identifier,
            from: provider.from,
            subject: `登录到 ${site}`,
            text: `点击以下链接完成登录：\n${url}\n（有效期 24 小时）`,
            html:
              `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto">` +
              `<h2 style="color:#db2777">SeichiGo 登录</h2>` +
              `<p>点击以下按钮完成登录：</p>` +
              `<p><a href="${url}" style="display:inline-block;background:#ec4899;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">登录</a></p>` +
              `<p style="color:#6b7280">如果不是你本人操作，可忽略本邮件。</p>` +
              `</div>`,
          })
        } catch (err: any) {
          console.error('SMTP send failed', {
            code: err?.code,
            command: err?.command,
            response: err?.response,
            responseCode: err?.responseCode,
          })
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[DEV EMAIL FALLBACK] Sign in link for ${identifier}:\n${url}`)
            return
          }
          throw err
        }
      },
    }),
  ],
}
