import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'effx';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

/**
 * Deployment prefix (`/<repo>` on GitHub Pages), set from DOCS_BASE_PATH in next.config.mjs.
 * Next.js prefixes its own links and assets; use this only for URLs it cannot see (fetches,
 * text written into llms.txt).
 */
export const basePath = process.env.NEXT_PUBLIC_DOCS_BASE_PATH ?? '';

/** Absolute origin of the deployed site (OG image URLs); unset means "localhost". */
export const siteOrigin = process.env.DOCS_SITE_ORIGIN ?? 'http://localhost:3000';

/** Absolute URL of a root-relative path on the deployed site (Open Graph needs absolute URLs). */
export const absoluteUrl = (path: string) => `${siteOrigin}${basePath}${path}`;

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}

/** llms.txt and the markdown pages link to `/docs/...`; on a project site those need `/<repo>`. */
export const prefixDocsLinks = (markdown: string) =>
  basePath === '' ? markdown : markdown.replaceAll('](/docs', `](${basePath}/docs`);
