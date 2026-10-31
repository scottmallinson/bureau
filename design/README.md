# Design source

`tokens.json` is the Bureau design system's token file, vendored here so the
app builds without reaching for anything outside the repository. It is the
single source for `src/web/tokens.css`.

To change a token, change it in the design system, then:

```sh
node scripts/build-tokens.mjs design/tokens.json
```

Never hand-edit `src/web/tokens.css`: it is generated, and the next run of the
script will overwrite it. The app's own variable names are aliased onto these
tokens at the top of `src/web/styles.css`.

The two faces the tokens name are self-hosted in `src/web/fonts/`.
