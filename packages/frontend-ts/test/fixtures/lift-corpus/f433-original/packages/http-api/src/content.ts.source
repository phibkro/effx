/**
 * Public HTTP contracts for staff content and published news.
 *
 * @since 0.1.0
 */
import {
  ArticleVersionNumber,
  ArticleId,
  ArticleSlug,
  ContentArticleDetailSchema,
  ContentWorkspaceSchema,
  PublishedNewsArticleSchema,
  PublishedNewsListingSchema,
  type ContentWorkspace,
} from "@vektorprogrammet/domain/content";
import { DepartmentId } from "@vektorprogrammet/domain/organization";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, anonymousNativeAccess, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  ContentCreateArticleProblem,
  ContentListNewsProblem,
  ContentPublishArticleProblem,
  ContentReadArticleProblem,
  ContentReadContentWorkspaceProblem,
  ContentReadNewsArticleProblem,
  ContentReviseArticleProblem,
  ContentUnpublishArticleProblem,
} from "./endpoint-problems.js";
import {
  ConditionalReadHeaders,
  createdMutationResponse,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyHeaders,
  IdempotencyIfMatchHeaders,
  privateConditionalResponses,
  privateReadResponse,
  publicConditionalResponses,
} from "./http-semantics.js";
import {
  ArticleMergePatch,
  CreateArticleRequest,
  PublishArticleRequest,
  PublishArticleResponse,
  UnpublishArticleRequest,
  UnpublishArticleResponse,
} from "./v2-schemas.js";

export { ArticleVersionNumber, ArticleId, ArticleSlug, ContentWorkspaceSchema };

export type { ContentWorkspace };

