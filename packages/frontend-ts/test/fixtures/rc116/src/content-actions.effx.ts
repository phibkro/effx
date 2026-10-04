import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import { ArticleActionResponse, ArticleParams, EmptyActionPayload } from "./content-support.js";
import {
  IdempotencyIfMatchHeaders,
  PersonSecurity,
  ProfileCurrentPerson,
  profileAccessAnnotations,
} from "./profile-support.js";
import { ExternalContentApi } from "./content-root.js";

export const ContentActionsGroup = Http.group({
  root: ExternalContentApi,
  group: "content",
  defaults: {
    middleware: [PersonSecurity],
    access: {
      annotator: profileAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
});

export const PublishArticle = Operation.command({
  name: "content.publishArticle",
  input: EmptyActionPayload,
  success: ArticleActionResponse,
})
  .in(ContentActionsGroup)
  .http.post("/api/content/articles/:articleId:publish")
  .http.contract({ params: ArticleParams, headers: IdempotencyIfMatchHeaders, status: 200 })
  .http.access({
    capabilities: Capability.one("content.publish-article"),
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    decisionTime: "Transaction",
  })
  .declare();

export const UnpublishArticle = Operation.command({
  name: "content.unpublishArticle",
  input: EmptyActionPayload,
  success: ArticleActionResponse,
})
  .in(ContentActionsGroup)
  .http.post("/api/content/articles/:articleId:unpublish")
  .http.contract({ params: ArticleParams, headers: IdempotencyIfMatchHeaders, status: 200 })
  .http.access({
    capabilities: Capability.one("content.publish-article"),
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    decisionTime: "Transaction",
  })
  .declare();
