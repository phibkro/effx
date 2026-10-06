// Runs the same rehype-code plugin and configuration as the site, without Next.js/docgen.
// Unknown languages are permitted: they must render as text rather than throwing.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import { rehypeCode } from 'fumadocs-core/mdx-plugins';
import { mdxOptions, rehypeCodeOptions as options } from '../lib/highlighter.ts';
import { evaluate } from '@mdx-js/mdx';
import { createElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { bundledDiagnosticEntries } from '../../../packages/compiler/src/diagnostics/index.ts';
import { renderCatalogue } from '../../../packages/diagnostics/src/render.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
assert.equal(options.fallbackLanguage, 'text', 'docs highlighter must keep fallbackLanguage: text');
const highlighter = unified().use(rehypeCode, options);
const markdown = unified().use(remarkParse).use(remarkFrontmatter);
const mdx = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx);

function highlight(language, code) {
  return highlighter.run({
    type: 'root',
    children: [{
      type: 'element', tagName: 'pre', properties: {},
      children: [{
        type: 'element', tagName: 'code',
        properties: { className: language ? [`language-${language}`] : [] },
        children: [{ type: 'text', value: code }],
      }],
    }],
  });
}

function hasTokenColors(tree) {
  let colored = false;
  visit(tree, 'element', (node) => {
    if (node.tagName === 'span' && typeof node.properties.style === 'string' &&
      node.properties.style.includes('--shiki-light:')) colored = true;
  });
  return colored;
}

// Regression probes: a future language need not appear in today's content to be safe.
const sample = 'permit(principal, action, resource);';
assert.deepEqual(await highlight('effx-unregistered-fence-probe', sample), await highlight('text', sample),
  'an unknown language must produce exactly the text fallback');
assert.ok(hasTokenColors(await highlight('cedar', sample)), 'the pinned Cedar grammar must tokenize policies');
assert.ok(hasTokenColors(await highlight('ts', 'export const value = 1;')),
  'adding a fallback must not disable syntax highlighting for known languages');

const languages = new Map();
let files = 0;
let fences = 0;
for (const pattern of ['docs/**/*.md', 'apps/docs/content/**/*.{md,mdx}', 'ai-docs/**/*.{md,mdx}']) {
  for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
    files++;
    const parser = path.endsWith('.mdx') ? mdx : markdown;
    const source = await readFile(root + path, 'utf8');
    let tree;
    try {
      tree = parser.parse(source);
    } catch (cause) {
      throw new Error(`docs:check: cannot parse ${path}: ${String(cause)}`, { cause });
    }
    visit(tree, 'code', (node) => {
      fences++;
      const lang = node.lang ?? '';
      if (!languages.has(lang)) languages.set(lang, {
        code: node.value, location: `${path}:${node.position?.start.line ?? 1}`,
      });
    });
  }
}
assert.ok(files > 0 && fences > 0, 'docs:check must discover documentation files and fences');
for (const [lang, { code, location }] of languages) {
  try {
    await highlight(lang, code);
  } catch (cause) {
    throw new Error(`docs:check: fence language ${JSON.stringify(lang)} at ${location} cannot render: ${String(cause)}`, { cause });
  }
}
console.log(`docs:check: ${files} files, ${fences} fences, ${languages.size} language labels render; Cedar/TypeScript tokens and unknown-language fallback pass`);

// Compile the shared catalogue all the way to React HTML. Markdown (.md) is
// intentional: it is the site's registry format, where raw HTML anchors vanished.
const preset = await mdxOptions();
async function renderMarkdown(source) {
  const { default: Content } = await evaluate(source, { ...preset, ...jsxRuntime, format: 'md' });
  return renderToStaticMarkup(createElement(Content));
}

function descendants(node, tagName) {
  return (node.childNodes ?? []).flatMap((child) => [
    ...(child.tagName === tagName ? [child] : []), ...descendants(child, tagName),
  ]);
}
const attribute = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;
const text = (node) => node.nodeName === '#text' ? node.value :
  (node.childNodes ?? []).map(text).join('');
const normalized = (value) => value.replace(/\s+/gu, ' ').trim();

