import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import cedar from '../public/vendor/cedar/cedar.tmLanguage.json';

// MDX 15.4.6's applyMdxPreset forwards rehypeCodeOptions to Core 16.16.0's plugin.
// fallbackLanguage handles unknown names; defaultLanguage only handles unlabelled fences.
export const rehypeCodeOptions = {
  ...rehypeCodeDefaultOptions,
  fallbackLanguage: 'text',
  // Raw upstream grammar is unchanged. Adapt only the Shiki id ("Cedar" -> "cedar").
  // cedar-policy/vscode-cedar e592133f33e4e9d2dd93ea7ee2e003e7e4e28e66, Apache-2.0.
  langs: [{ ...cedar, name: 'cedar' }],
};

// The site and compiled-content regression share one complete MDX preset.
export const mdxOptions = applyMdxPreset({ rehypeCodeOptions });
