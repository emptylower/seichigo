# ADMIN HOTSPOTS

## OVERVIEW
`app/(authed)/admin` contains privileged UI flows (review, translations, users, ops) and must stay aligned with server auth/authorization rules.

## STRUCTURE
```text
app/(authed)/admin/
|- review/                # Article moderation queue
|- translations/ + [id]/  # Translation management (list + detail)
|- users/                 # User management
|- ops/                   # Operational health (ui.tsx 744 lines, hotspot)
|- seo/ + spoke-factory/  # SEO admin + automated generation
|- panel/anime/[id]/ + city/[id]/  # Entity data editors
|- waitlist/              # Access control management
|- dashboard/             # Admin entry with summary stats
`- maintenance/           # System maintenance
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Translation batch UI | `translations/ui.tsx` | 798 lines; async state machine hotspot |
| Translation detail | `translations/[id]/ui.tsx` | 798 lines; per-task review interface |
| Ops monitoring | `ops/ui.tsx` | 744 lines; Vercel log dashboard |
| SEO management | `seo/ui.tsx` | 756 lines; ranking/spoke controls |
| Review moderation | `review/` | Pairs with `lib/article/handlers/admin*.ts` |
| City/anime editing | `panel/city/[id]/ui.tsx`, `panel/anime/[id]/ui.tsx` | 679/575 lines |
| Admin entry | `layout.tsx` + `page.tsx` | isAdmin check in page.tsx |

## CONVENTIONS
- Keep admin pages server-safe; do not trust client state for authorization decisions.
- Prefer existing fetch/action patterns in neighboring admin modules before adding new abstractions.
- Preserve localized Chinese operator-facing copy where existing pages already use it.
- For long-running/batch actions, always surface progress and partial-failure states.
- Auth boundary: `(authed)/layout.tsx` checks session; admin `page.tsx` checks `isAdmin`.

## ANTI-PATTERNS
- Do not bypass auth checks by relying on only client session data.
- Do not add heavy logic into layout-level components.
- Do not introduce silent failures in moderation/batch tools.
- Do not fork request payload conventions from existing admin APIs.

## NOTES
- 5 hotspot files exceed 700 lines; make surgical edits.
- When touching moderation UX, cross-check server behavior in `lib/article/handlers/admin*.ts`.
- City/anime panels are admin-only entity editors backed by dedicated lib modules.

## COMMANDS
```bash
npm test -- tests/translation
npm test -- tests/admin
```