/**
 * Optional public/staff department filter using the transport key.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const ContentDepartmentQuery = {
  department: Schema.optional(DepartmentId),
};

/**
 * Optional positive published-version selector.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const NewsVersionQuery = {
  version: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))),
};

export const WorkspaceEntryExample = {
  articleId: ArticleId.make(1),
  title: "Penerimaan Anggota Baru 2026",
  slug: ArticleSlug.make("penerimaan-anggota-2026"),
  status: "Draft",
  sticky: false,
  updatedAt: "2026-08-24T09:00:00.000Z",
  departmentIds: [DepartmentId.make("1")],
  canRevise: true,
  canPublish: true,
  authorDisplayName: "Kari Penerbit",
} as const;

export const ArticleDetailExample = {
  articleId: ArticleId.make(1),
  title: "Penerimaan Anggota Baru 2026",
  slug: ArticleSlug.make("penerimaan-anggota-2026"),
  status: "Draft",
  bodyHtml: "<p>Informasi penerimaan anggota baru tahun 2026.</p>",
  sticky: false,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-24T09:00:00.000Z",
  currentVersionNumber: null,
  revision: 0,
  departmentIds: [DepartmentId.make("1")],
  canRevise: true,
  canPublish: true,
  authorDisplayName: "Kari Penerbit",
} as const;

export const NewsListingExample = {
  articles: [
    {
      slug: ArticleSlug.make("penerimaan-anggota-2026"),
      title: "Penerimaan Anggota Baru 2026",
      sticky: true,
      publishedAt: "2026-08-25T08:00:00.000Z",
      authorDisplayName: "Kari Penerbit",
      departmentIds: [DepartmentId.make("1")],
      hasImage: false,
    },
  ],
} as const;

export const NewsArticleExample = {
  slug: ArticleSlug.make("penerimaan-anggota-2026"),
  title: "Penerimaan Anggota Baru 2026",
  sticky: true,
  publishedAt: "2026-08-25T08:00:00.000Z",
  authorDisplayName: "Kari Penerbit",
  departmentIds: [DepartmentId.make("1")],
  hasImage: false,
  bodyHtml: "<p>Informasi penerimaan anggota baru tahun 2026.</p>",
  previousVersions: [],
} as const;

/** @since 0.1.0 @category Endpoints */
export const ReadContentWorkspaceEndpoint = HttpApiEndpoint.get(
  "readContentWorkspace",
  "/api/content/articles",
  {
    query: ContentDepartmentQuery,
    success: privateReadResponse(ContentWorkspaceSchema),
    error: endpointProblemResponses(ContentReadContentWorkspaceProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "content.read-workspace",
        canonicalScopeResolver: "content.articles",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read content workspace",
      "Returns article drafts visible to the current staff actor.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const CreateArticleEndpoint = HttpApiEndpoint.post(
  "createArticle",
  "/api/content/articles",
  {
    headers: IdempotencyHeaders,
    payload: CreateArticleRequest,
    success: createdMutationResponse(ContentArticleDetailSchema.pipe(HttpApiSchema.status(201))),
    error: endpointProblemResponses(ContentCreateArticleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "content.create-article",
        canonicalScopeResolver: "content.article-create",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Create article draft",
      "Creates or replays a native article draft command.",
    ),
  );

const ArticleParams = { articleId: ArticleId };

/** @since 0.1.0 @category Endpoints */
export const ReadArticleEndpoint = HttpApiEndpoint.get(
  "readArticle",
  "/api/content/articles/:articleId",
  {
    params: ArticleParams,
    headers: ConditionalReadHeaders,
    success: privateConditionalResponses(ContentArticleDetailSchema),
    error: endpointProblemResponses(ContentReadArticleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "content.read-article",
        canonicalScopeResolver: "content.article-by-id",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Read article detail", "Returns one staff article detail projection."),
  );

/** @since 0.1.0 @category Endpoints */
export const ReviseArticleEndpoint = HttpApiEndpoint.patch(
  "reviseArticle",
  "/api/content/articles/:articleId",
  {
    params: ArticleParams,
    headers: IdempotencyIfMatchHeaders,
    payload: ArticleMergePatch.pipe(
      HttpApiSchema.asJson({ contentType: "application/merge-patch+json" }),
    ),
    success: entityMutationResponse(ContentArticleDetailSchema),
    error: endpointProblemResponses(ContentReviseArticleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "content.revise-article",
        canonicalScopeResolver: "content.article-by-id",
        requirements: ["content.revisable"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Revise article draft",
      "Revises a draft with optimistic revision control.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const PublishArticleEndpoint = HttpApiEndpoint.post(
  "publishArticle",
  "/api/content/articles/:articleId:publish",
  {
    params: ArticleParams,
    headers: IdempotencyIfMatchHeaders,
    payload: PublishArticleRequest,
    success: entityMutationResponse(PublishArticleResponse),
    error: endpointProblemResponses(ContentPublishArticleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "content.publish-article",
        canonicalScopeResolver: "content.article-by-id",
        requirements: ["content.publishable"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Publish article", "Publishes a new immutable article version."),
  );

/** @since 0.1.0 @category Endpoints */
export const UnpublishArticleEndpoint = HttpApiEndpoint.post(
  "unpublishArticle",
  "/api/content/articles/:articleId:unpublish",
  {
    params: ArticleParams,
    headers: IdempotencyIfMatchHeaders,
    payload: UnpublishArticleRequest,
    success: entityMutationResponse(UnpublishArticleResponse),
    error: endpointProblemResponses(ContentUnpublishArticleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "content.publish-article",
        canonicalScopeResolver: "content.article-by-id",
        requirements: ["content.unpublishable"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Unpublish article",
      "Removes an article from the public current listing.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ListNewsEndpoint = HttpApiEndpoint.get("listNews", "/api/news", {
  query: ContentDepartmentQuery,
  headers: ConditionalReadHeaders,
  success: publicConditionalResponses(
    PublishedNewsListingSchema.annotate({
      identifier: "PublishedNewsListing",
      description: "Current public news listing.",
      examples: [NewsListingExample],
    }),
  ),
  error: endpointProblemResponses(ContentListNewsProblem),
})
  .pipe((endpoint) => annotateAccessSpec(endpoint, anonymousNativeAccess("content.public-news")))
  .annotateMerge(
    operationAnnotations("List published news", "Returns the current public native news listing."),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadNewsArticleEndpoint = HttpApiEndpoint.get("readNewsArticle", "/api/news/:slug", {
  params: { slug: ArticleSlug },
  query: NewsVersionQuery,
  headers: ConditionalReadHeaders,
  success: publicConditionalResponses(
    PublishedNewsArticleSchema.annotate({
      identifier: "PublishedNewsArticle",
      description: "One published news article.",
      examples: [NewsArticleExample],
    }),
  ),
  error: endpointProblemResponses(ContentReadNewsArticleProblem),
})
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("content.public-news-by-slug")),
  )
  .annotateMerge(
    operationAnnotations(
      "Read published news article",
      "Returns the current or selected published version.",
    ),
  );

/**
 * Staff content management and public news API.
 *
 * @since 0.1.0
 * @category Groups
 */
export class ContentApi extends HttpApiGroup.make("content")
  .add(
    ReadContentWorkspaceEndpoint,
    CreateArticleEndpoint,
    ReadArticleEndpoint,
    ReviseArticleEndpoint,
    PublishArticleEndpoint,
    UnpublishArticleEndpoint,
    ListNewsEndpoint,
    ReadNewsArticleEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Content and news",
      description: "Native staff publication and public news operations.",
    }),
  ) {}
