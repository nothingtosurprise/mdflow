// Renders site/content/*.md into static pages at dist/<slug>/index.html.
// These are article pages (e.g. the auto-evolve deep dive, previously hosted
// on an external here.now URL) that ship as part of the mdflow.dev deploy so
// every link on the site stays on the mdflow.dev domain.
//
// Runs after `vite build` (see the "build" script in package.json). The
// markdown files are the source of truth; frontmatter supplies title,
// description, and the original source URL.

import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contentDir = path.join(root, 'content');
const distDir = path.join(root, 'dist');

if (!existsSync(distDir)) {
    console.error('build-content: dist/ not found — run `vite build` first.');
    process.exit(1);
}

function parseFrontmatter(raw) {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) return { meta: {}, body: raw };
    const meta = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return { meta, body: raw.slice(match[0].length) };
}

function page({ title, description, canonical, source, html }) {
    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="icon" href="/eggo.svg" type="image/svg+xml" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="https://mdflow.dev/og-image.png" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #050505;
    --panel: rgba(255, 255, 255, 0.03);
    --border: rgba(255, 255, 255, 0.1);
    --text: #e4e4e7;
    --muted: #a1a1aa;
    --dim: #71717a;
    --accent: #34d399;
    --accent-dim: #10b981;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background:
      radial-gradient(900px 500px at 85% -10%, rgba(16, 185, 129, 0.07), transparent 60%),
      var(--bg);
    color: var(--text);
    font-family: Inter, -apple-system, sans-serif;
    font-weight: 300;
    line-height: 1.7;
    font-size: 16.5px;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 0 22px 90px; }
  .top {
    display: flex; justify-content: space-between; align-items: center;
    padding: 26px 0; font-family: var(--mono); font-size: 13px;
  }
  .top a { color: var(--muted); }
  .top a:hover { color: var(--accent); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1, h2, h3 {
    font-family: "Space Grotesk", Inter, sans-serif;
    color: #fff; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
  }
  h1 { font-size: clamp(30px, 6vw, 46px); margin: 30px 0 18px; }
  h2 {
    font-size: 25px; margin: 64px 0 14px;
    padding-top: 34px; border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  h3 { font-size: 18px; margin: 30px 0 8px; }
  p, li { color: var(--muted); }
  strong { color: var(--text); font-weight: 600; }
  code {
    font-family: var(--mono); font-size: 0.86em; color: #6ee7b7;
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px; border-radius: 5px;
  }
  pre {
    background: #0b0c0e; border: 1px solid var(--border); border-radius: 12px;
    padding: 18px 20px; overflow-x: auto;
    font-size: 13.5px; line-height: 1.65;
  }
  pre code { background: none; padding: 0; color: #d4d4d8; font-size: inherit; }
  blockquote {
    margin: 22px 0; padding: 14px 20px;
    border-left: 3px solid var(--accent-dim);
    background: var(--panel); border-radius: 0 10px 10px 0;
  }
  blockquote p { margin: 0; color: var(--text); font-style: italic; }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 14.5px; }
  th, td { text-align: left; padding: 10px 14px; border: 1px solid var(--border); }
  th {
    font-family: var(--mono); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--dim); background: var(--panel);
  }
  td { color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 50px 0 30px; }
  em { color: var(--text); }
  .src {
    font-family: var(--mono); font-size: 12px; color: var(--dim);
    margin-top: 60px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
</style>
</head>
<body>
<div class="wrap">
  <nav class="top">
    <a href="/">← mdflow.dev</a>
    <a href="https://github.com/johnlindquist/mdflow">github</a>
  </nav>
  <main>
${html}
  </main>
  <p class="src">originally published at ${source || canonical} — now hosted on mdflow.dev</p>
</div>
</body>
</html>
`;
}

const files = readdirSync(contentDir).filter((f) => f.endsWith('.md'));
for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const { meta, body } = parseFrontmatter(readFileSync(path.join(contentDir, file), 'utf8'));
    const html = marked.parse(body, { gfm: true })
        // Tables need their own scroll container so wide rows never widen the page
        .replaceAll('<table>', '<div class="tablewrap"><table>')
        .replaceAll('</table>', '</table></div>');
    const outDir = path.join(distDir, slug);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
        path.join(outDir, 'index.html'),
        page({
            title: meta.title || slug,
            description: meta.description || '',
            canonical: `https://mdflow.dev/${slug}/`,
            source: meta.source,
            html,
        }),
    );
    console.log(`build-content: dist/${slug}/index.html`);
}
