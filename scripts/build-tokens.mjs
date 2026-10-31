// Generates src/web/tokens.css from the design system's tokens.json.
// Usage: node scripts/build-tokens.mjs <path-to-tokens.json>
import fs from 'node:fs';
import prettier from 'prettier';

const source = process.argv[2] ?? 'design/tokens.json';
const t = JSON.parse(fs.readFileSync(source, 'utf8'));
const esc = (n) => n.replace(/\./g, '\\.');
const themes = t.color.themes.map((x) => x.id);
const first = themes[0];
const val = (tok, th) => (typeof tok.value === 'string' ? tok.value : tok.value[th]);
const lines = (fam, th, pad = '  ') =>
  (t[fam]?.tokens ?? [])
    .map((tok) => {
      let v = val(tok, th) ?? val(tok, first);
      if (!v) return null;
      if (/^\{.+\}$/.test(v)) v = `var(--${v.slice(1, -1)})`;
      return `${pad}--${esc(tok.name)}: ${v};`;
    })
    .filter(Boolean)
    .join('\n');

const out = [
  "/* Bureau design tokens — generated from the design system's tokens.json.",
  '   Do not edit by hand: change the system, then run scripts/build-tokens.mjs. */',
  '',
  `:root,\n[data-theme='${first}'] {\n  color-scheme: light;\n${lines('color', first)}\n${lines('shadow', first)}\n}\n`,
];
for (const th of themes.slice(1)) {
  out.push(
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n    color-scheme: dark;\n${lines('color', th, '    ')}\n${lines('shadow', th, '    ')}\n  }\n}\n`,
  );
  out.push(
    `[data-theme='${th}'] {\n  color-scheme: dark;\n${lines('color', th)}\n${lines('shadow', th)}\n}\n`,
  );
}
const root = [':root {'];
for (const fam of ['spacing', 'radius', 'size'])
  for (const tok of t[fam]?.tokens ?? []) root.push(`  --${esc(tok.name)}: ${tok.value};`);
for (const [k, v] of Object.entries(t.type.families)) root.push(`  --font-${k}: ${v};`);
root.push('}');
out.push(root.join('\n') + '\n');
for (const g of t.type.groups)
  for (const s of g.styles) {
    const ls = s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : '';
    out.push(
      `.${esc(s.name)} { font-family: var(--font-${s.family ?? g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${ls} }`,
    );
  }
// Formatted here so a regenerate never shows up as a diff against the file
// the pre-commit hook already formatted.
const target = 'src/web/tokens.css';
const css = await prettier.format(out.join('\n') + '\n', {
  ...(await prettier.resolveConfig(target)),
  filepath: target,
});
fs.writeFileSync(target, css);
console.log('wrote', target, 'from', source);
