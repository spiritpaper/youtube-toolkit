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
