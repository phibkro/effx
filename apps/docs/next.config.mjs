import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/**
 * Static export for GitHub Pages (https://fumadocs.dev/docs/deploying/static,
 * https://nextjs.org/docs/app/guides/static-exports).
 *
 * DOCS_BASE_PATH is the only deployment input: empty for a user/organization site or a custom
 * domain, `/<repo>` for a project site (the `Deploy docs` workflow takes it from
 * actions/configure-pages). Next.js rejects a trailing slash and requires a leading one.
 */
const basePath = process.env.DOCS_BASE_PATH ?? '';

if (basePath !== '' && !/^\/[^/]+(\/[^/]+)*$/.test(basePath)) {
  throw new Error(
    `DOCS_BASE_PATH must be empty or start with "/" and not end with "/" (got "${basePath}")`,
  );
}

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  // Emit `docs/x/index.html`, not `docs/x.html`. GitHub Pages answers a request for `/docs/x`
  // with a redirect to `/docs/x/` when a `docs/x/` directory exists (a section with subpages),
  // and that directory has no index.html unless trailingSlash is on.
  trailingSlash: true,
  // The default image optimizer needs a server; the site has no next/image content.
  images: { unoptimized: true },
  // basePath also prefixes `/_next` assets (assetPrefix is only needed for a separate CDN origin).
  ...(basePath === '' ? {} : { basePath }),
  // Client components (the static search dialog) need the same prefix for their own fetches.
  env: { NEXT_PUBLIC_DOCS_BASE_PATH: basePath },
};

export default withMDX(config);
