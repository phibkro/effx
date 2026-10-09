import { Schema } from "effect";
import { Model } from "effect/unstable/schema";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { Rfc3339InstantSchema } from "../time.js";

const text = (maxLength: number) =>
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value) => value.trim().length > 0, {
        message: "a non-empty string",
      }),
      Schema.isMaxLength(maxLength),
    ),
  );

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const positiveSafeInt = (brandName: string) =>
  Schema.Int.pipe(
    Schema.check(
      Schema.makeFilter(Number.isSafeInteger, { message: "a safe integer" }),
      Schema.isGreaterThan(0),
    ),
    Schema.brand(brandName),
  );

export const ArticleId = positiveSafeInt("ArticleId");

export type ArticleId = typeof ArticleId.Type;

/** One-based immutable sequence number issued per publish. */
export const ArticleVersionNumber = positiveSafeInt("ArticleVersionNumber");

export type ArticleVersionNumber = typeof ArticleVersionNumber.Type;

/** The longest article slug. A slug is ASCII, so its percent-encoded path segment is no longer. */
export const ARTICLE_SLUG_MAX_LENGTH = 255;

export const ArticleSlug = text(ARTICLE_SLUG_MAX_LENGTH).pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[a-z0-9-]+$/.test(value), {
      message: "a lowercase slug of letters, digits, and hyphens",
    }),
  ),
  Schema.brand("ArticleSlug"),
);

export type ArticleSlug = typeof ArticleSlug.Type;

export const ContentCommandId = text(255).pipe(Schema.brand("ContentCommandId"));

export type ContentCommandId = typeof ContentCommandId.Type;

const Title = text(255);

const BodyHtml = text(100000);

const Instant = Rfc3339InstantSchema;

const PersonDisplayName = text(255);

const DepartmentScopeIds = Schema.Array(DepartmentId).pipe(
  Schema.check(
    Schema.makeFilter(
      (departmentIds) =>
        departmentIds.every(
          (departmentId, index) =>
            index === 0 || departmentIds[index - 1]!.localeCompare(departmentId) < 0,
        ),
      { message: "unique department identifiers sorted ascending" },
    ),
  ),
);

export const ArticleStatusSchema = Schema.Literals(["Draft", "Published"]);

export type ArticleStatus = typeof ArticleStatusSchema.Type;

/**
 * Canonical editorial working copy owned by ContentManagement. Private and
 * generated fields carry no client-writable variant; the slug is assigned by
 * the server at creation and immutable afterwards.
 */
export class ArticleDraft extends Model.Class<ArticleDraft>("Content.ArticleDraft")({
  articleId: Model.GeneratedByDb(ArticleId),
  title: Model.Field({
    select: Title,
    insert: Title,
    update: Title,
    json: Title,
    jsonCreate: Title,
    jsonUpdate: Title,
  }),
  slug: Model.Field({
    select: ArticleSlug,
    insert: ArticleSlug,
    json: ArticleSlug,
  }),
  bodyHtml: Model.Field({
    select: BodyHtml,
    insert: BodyHtml,
    update: BodyHtml,
    json: BodyHtml,
    jsonCreate: BodyHtml,
    jsonUpdate: BodyHtml,
  }),
  sticky: Model.Field({
    select: Schema.Boolean,
    insert: Schema.Boolean,
    update: Schema.Boolean,
    json: Schema.Boolean,
    jsonCreate: Schema.Boolean,
    jsonUpdate: Schema.Boolean,
  }),
  /** Private: server-set author, absent from every JSON variant. */
  createdByPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
  }),
  createdAt: Model.GeneratedByDb(Instant),
  updatedAt: Model.GeneratedByDb(Instant),
  /** Null while draft; set by publish and cleared by unpublish. */
  currentVersionNumber: Model.GeneratedByApp(Schema.NullOr(ArticleVersionNumber)),
  revision: Model.Field({
    select: Revision,
    insert: Revision,
    update: Revision,
    json: Revision,
  }),
}) {}

export type ArticleDraftSelect = typeof ArticleDraft.Encoded;

export type ArticleDraftInsert = typeof ArticleDraft.insert.Encoded;

export type ArticleDraftUpdate = typeof ArticleDraft.update.Encoded;

export type ArticleDraftJson = typeof ArticleDraft.json.Type;

export type ArticleDraftJsonCreate = typeof ArticleDraft.jsonCreate.Type;

export type ArticleDraftJsonUpdate = typeof ArticleDraft.jsonUpdate.Type;

/**
 * Immutable published snapshot written once by the publish transition. No
 * update variant exists; the private publisher identity has no JSON variant.
 */
