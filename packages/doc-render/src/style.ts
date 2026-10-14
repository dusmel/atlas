// md-render.css from the html-docs skill, less the top bar (the frame's toolbar does that job),
// plus nested contents entries.
export const PAGE_CSS = `:root {
  color-scheme: light dark;
  --bg: #ffffff;  --bg-sub: #f8fafc;  --bg-code: #0d1117;
  --text: #1e293b;  --text-muted: #64748b;
  --accent: #2563eb;  --accent-bg: #dbeafe;  --border: #e2e8f0;
  --body-font: 'DM Sans', -apple-system, 'Segoe UI', sans-serif;
  --title-font: 'Lora', Georgia, serif;
  --code-font: 'JetBrains Mono', ui-monospace, monospace;
  --radius: 6px;
}
body.dark {
  --bg: #0f172a;  --bg-sub: #1e293b;  --bg-code: #0d1117;
  --text: #e2e8f0;  --text-muted: #94a3b8;
  --accent: #60a5fa;  --accent-bg: #1e3a5f;  --border: #334155;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 1rem; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--body-font); line-height: 1.6; }
.layout { display: grid; grid-template-columns: 220px minmax(0, 780px); gap: 2.5rem; justify-content: center; padding: 0 1.2rem; }
.layout.no-toc { grid-template-columns: minmax(0, 780px); }
nav.toc { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; padding: 1.6rem 0; font-size: 0.85rem; }
nav.toc .h { color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.5rem; }
nav.toc a { display: block; color: var(--text-muted); text-decoration: none; padding: 0.2rem 0 0.2rem 0.7rem; border-left: 2px solid var(--border); }
nav.toc a.sub { padding-left: 1.5rem; font-size: 0.8rem; }
nav.toc a:hover { color: var(--accent); border-left-color: var(--accent); }
main, nav.toc { min-width: 0; }
main { padding: 1.5rem 0 3rem; }
h1 { font-family: var(--title-font); font-size: 2rem; line-height: 1.25; margin: 0.6rem 0 0.8rem; }
h2 { font-family: var(--title-font); margin-top: 2.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
h3 { margin-top: 1.6rem; }
a { color: var(--accent); }
.tldr { border-left: 4px solid var(--accent); background: var(--accent-bg); padding: 0.7rem 1rem; border-radius: 0 var(--radius) var(--radius) 0; margin: 1.2rem 0; }
.callout { border-left: 4px solid var(--accent); background: var(--accent-bg); padding: 0.1rem 1rem; border-radius: 0 var(--radius) var(--radius) 0; margin: 1rem 0; }
.callout.warn { border-left-color: #d97706; background: #fffbeb; }
body.dark .callout.warn { background: #292108; }
details.props { border: 1px solid var(--border); border-radius: var(--radius); margin: 1rem 0; background: var(--bg-sub); }
details.props summary { cursor: pointer; padding: 0.5rem 1rem; color: var(--text-muted); font-size: 0.85rem; }
details.props dl { margin: 0; padding: 0 1rem 0.8rem; font-size: 0.9rem; }
details.props dl div { display: flex; gap: 1rem; padding: 0.15rem 0; }
details.props dt { width: 4.5rem; flex-shrink: 0; color: var(--text-muted); }
details.props dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; font-size: 0.88rem; margin: 0.8rem 0; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 0.45rem 0.7rem; text-align: left; vertical-align: top; }
th { background: var(--bg-sub); }
code { font-family: var(--code-font); font-size: 0.84em; background: var(--bg-sub); border: 1px solid var(--border); border-radius: 4px; padding: 0.1em 0.35em; }
pre { background: var(--bg-code); color: #e2e8f0; padding: 1rem; border-radius: var(--radius); overflow-x: auto; font-size: 0.8rem; line-height: 1.5; }
pre code { background: none; border: none; padding: 0; color: inherit; }
:is(p, li) > code { overflow-wrap: break-word; }
pre code.hljs { background: none; padding: 0; }
li { margin-bottom: 0.3rem; }
figure.diagram { margin: 1.4rem 0; }
figure.diagram svg { width: 100%; height: auto; }
figure figcaption { color: var(--text-muted); font-size: 0.8rem; margin-top: 0.3rem; }
.related { margin-top: 52px; border-top: 1px solid var(--border); padding-top: 22px; }
.related h2 { border: none; margin-top: 0; }
.related ul { list-style: none; padding: 0; margin: 0; }
.related li { margin-bottom: 11px; }
.related .why { display: block; color: var(--text-muted); font-size: 14px; }
blockquote { margin: 1rem 0; padding: 0.1rem 1rem; border-left: 3px solid var(--border); color: var(--text-muted); }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  nav.toc { position: static; max-height: none; padding: 0.8rem 0 0.6rem; display: flex; gap: 0.4rem; overflow-x: auto; white-space: nowrap; border-bottom: 1px solid var(--border); }
  nav.toc .h, nav.toc a.sub { display: none; }
  nav.toc a { border: 1px solid var(--border); border-radius: 999px; padding: 0.15rem 0.6rem; flex-shrink: 0; }
}
@media (max-width: 600px) {
  .layout { padding: 0 1rem; }
  h1 { font-size: 1.6rem; }
}`
