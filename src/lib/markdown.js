// Markdown -> HTML for AI output: headings, nested lists, bold/italic/strike,
// inline code and code blocks, blockquotes, pipe tables, rules and links.
// All text is HTML-escaped before any tags are added; only http(s) links
// become anchors.

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Backslash-escaped markers (\*, \_) are literal characters, not formatting.
const LITERAL = { '*': '\u0001', _: '\u0002', '#': '\u0003', '`': '\u0004', '|': '\u0005', '~': '\u0006' };
const RESTORE = Object.fromEntries(Object.entries(LITERAL).map(([c, k]) => [k, c]));

function inline(s) {
  const codes = [];
  let t = s.replace(/\\([*_#`|~])/g, (_, c) => LITERAL[c]);
  // Pull code spans out first so nothing inside them is formatted.
  t = t.replace(/`([^`]+)`/g, (_, c) => `\u0007${codes.push(c) - 1}\u0007`);
  t = escape(t)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*\*(?=\S)(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])__(?=\S)(.+?)__(?=[\s.,;:!?)]|$)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>');
  return t
    .replace(/\u0007(\d+)\u0007/g, (_, i) => `<code>${escape(codes[i])}</code>`)
    .replace(/[\u0001-\u0006]/g, (c) => RESTORE[c]);
}

const splitRow = (line) => {
  let t = line.trim().replace(/\\\|/g, LITERAL['|']);
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim().replace(/\u0005/g, '\\|'));
};
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length;
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

export function markdownToHtml(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };

  // Open lists, outermost first: { kind, indent }.
  const lists = [];
  const closeListsTo = (depth) => {
    while (lists.length > depth) out.push(`</li></${lists.pop().kind}>`);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    let m;

    // Fenced code block.
    if ((m = /^\s*(```|~~~)/.exec(line))) {
      flushPara();
      closeListsTo(0);
      const fence = m[1];
      const body = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i]);
      out.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Pipe table: a header row followed by a separator row, or any run of |rows|.
    if (line.includes('|') && (isSeparator(lines[i + 1] ?? '') || /^\s*\|.*\|\s*$/.test(line))) {
      flushPara();
      closeListsTo(0);
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(lines[i++]);
      i--;
      const cells = rows.filter((r) => !isSeparator(r)).map(splitRow);
      const [head, ...body] = cells;
      const width = Math.max(...cells.map((r) => r.length));
      const pad = (r) => [...r, ...Array(width - r.length).fill('')];
      out.push(
        '<div class="md-table"><table>' +
          `<thead><tr>${pad(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${pad(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>` +
          '</table></div>',
      );
      continue;
    }

    if (!line.trim()) {
      flushPara();
      // A blank line ends the lists unless the next non-blank line continues one.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = lines[j] ?? '';
      if (lists.length && !(LIST.test(next) || indentOf(next) > lists[0].indent)) closeListsTo(0);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      closeListsTo(0);
      out.push('<hr>');
      continue;
    }

    if ((m = /^\s*(#{1,6})\s+(.*?)\s*#*$/.exec(line))) {
      flushPara();
      closeListsTo(0);
      const level = Math.min(m[1].length + 1, 4);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushPara();
      closeListsTo(0);
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if ((m = LIST.exec(line))) {
      flushPara();
      const indent = indentOf(m[1]);
      const kind = /\d/.test(m[2]) ? 'ol' : 'ul';
      // Close lists that are deeper than this item.
      while (lists.length && lists.at(-1).indent > indent) closeListsTo(lists.length - 1);
      const top = lists.at(-1);
      if (top && top.indent === indent && top.kind === kind) {
        out.push('</li><li>');
      } else if (top && top.indent === indent) {
        closeListsTo(lists.length - 1);
        open();
      } else {
        open();
      }
      // Task lists: "- [ ] item" / "- [x] item".
      const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
      out.push(task ? `<span class="md-check" aria-hidden="true">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2])}` : inline(m[3]));
      function open() {
        // Keep the model's numbering when a list restarts after a paragraph.
        const start = kind === 'ol' ? parseInt(m[2], 10) : 1;
        out.push(`<${kind}${start > 1 ? ` start="${start}"` : ''}><li>`);
        lists.push({ kind, indent });
      }
      continue;
    }

    // Text indented under a list item continues that item.
    if (lists.length && indentOf(line) > lists[0].indent) {
      out.push(`<br>${inline(line.trim())}`);
      continue;
    }

    closeListsTo(0);
    para.push(line.trim());
  }
  flushPara();
  closeListsTo(0);
  return out.join('');
}
