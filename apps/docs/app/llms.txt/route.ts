import { docsLlms } from '@/lib/source';
import { prefixDocsLinks } from '@/lib/shared';

export const dynamic = 'force-static';
export const revalidate = false;

export async function GET() {
  return new Response(prefixDocsLinks(await docsLlms.index()));
}
