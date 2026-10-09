import { type DepartmentId, PersonId } from "../organization/schema.js";
import type { ContentActor } from "./actor.js";
import { canPublishContent, canReviseDraft } from "./actor.js";
import {
  ArticleVersionNumber,
  ArticleId,
  ArticleSlug,
  PublishedNewsListingSchema,
  PublishedNewsSummarySchema,
  type ContentWorkspace,
  type ContentWorkspaceEntry,
  type PublishedNewsArticle,
  type PublishedNewsListing,
  type PublishedNewsSummary,
} from "./schema.js";

/** Pure pagination slice over the fully loaded listing (page size 10). */
export const NEWS_PAGE_SIZE = 10;

const compareWorkspaceEntries = (left: ContentWorkspaceEntry, right: ContentWorkspaceEntry) => {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;

  return right.articleId - left.articleId;
};

/**
 * Derives the staff workspace rows from raw draft facts plus the resolved
 * actor. `canRevise`/`canPublish` are pure projections of the actor matrix;
 * they never widen authority.
 */
export const projectContentWorkspace = (input: {
  readonly actor: ContentActor;
  readonly drafts: ReadonlyArray<{
    readonly articleId: ArticleId;
    readonly title: string;
    readonly slug: string;
    readonly sticky: boolean;
    readonly updatedAt: string;
    readonly currentVersionNumber: number | null;
    readonly departmentIds: ReadonlyArray<DepartmentId>;
    readonly createdByPersonId: string;
  }>;
  readonly authorDisplayNames: ReadonlyMap<string, string>;
}): ContentWorkspace => {
  const entries = input.drafts.map(
    (draft): ContentWorkspaceEntry => ({
      articleId: draft.articleId,
      title: draft.title,
      slug: ArticleSlug.make(draft.slug),
      status: draft.currentVersionNumber === null ? "Draft" : "Published",
      sticky: draft.sticky,
      updatedAt: draft.updatedAt,
      departmentIds: [...draft.departmentIds],
      canRevise: canReviseDraft(input.actor, {
        createdByPersonId: PersonId.make(draft.createdByPersonId),
        currentVersionNumber: draft.currentVersionNumber,
        departmentIds: draft.departmentIds,
      }),
      canPublish: canPublishContent(input.actor, draft.departmentIds),
      authorDisplayName:
        input.authorDisplayNames.get(draft.createdByPersonId) ?? draft.createdByPersonId,
    }),
  );

  entries.sort(compareWorkspaceEntries);

  return { entries };
};

/** Narrows the authorized set; it can never create authority. */
export const filterWorkspaceByDepartment = (
  workspace: ContentWorkspace,
  departmentId: DepartmentId | undefined,
): ContentWorkspace =>
  departmentId === undefined
    ? workspace
    : {
        entries: workspace.entries.filter((entry) => entry.departmentIds.includes(departmentId)),
      };

export const projectNewsSummaries = (input: {
  readonly versions: ReadonlyArray<{
    readonly slug: string;
    readonly title: string;
    readonly sticky: boolean;
    readonly publishedAt: string;
    readonly articleId: number;
    readonly authorPersonId: string;
  }>;
  readonly departmentsByVersionKey: ReadonlyMap<string, ReadonlyArray<DepartmentId>>;
  readonly authorDisplayNames: ReadonlyMap<string, string>;
}): ReadonlyArray<PublishedNewsSummary> =>
  input.versions.map((version) => {
    const key = `${version.articleId}:${version.publishedAt}`;

    const summary: PublishedNewsSummary = {
      slug: ArticleSlug.make(version.slug),
      title: version.title,
      sticky: version.sticky,
      publishedAt: version.publishedAt,
      authorDisplayName: input.authorDisplayNames.get(version.authorPersonId) ?? "",
      departmentIds: [...(input.departmentsByVersionKey.get(key) ?? [])],
      hasImage: false,
    };

    return summary satisfies typeof PublishedNewsSummarySchema.Type;
  });

/** Sticky-first ordering; equal instants preserve the caller's article-id order. */
export const orderNewsSummaries = (
  summaries: ReadonlyArray<PublishedNewsSummary>,
): PublishedNewsListing => {
  const ordered = [...summaries].sort((left, right) => {
    if (left.sticky !== right.sticky) return left.sticky ? -1 : 1;

    if (left.publishedAt !== right.publishedAt) {
      return left.publishedAt < right.publishedAt ? 1 : -1;
    }

    return 0;
  });

  return { articles: ordered } satisfies typeof PublishedNewsListingSchema.Type;
};

export const paginateNewsListing = (
  listing: PublishedNewsListing,
  page: number,
): PublishedNewsListing => ({
  articles: listing.articles.slice((page - 1) * NEWS_PAGE_SIZE, page * NEWS_PAGE_SIZE),
});

/** Filters by department without disturbing the frozen ordering. */
export const filterNewsListingByDepartment = (
  listing: PublishedNewsListing,
  departmentId: DepartmentId | undefined,
): PublishedNewsListing =>
  departmentId === undefined
    ? listing
    : {
        articles: listing.articles.filter(
          (article) =>
            article.departmentIds.length === 0 || article.departmentIds.includes(departmentId),
        ),
      };

/** Builds the detail projection with descending previous-version references. */
export const projectPublishedNewsArticle = (
  summary: PublishedNewsSummary,
  bodyHtml: string,
  previousVersions: ReadonlyArray<{
    readonly versionNumber: number;
    readonly publishedAt: string;
    readonly slug: string;
  }>,
): PublishedNewsArticle => ({
  ...summary,
  bodyHtml,
  previousVersions: [...previousVersions]
    .sort((left, right) => right.versionNumber - left.versionNumber)
    .map((version): PublishedNewsArticle["previousVersions"][number] => ({
      versionNumber: ArticleVersionNumber.make(version.versionNumber),
      publishedAt: version.publishedAt,
      urlPath: `/nyhet/${version.slug}?versjon=${version.versionNumber}`,
    })),
});

// --- Slug generation (legacy transliteration law) ---

/**
 * Legacy `SlugMaker::setSlugFor`: lowercase, transliterate æøå to ae/o/a,
 * strip everything outside [a-z0-9-], collapse runs, trim hyphens.
 */
export const slugifyTitle = (title: string): string =>
  title
    .toLocaleLowerCase("nb-NO")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Deterministic deduplication against every existing slug: append `-2`,
 * `-3`, … until free. Pure over the taken-slug set.
 */
export const dedupeSlug = (base: string, takenSlugs: ReadonlySet<string>): string => {
  if (!takenSlugs.has(base)) return base;
  let counter = 2;

  while (takenSlugs.has(`${base}-${counter}`)) counter += 1;

  return `${base}-${counter}`;
};
