import { Schema } from "effect";

/** Fixture-local schemas used by both the source declaration and generated contract. */
export const ArticleParams = Schema.Struct({ articleId: Schema.String });
export const EmptyActionPayload = Schema.Struct({});
export const ArticleActionResponse = Schema.Struct({ articleId: Schema.String });
