import { Command, Http } from "@effx/runtime";
import { Effect, Schema } from "effect";

export const ContentArticleParams = Schema.Struct({ articleId: Schema.String });

export const ContentActionPayload = Schema.Struct({});

export const ContentActionResponse = Schema.Struct({ articleId: Schema.String });

export class ContentActionOperations {
  @Command({ name: "Article.Publish", input: ContentActionPayload, success: ContentActionResponse })
  @Http.Post("/api/content/articles/:articleId:publish")
  @Http.Contract({
    group: "users",
    params: ContentArticleParams,
    payload: ContentActionPayload,
    success: ContentActionResponse,
    status: 200,
    metadata: { operationId: "users.publishArticle" },
  })
  static publish(_input: typeof ContentActionPayload.Type) {
    return Effect.succeed({ articleId: "published" });
  }

  @Command({
    name: "Article.Unpublish",
    input: ContentActionPayload,
    success: ContentActionResponse,
  })
  @Http.Post("/api/content/articles/:articleId:unpublish")
  @Http.Contract({
    group: "users",
    params: ContentArticleParams,
    payload: ContentActionPayload,
    success: ContentActionResponse,
    status: 200,
    metadata: { operationId: "users.unpublishArticle" },
  })
  static unpublish(_input: typeof ContentActionPayload.Type) {
    return Effect.succeed({ articleId: "unpublished" });
  }
}
