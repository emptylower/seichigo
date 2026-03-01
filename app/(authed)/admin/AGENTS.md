# ADMIN HOTSPOTS

## OVERVIEW
`app/(authed)/admin` contains privileged UI flows (review, translations, users, ops) and must stay aligned with server auth/authorization rules.

## STRUCTURE
```text
app/(authed)/admin/
|- review/
|- translations/
|- users/
`- ops/maintenance/settings/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Translation batch UI | `app/(authed)/admin/translations/ui.tsx` | High-complexity async state machine |
| Review moderation UI | `app/(authed)/admin/review/` | Pairs with article admin handlers |
| Admin shell/routing | `app/(authed)/admin/layout.tsx` + `page.tsx` | Shared container and entry |
| Admin errors/loading | `app/(authed)/admin/error.tsx`, `loading.tsx` | Keep resilient fallback UX |

## CONVENTIONS
- Keep admin pages server-safe; do not trust client state for authorization decisions.
- Prefer existing fetch/action patterns in neighboring admin modules before adding new abstractions.
- Preserve localized Chinese operator-facing copy where existing pages already use it.
- For long-running/batch actions, always surface progress and partial-failure states.

## ANTI-PATTERNS
- Do not bypass auth checks by relying on only client session data.
- Do not add heavy logic into layout-level components.
- Do not introduce silent failures in moderation/batch tools.
- Do not fork request payload conventions from existing admin APIs.

## NOTES
- `translations/ui.tsx` is a major complexity hotspot; make surgical edits and avoid broad rewrites.
- When touching moderation UX, cross-check server behavior in `lib/article/handlers/admin*.ts`.

## COMMANDS
```bash
npm test -- tests/translation
npm test -- tests/admin
```
