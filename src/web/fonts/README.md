# Fonts

Bureau's two faces, self-hosted so the app owes nothing to a CDN and renders
the same offline. Both are variable fonts: one file covers every weight the
design system uses (400, 500, 700).

| File                         | Family         | Licence                   |
| ---------------------------- | -------------- | ------------------------- |
| `hanken-grotesk-latin.woff2` | Hanken Grotesk | SIL Open Font License 1.1 |
| `azeret-mono-latin.woff2`    | Azeret Mono    | SIL Open Font License 1.1 |

Both are the `latin` subset as served by Google Fonts. The `@font-face` rules
live at the top of `../styles.css`; the families themselves are named by the
design system in `../tokens.css` (`--font-sans`, `--font-mono`).

To refresh a face, download the latin woff2 from Google Fonts and replace the
file — the filename is referenced in `styles.css` and nowhere else.
