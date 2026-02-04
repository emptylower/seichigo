import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/db/prisma'
import { ADMIN_DEFAULT_PASSWORD, hashPassword, isAdminEmail, verifyPassword } from '@/lib/auth/admin'
import { hashEmailOtpCode, normalizeEmail, resolveOtpSecret, timingSafeEqualHex } from '@/lib/auth/emailOtp'

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
        token.image = user.image
        token.mustChangePassword = (user as any).mustChangePassword ?? token.mustChangePassword
      }
      token.isAdmin = isAdminEmail((token.email as string | undefined) ?? null)
      return token
    },
    async session({ session, token }) {
      if (!session.user) return session

      // Ensure we always propagate email from JWT into the session.
      // (Some flows can leave session.user.email empty even though token.email is present.)
      if (!session.user.email && token.email) {
        session.user.email = String(token.email)
      }

      const id = token.id || token.sub
      if (id) session.user.id = String(id)
      if (token.image) session.user.image = String(token.image)
      session.user.isAdmin = isAdminEmail(session.user.email)

      // 强制改密需要实时读取 DB（避免 JWT 里值过期造成循环/失效）
      let mustChangePassword = Boolean(token.mustChangePassword)
      let needsPasswordSetup = false
      let disabled = false
      if (id) {
        try {
          const u = await prisma.user.findUnique({
            where: { id: String(id) },
            select: { mustChangePassword: true, passwordHash: true, disabled: true },
          })
          if (u) {
            mustChangePassword = u.mustChangePassword
            needsPasswordSetup = !u.passwordHash
            disabled = Boolean(u.disabled)
          }
        } catch {
          // ignore (e.g. DB not ready in early boot)
        }
      }
      session.user.mustChangePassword = mustChangePassword
      session.user.needsPasswordSetup = needsPasswordSetup
      session.user.disabled = disabled

      return session
    },
  },
  providers: [
    CredentialsProvider({
      id: 'email-code',
      name: '邮箱验证码',
      credentials: {
        email: { label: '邮箱', type: 'email' },
        code: { label: '验证码', type: 'text' },
      },
      async authorize(credentials) {
        if (!process.env.DATABASE_URL) return null

        const email = normalizeEmail(String(credentials?.email || ''))
        const code = String(credentials?.code || '').trim()
        if (!email || !code) return null

        const now = new Date()
        const record = await prisma.emailOtp.findFirst({
          where: { email, usedAt: null, expiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, salt: true, codeHash: true, attempts: true },
        })
        if (!record) return null

        const maxAttempts = 5
        if ((record.attempts || 0) >= maxAttempts) {
          await prisma.emailOtp.update({ where: { id: record.id }, data: { usedAt: now } }).catch(() => null)
          return null
        }

        const candidate = hashEmailOtpCode({ code, salt: record.salt, secret: resolveOtpSecret() })
        const ok = timingSafeEqualHex(record.codeHash, candidate)
        if (!ok) {
          await prisma.emailOtp
            .update({
              where: { id: record.id },
              data: { attempts: { increment: 1 } },
            })
            .catch(() => null)
          return null
        }

        await prisma.emailOtp.update({ where: { id: record.id }, data: { usedAt: now } }).catch(() => null)

        const name = email.split('@')[0] || 'user'
        const user = await prisma.user.upsert({
          where: { email },
          update: { emailVerified: now, name: undefined },
          create: { email, emailVerified: now, name },
          select: { id: true, email: true, name: true, mustChangePassword: true, disabled: true },
        })

        if (user.disabled) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          mustChangePassword: user.mustChangePassword,
        } as any
      },
    }),
    CredentialsProvider({
      name: '账号密码',
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || '').trim().toLowerCase()
        const password = String(credentials?.password || '')
        if (!email || !password) return null

        const existing = await prisma.user.findUnique({ where: { email } })
        if (!existing) {
          if (!isAdminEmail(email)) return null
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

        if (existing.disabled) return null
        if (!existing.passwordHash) {
          // Bootstrap admin from default password if password hash wasn't set yet.
          if (!isAdminEmail(email)) return null
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
  ],
}
