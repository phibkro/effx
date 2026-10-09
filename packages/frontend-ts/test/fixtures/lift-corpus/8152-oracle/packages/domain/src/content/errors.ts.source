import { Schema } from "effect";
import { DepartmentId } from "../organization/schema.js";
import { ArticleId } from "./schema.js";

export class ContentDecodeError extends Schema.TaggedError<ContentDecodeError>()(
  "ContentDecodeError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class ContentPersistenceError extends Schema.TaggedError<ContentPersistenceError>()(
  "ContentPersistenceError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class ContentUnauthenticatedActor extends Schema.TaggedError<ContentUnauthenticatedActor>()(
  "UnauthenticatedActor",
  {},
) {}

export class ContentAuthorityInactive extends Schema.TaggedError<ContentAuthorityInactive>()(
  "AuthorityInactive",
  {},
) {}

export class ContentNotInScope extends Schema.TaggedError<ContentNotInScope>()("NotInScope", {}) {}

/** An active member attempted a publisher act or touched someone else's draft. */
export class ContentNotPublisher extends Schema.TaggedError<ContentNotPublisher>()("NotPublisher", {
  articleId: ArticleId,
}) {}

/** The caller revised a draft they do not own. */
export class ContentDraftNotOwned extends Schema.TaggedError<ContentDraftNotOwned>()(
  "DraftNotOwned",
  { articleId: ArticleId },
) {}

/** Slug-rule violation or cross-table slug collision. */
export class ContentSlugConflict extends Schema.TaggedError<ContentSlugConflict>()(
  "SlugConflict",
  {},
) {}

/** Identical command id with different canonical bytes, or concurrent divergence. */
export class ContentCommandConflict extends Schema.TaggedError<ContentCommandConflict>()(
  "CommandConflict",
  { commandId: Schema.String },
) {}

export class ContentDepartmentNotFound extends Schema.TaggedError<ContentDepartmentNotFound>()(
  "DepartmentNotFound",
  { departmentId: DepartmentId },
) {}

export class ContentArticleNotFound extends Schema.TaggedError<ContentArticleNotFound>()(
  "ArticleNotFound",
  {},
) {}

/**
 * A published version references an author whose Profile row is missing.
 * Typed integrity failure, never an opaque identifier (spec 0062 §Public
 * projections).
 */
export class ContentIntegrityError extends Schema.TaggedError<ContentIntegrityError>()(
  "ContentIntegrityError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export type ContentManagementFailure =
  | ContentDecodeError
  | ContentPersistenceError
  | ContentUnauthenticatedActor
  | ContentAuthorityInactive
  | ContentNotInScope
  | ContentNotPublisher
  | ContentDraftNotOwned
  | ContentSlugConflict
  | ContentCommandConflict
  | ContentDepartmentNotFound
  | ContentIntegrityError
  | ContentArticleNotFound;

export type ReadContentWorkspaceFailure = ContentManagementFailure;

export type PublicationTransitionFailure = ContentManagementFailure;