function assertCatalogue(html, entries) {
  const tree = parseFragment(html);
  const headings = descendants(tree, 'h2');
  const index = descendants(tree, 'table')[0];
  assert.ok(index, 'catalogue index table must survive rendering');
  const links = descendants(index, 'a');
  assert.equal(headings.length, entries.length, 'each registry entry must have one rendered heading');
  assert.equal(links.length, entries.length, 'each registry entry must have one rendered index link');
  const ids = new Set();
  for (const entry of entries) {
    const link = links.find((node) => text(node) === entry.code);
    assert.ok(link, `missing index link for ${entry.code}`);
    const href = attribute(link, 'href');
    assert.ok(href?.startsWith('#'), 'catalogue index links must be local fragments');
    const id = decodeURIComponent(href.slice(1));
    const matches = headings.filter((node) => attribute(node, 'id') === id);
    assert.equal(matches.length, 1, `missing unique heading target for ${entry.code}`);
    const heading = matches[0];
    assert.equal(id, entry.code, 'heading identity must preserve the complete registry code');
    assert.equal(text(heading), `${entry.code} — ${entry.title}`, 'index must target its own diagnostic heading');
    assert.ok(!ids.has(id), 'punctuation-distinct registry codes must not share an ID');
    ids.add(id);
    const siblings = heading.parentNode.childNodes;
    const start = siblings.indexOf(heading);
    const end = siblings.findIndex((node, index) => index > start && node.tagName === 'h2');
    const section = { childNodes: siblings.slice(start + 1, end < 0 ? undefined : end) };
    const codes = descendants(section, 'pre').flatMap((pre) => descendants(pre, 'code')).map(text);
    assert.deepEqual(codes.map((code) => code.trimEnd()),
      entry.examples.flatMap((example) => [example.before.trimEnd(), example.after.trimEnd()]),
      `before/after examples must remain under ${entry.code}`);
    assert.ok(normalized(text(section)).includes('Before:') && normalized(text(section)).includes('After:'),
      'example labels must survive rendering');
  }
  return tree;
}

assert.equal(bundledDiagnosticEntries.length, 71, 'the production catalogue includes both declared naming diagnostics');
const catalogue = renderCatalogue(bundledDiagnosticEntries);
const catalogueHtml = await renderMarkdown(catalogue);
assertCatalogue(catalogueHtml, bundledDiagnosticEntries);

// These are isolated compiler inputs, never entries in a shipped registry/page.
// These names collide under ordinary punctuation-stripping heading slugs.
const fixtures = [
  { code: "EFFX[@fixture/effx-example]/0001", owner: "@fixture/effx-example" },
  { code: "EFFX[fixtureeffx-example]/0001", owner: "fixtureeffx-example" },
].map((identity, index) => ({
  ...identity,
  title: 'Namespaced fixture | <example> [repair]',
  severity: 'error',
  severityPolicy: { kind: 'fixed' },
  explanation: `Fixture explanation ${index} preserves the full namespaced code.`,
  examples: [{
    before: `const before = ${index};`,
    after: `const after = ${index};`,
    explanation: `Fixture repair ${index}.`,
    language: 'ts',
  }],
}));
const fixtureHtml = await renderMarkdown(renderCatalogue(fixtures));
assertCatalogue(fixtureHtml, fixtures);
// Compare rendered explanations (including Markdown inline semantics), not source strings.
for (const [html, entries] of [[catalogueHtml, bundledDiagnosticEntries], [fixtureHtml, fixtures]]) {
  const tree = parseFragment(html);
  for (const entry of entries) {
    const heading = descendants(tree, 'h2').find((node) => attribute(node, 'id') === entry.code);
    const siblings = heading.parentNode.childNodes;
    const start = siblings.indexOf(heading);
    const end = siblings.findIndex((node, index) => index > start && node.tagName === 'h2');
    const sectionText = normalized(text({ childNodes: siblings.slice(start + 1, end < 0 ? undefined : end) }));
    for (const prose of [entry.explanation, ...entry.examples.map((example) => example.explanation)]) {
      const expected = normalized(text(parseFragment(await renderMarkdown(prose))));
      assert.ok(expected.length > 0 && sectionText.includes(expected),
        `rendered explanation must remain under ${entry.code}`);
    }
  }
}

// Negative control recreates the actual dead-link defect. The same final-HTML
// assertion must reject it; testing only source <a> tags would incorrectly pass.
const probe = bundledDiagnosticEntries.find((entry) => entry.code === 'EFFX2415');
assert.ok(probe, 'actual browser defect code must remain in the regression');
const broken = renderCatalogue([probe])
  .replace('(#EFFX2415)', '(#diagnostic-effx2415)')
  .replace(' [#EFFX2415]', '')
  .replace('## EFFX2415', '<a id="diagnostic-effx2415" />\n\n## EFFX2415');
const brokenHtml = await renderMarkdown(broken);
assert.throws(() => assertCatalogue(brokenHtml, [probe]), /missing unique heading target/);

// Bounded, opt-in browser evidence: one ignored HTML file outside site content.
// bun run --cwd apps/docs check:fences --emit-anchor-fixture
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--emit-anchor-fixture'),
  'only --emit-anchor-fixture is supported');
if (args[0] === '--emit-anchor-fixture') {
  const path = root + '.effx/diagnostic-anchor-fixture.html';
  await mkdir(root + '.effx', { recursive: true });
  await writeFile(path, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Diagnostic anchor regression</title><body>' + fixtureHtml + '</body></html>');
  console.log(`docs:check: isolated browser fixture: ${path}`);
}
console.log(`docs:check: ${bundledDiagnosticEntries.length} compiled diagnostic index targets, explanations, examples, namespaced/punctuation fixtures and dead-link negative control pass`);
