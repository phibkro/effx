import { Context, Effect } from "effect";
import type {
  ContentDecodeError,
  ContentDepartmentNotFound,
  ContentIntegrityError,
} from "./errors.js";
import type { DepartmentId } from "../organization/schema.js";
import type { PublishedNewsArticle, PublishedNewsListing } from "./schema.js";

/** Typed not-found carries no draft-existence information (law 5). */
export interface ArticleNotFound {
  readonly _tag: "ArticleNotFound";
}

export interface ContentOperations {
  /**
   * One complete listing snapshot, sticky-first then publishedAt DESC then
   * articleId DESC; pagination is a pure caller-side slice (law 10).
   */
  readonly readNewsListing: (
    departmentId?: DepartmentId,
  ) => Effect.Effect<
    PublishedNewsListing,
    ContentDecodeError | ContentDepartmentNotFound | ContentIntegrityError
  >;
  /**
   * Resolves one currently-published article by canonical slug with its
   * descending previous-version references.
   */
  readonly readPublishedArticle: (
    slug: string,
    versionNumber?: number,
  ) => Effect.Effect<
    PublishedNewsArticle,
    ContentDecodeError | ContentIntegrityError | ArticleNotFound
  >;
}

export class Content extends Context.Service<Content, ContentOperations>()(
  "@vektorprogrammet/domain/Content",
) {}
