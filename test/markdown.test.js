import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../src/lib/markdown.js';

test('renders headings, lists, emphasis and paragraphs', () => {
  const html = markdownToHtml('## Patterns\n- **Bold** idea\n- *quiet* one\n\n1. First\n2. Second\n\nPlain `code` text');
  assert.equal(
    html,
    '<h3>Patterns</h3><ul><li><strong>Bold</strong> idea</li><li><em>quiet</em> one</li></ul>' +
      '<ol><li>First</li><li>Second</li></ol><p>Plain <code>code</code> text</p>',
  );
});

test('escapes HTML from the model', () => {
  const html = markdownToHtml('<img src=x onerror=alert(1)> **<b>hi</b>**');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('&lt;img'));
});

test('escaped asterisks stay literal and do not break bold', () => {
  assert.equal(markdownToHtml('**Draft 2 (Mistake?)\\***'), '<p><strong>Draft 2 (Mistake?)*</strong></p>');
  assert.equal(markdownToHtml('5 \\* 3'), '<p>5 * 3</p>');
});

test('horizontal rules', () => {
  assert.equal(markdownToHtml('one\n\n---\n\ntwo'), '<p>one</p><hr><p>two</p>');
});

test('tables, with or without outer pipes, and escaped cells', () => {
  assert.equal(
    markdownToHtml('| Weak | Strong |\n|---|:--:|\n| "I struggled" | The *moment* |'),
    '<div class="md-table"><table><thead><tr><th>Weak</th><th>Strong</th></tr></thead><tbody><tr><td>&quot;I struggled&quot;</td><td>The <em>moment</em></td></tr></tbody></table></div>',
  );
  assert.equal(
    markdownToHtml('Beat | Shot\n--- | ---\nHook | A-roll'),
    '<div class="md-table"><table><thead><tr><th>Beat</th><th>Shot</th></tr></thead><tbody><tr><td>Hook</td><td>A-roll</td></tr></tbody></table></div>',
  );
  assert.ok(!markdownToHtml('| <b>x</b> |').includes('<b>'));
  assert.equal(markdownToHtml('| a \\| b | c |\n|---|---|'), '<div class="md-table"><table><thead><tr><th>a | b</th><th>c</th></tr></thead><tbody></tbody></table></div>');
});

test('a pipe in ordinary text is not a table', () => {
  assert.equal(markdownToHtml('Views | likes ratio is fine'), '<p>Views | likes ratio is fine</p>');
});

test('nested lists and continuation lines', () => {
  assert.equal(
    markdownToHtml('1. **Hook**\n   - cold open\n   - stakes\n2. Payoff\n   lands here'),
    '<ol><li><strong>Hook</strong><ul><li>cold open</li><li>stakes</li></ul></li><li>Payoff<br>lands here</li></ol>',
  );
});

test('numbered lists split by paragraphs keep their numbers', () => {
  assert.equal(
    markdownToHtml('1. One\n\nSome text.\n\n2. Two'),
    '<ol><li>One</li></ol><p>Some text.</p><ol start="2"><li>Two</li></ol>',
  );
  assert.equal(markdownToHtml('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>');
});

test('code blocks are escaped and left unformatted', () => {
  assert.equal(markdownToHtml('```js\nconst a = **b** <i>;\n```'), '<pre><code>const a = **b** &lt;i&gt;;</code></pre>');
  assert.equal(markdownToHtml('use `**not bold**` here'), '<p>use <code>**not bold**</code> here</p>');
});

test('blockquotes, strike, bold-italic, underscores and nested emphasis', () => {
  assert.equal(markdownToHtml('> I spent a week.\n> I tried in one week.'), '<blockquote><p>I spent a week.<br>I tried in one week.</p></blockquote>');
  assert.equal(markdownToHtml('***big*** and ~~old~~'), '<p><strong><em>big</em></strong> and <del>old</del></p>');
  assert.equal(markdownToHtml('**bold with *italic* inside**'), '<p><strong>bold with <em>italic</em> inside</strong></p>');
  assert.equal(markdownToHtml('_Test: shrink it._ and snake_case_name stays'), '<p><em>Test: shrink it.</em> and snake_case_name stays</p>');
  assert.equal(markdownToHtml('*a* and 5 * 3 * 2'), '<p><em>a</em> and 5 * 3 * 2</p>');
  assert.equal(markdownToHtml('## Title ##'), '<h3>Title</h3>');
});

test('only http(s) links become anchors', () => {
  assert.equal(
    markdownToHtml('[docs](https://example.com/a) [bad](javascript:alert(1))'),
    '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a> [bad](javascript:alert(1))</p>',
  );
  assert.ok(!markdownToHtml('[x](https://a.com/"onmouseover="y)').includes('"onmouseover'));
});
