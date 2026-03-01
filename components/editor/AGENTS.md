# EDITOR MODULE

## OVERVIEW
`components/editor` implements TipTap-based rich-text editing with custom nodes/extensions and strict sanitization compatibility requirements.

## STRUCTURE
```text
components/editor/
|- RichTextEditor.tsx
`- extensions/
   |- SeichiCallout.tsx
   |- SeichiRoute.tsx
   `- FigureImage.tsx
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main editor behavior | `components/editor/RichTextEditor.tsx` | Large integration surface |
| Custom node behavior | `components/editor/extensions/*` | TipTap extension definitions |
| Sanitization contract | `lib/richtext/sanitize.ts` | Allowed tags/attrs/styles must match editor output |
| Test shims | `tests/setup.ts` | ProseMirror DOM polyfills required in JSDOM |

## CONVENTIONS
- Preserve output compatibility with `sanitizeRichTextHtml` allowlists.
- Keep extension attribute names stable (`data-*`) unless sanitizer is updated in tandem.
- Prefer incremental extension updates over reworking editor core state.
- When adding rendered HTML, ensure links/images obey existing safe URL rules.

## ANTI-PATTERNS
- Do not add extension tags/attrs without sanitizer updates and tests.
- Do not remove TipTap/ProseMirror test shims from `tests/setup.ts`.
- Do not bypass sanitizer assumptions with raw `dangerouslySetInnerHTML` paths.
- Do not couple editor internals to unrelated page-specific state.
