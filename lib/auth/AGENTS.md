# AUTH DOMAIN

## OVERVIEW
`lib/auth/` centralizes authentication and authorization — NextAuth configuration, session management, password hashing, OTP generation, and admin verification. 4 files, 282 lines. Security-critical.

## STRUCTURE
```text
lib/auth/
|- options.ts      # NextAuth authOptions (providers, callbacks, pages)
|- session.ts      # getServerAuthSession wrapper
|- admin.ts        # Admin allowlist check, default password bootstrap
`- password.ts     # Password hashing and verification
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Auth configuration | `options.ts` | NextAuth providers, callbacks, pages |
| Session access | `session.ts` | `getServerAuthSession` — used by all protected routes |
| Admin verification | `admin.ts` | `ADMIN_EMAILS` env, default password via `ADMIN_DEFAULT_PASSWORD` |
| Password flows | `password.ts` | Hash/verify, first-login force-change |

## CONVENTIONS
- Always use `getServerAuthSession()` for server-side auth — never access NextAuth internals directly.
- Admin check: `session.user.isAdmin` (set by authOptions callback based on `ADMIN_EMAILS` env).
- First admin login uses default password, then forces change at `/auth/change-password`.
- OTP email logged to console in dev when SMTP/Resend is not configured.

## ANTI-PATTERNS
- Do not trust client-side session data for authorization — always verify server-side.
- Do not modify authOptions callbacks without checking downstream session consumers.
- Do not hardcode admin emails — they come from `ADMIN_EMAILS` env variable.