export class PublishedArticleVersion extends Model.Class<PublishedArticleVersion>(
  "Content.PublishedArticleVersion",
)({
  articleId: Model.Field({
    select: ArticleId,
    insert: ArticleId,
    json: ArticleId,
  }),
  versionNumber: Model.Field({
    select: ArticleVersionNumber,
    insert: ArticleVersionNumber,
    json: ArticleVersionNumber,
  }),
  title: Model.Field({
    select: Title,
    insert: Title,
    json: Title,
  }),
  slug: Model.Field({
    select: ArticleSlug,
    insert: ArticleSlug,
    json: ArticleSlug,
  }),
  bodyHtml: Model.Field({
    select: BodyHtml,
    insert: BodyHtml,
    json: BodyHtml,
  }),
  sticky: Model.Field({
    select: Schema.Boolean,
    insert: Schema.Boolean,
    json: Schema.Boolean,
  }),
  publishedAt: Model.Field({
    select: Instant,
    insert: Instant,
    json: Instant,
  }),
  /** Private: absent from every public JSON variant. */
  publishedByPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
  }),
}) {}

export type PublishedArticleVersionSelect = typeof PublishedArticleVersion.Encoded;

export type PublishedArticleVersionInsert = typeof PublishedArticleVersion.insert.Encoded;

export type PublishedArticleVersionJson = typeof PublishedArticleVersion.json.Type;

/** Semantic identity is the (article, department) pair itself. */
export class ArticleDepartment extends Model.Class<ArticleDepartment>("Content.ArticleDepartment")({
  articleId: Model.Field({
    select: ArticleId,
    insert: ArticleId,
    json: ArticleId,
    jsonCreate: ArticleId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
    jsonCreate: DepartmentId,
  }),
}) {}

export type ArticleDepartmentSelect = typeof ArticleDepartment.Encoded;

export type ArticleDepartmentInsert = typeof ArticleDepartment.insert.Encoded;

export type ArticleDepartmentJson = typeof ArticleDepartment.json.Type;

export type ArticleDepartmentJsonCreate = typeof ArticleDepartment.jsonCreate.Type;

// --- Staff workspace boundaries ---

const DraftJsonFields = ArticleDraft.json.fields;

export const ContentWorkspaceEntrySchema = Schema.Struct({
  articleId: DraftJsonFields.articleId,
  title: DraftJsonFields.title,
  slug: DraftJsonFields.slug,
  status: ArticleStatusSchema,
  sticky: DraftJsonFields.sticky,
  updatedAt: DraftJsonFields.updatedAt,
  departmentIds: DepartmentScopeIds,
  canRevise: Schema.Boolean,
  canPublish: Schema.Boolean,
  authorDisplayName: PersonDisplayName,
});

export type ContentWorkspaceEntry = typeof ContentWorkspaceEntrySchema.Type;

export const ContentArticleDetailSchema = Schema.Struct({
  articleId: DraftJsonFields.articleId,
  title: DraftJsonFields.title,
  slug: DraftJsonFields.slug,
  status: ArticleStatusSchema,
  bodyHtml: DraftJsonFields.bodyHtml,
  sticky: DraftJsonFields.sticky,
  createdAt: DraftJsonFields.createdAt,
  updatedAt: DraftJsonFields.updatedAt,
  currentVersionNumber: DraftJsonFields.currentVersionNumber,
  revision: DraftJsonFields.revision,
  departmentIds: DepartmentScopeIds,
  canRevise: Schema.Boolean,
  canPublish: Schema.Boolean,
  authorDisplayName: PersonDisplayName,
});

export type ContentArticleDetail = typeof ContentArticleDetailSchema.Type;

const compareWorkspaceEntries = (left: ContentWorkspaceEntry, right: ContentWorkspaceEntry) => {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;

  return right.articleId - left.articleId;
};

export const ContentWorkspaceSchema = Schema.Struct({
  entries: Schema.Array(ContentWorkspaceEntrySchema).pipe(
    Schema.check(
      Schema.makeFilter(
        (entries) =>
          entries.every(
            (entry, index) =>
              index === 0 || compareWorkspaceEntries(entries[index - 1]!, entry) < 0,
          ),
        { message: "workspace entries ordered by updatedAt DESC then articleId DESC" },
      ),
    ),
  ),
});

export type ContentWorkspace = typeof ContentWorkspaceSchema.Type;

export const ContentWorkspaceQuerySchema = Schema.Struct({
  departmentId: Schema.optional(DepartmentId),
});

export type ContentWorkspaceQuery = typeof ContentWorkspaceQuerySchema.Type;

// --- Public news boundaries (Content authority) ---

const VersionJsonFields = PublishedArticleVersion.json.fields;

export const PublishedNewsSummarySchema = Schema.Struct({
  slug: VersionJsonFields.slug,
  title: VersionJsonFields.title,
  sticky: VersionJsonFields.sticky,
  publishedAt: VersionJsonFields.publishedAt,
  authorDisplayName: PersonDisplayName,
  departmentIds: DepartmentScopeIds,
  hasImage: Schema.Boolean,
  imageUrl: Schema.optional(Schema.String),
});

