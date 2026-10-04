import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Static export: the search index is written once at build time and searched in the browser
// (https://fumadocs.dev/docs/headless/search/orama#static-export).
export const dynamic = 'force-static';
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
