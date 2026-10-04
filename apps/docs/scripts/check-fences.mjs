// Runs the same rehype-code plugin and configuration as the site, without Next.js/docgen.
// Unknown languages are permitted: they must render as text rather than throwing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import { rehypeCode } from 'fumadocs-core/mdx-plugins';
import { rehypeCodeOptions as options } from '../lib/highlighter.ts';

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