export type PublishedNewsSummary = typeof PublishedNewsSummarySchema.Type;

const compareSummaries = (left: PublishedNewsSummary, right: PublishedNewsSummary): number => {
  if (left.sticky !== right.sticky) return left.sticky ? -1 : 1;

  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt < right.publishedAt ? 1 : -1;
  }

  return 0;
};

export const PublishedNewsListingSchema = Schema.Struct({
  articles: Schema.Array(PublishedNewsSummarySchema).pipe(
    Schema.check(
      Schema.makeFilter(
        (articles) =>
          articles.every(
            (article, index) => index === 0 || compareSummaries(articles[index - 1]!, article) <= 0,
          ),
        {
          message: "listing ordered sticky-first, then publishedAt DESC",
        },
      ),
    ),
  ),
});

export type PublishedNewsListing = typeof PublishedNewsListingSchema.Type;

export const PublishedNewsVersionRefSchema = Schema.Struct({
  versionNumber: VersionJsonFields.versionNumber,
  publishedAt: VersionJsonFields.publishedAt,
  urlPath: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value) => value.startsWith("/nyhet/"), {
        message: "a stable /nyhet/ version path",
      }),
    ),
  ),
});

export type PublishedNewsVersionRef = typeof PublishedNewsVersionRefSchema.Type;

export const PublishedNewsArticleSchema = Schema.Struct({
  slug: VersionJsonFields.slug,
  title: VersionJsonFields.title,
  sticky: VersionJsonFields.sticky,
  publishedAt: VersionJsonFields.publishedAt,
  authorDisplayName: PersonDisplayName,
  departmentIds: DepartmentScopeIds,
  hasImage: Schema.Boolean,
  imageUrl: Schema.optional(Schema.String),
  bodyHtml: VersionJsonFields.bodyHtml,
  previousVersions: Schema.Array(PublishedNewsVersionRefSchema).pipe(
    Schema.check(
      Schema.makeFilter(
        (versions) =>
          versions.every(
            (version, index) =>
              index === 0 || versions[index - 1]!.versionNumber > version.versionNumber,
          ),
        { message: "previous versions sorted by descending version number" },
      ),
    ),
  ),
});

export type PublishedNewsArticle = typeof PublishedNewsArticleSchema.Type;

// --- Commands ---

const CommandFields = {
  commandId: ContentCommandId,
};

export const CreateArticleDraftInputSchema = Schema.Struct({
  ...CommandFields,
  title: ArticleDraft.jsonCreate.fields.title,
  bodyHtml: ArticleDraft.jsonCreate.fields.bodyHtml,
  departmentIds: Schema.Array(DepartmentId).pipe(
    Schema.check(
      Schema.makeFilter((departmentIds) => new Set(departmentIds).size === departmentIds.length, {
        message: "unique department identifiers",
      }),
    ),
  ),
  sticky: Schema.optional(ArticleDraft.jsonCreate.fields.sticky),
});

export type CreateArticleDraftInput = typeof CreateArticleDraftInputSchema.Type;

export const ReviseArticleDraftInputSchema = Schema.Struct({
  ...CommandFields,
  articleId: ArticleDraft.json.fields.articleId,
  expectedRevision: ArticleDraft.update.fields.revision,
  title: ArticleDraft.jsonUpdate.fields.title,
  bodyHtml: ArticleDraft.jsonUpdate.fields.bodyHtml,
  departmentIds: Schema.Array(DepartmentId).pipe(
    Schema.check(
      Schema.makeFilter((departmentIds) => new Set(departmentIds).size === departmentIds.length, {
        message: "unique department identifiers",
      }),
    ),
  ),
  sticky: Schema.optional(ArticleDraft.jsonUpdate.fields.sticky),
});

export type ReviseArticleDraftInput = typeof ReviseArticleDraftInputSchema.Type;

export const PublishArticleInputSchema = Schema.Struct({
  ...CommandFields,
  articleId: ArticleDraft.json.fields.articleId,
});

export type PublishArticleInput = typeof PublishArticleInputSchema.Type;

export const UnpublishArticleInputSchema = Schema.Struct({
  ...CommandFields,
  articleId: ArticleDraft.json.fields.articleId,
});

export type UnpublishArticleInput = typeof UnpublishArticleInputSchema.Type;

// --- Observations ---

export const PublishObservationSchema = Schema.TaggedStruct("Published", {
  commandId: ContentCommandId,
  articleId: ArticleId,
  versionNumber: ArticleVersionNumber,
  publishedAt: Instant,
});

export type PublishObservation = typeof PublishObservationSchema.Type;

export const UnpublishObservationSchema = Schema.TaggedStruct("Unpublished", {
  commandId: ContentCommandId,
  articleId: ArticleId,
});

export type UnpublishObservation = typeof UnpublishObservationSchema.Type;
