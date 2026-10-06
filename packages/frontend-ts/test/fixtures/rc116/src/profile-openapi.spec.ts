import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import effectPackage from "effect/package.json";
import { OpenApi } from "effect/unstable/httpapi";
import { ExternalDirectoryApi } from "./directory-root.js";
import { ExternalNativeApi } from "./profile-root.js";
import { compareDenseStatus } from "./dense-status-reflection.js";

const ReflectionMetadata = Schema.Struct({ version: Schema.String, moduleOrigin: Schema.String });

test("generated Profile GET and PATCH retain application OpenAPI transforms", () => {
  const operations = OpenApi.fromApi(ExternalNativeApi).paths["/api/profile"];
  expect(Reflect.get(operations?.get ?? {}, "x-test")).toEqual({
    operationId: "profile.readOwnProfile",
    summary: "Read own profile",
    description: "Returns the authenticated person's current profile, or 304 for a matching ETag.",
    tags: ["Profile"],
  });
  expect(Reflect.get(operations?.patch ?? {}, "x-test")).toEqual({
    operationId: "profile.updateOwnProfile",
    summary: "Update own profile",
    description: "Applies a merge patch with an idempotency key and If-Match precondition.",
    tags: ["Profile"],
  });
});

test("generated Profile GET and PATCH share the identified 200 response schema", () => {
  const spec = OpenApi.fromApi(ExternalNativeApi);
  const operations = spec.paths["/api/profile"];
  const reference = { $ref: "#/components/schemas/UserProfileResponse" };

  expect(operations?.get?.responses[200]?.content?.["application/json"]?.schema).toEqual(reference);
  expect(operations?.patch?.responses[200]?.content?.["application/json"]?.schema).toEqual(
    reference,
  );
  expect(spec.components.schemas.UserProfileResponse).toBeDefined();
  expect(Object.hasOwn(spec.components.schemas, "UserProfileResponse_1")).toBe(false);
  expect(operations?.get?.responses[304]).toBeDefined();
});

test("generated explicit 200 overrides a success schema annotated 201", () => {
  const patch = OpenApi.fromApi(ExternalDirectoryApi).paths["/api/schools/management"]?.patch;

  expect(patch?.responses[200]?.content?.["application/json"]?.schema).toBeDefined();
  expect(patch?.responses[201]).toBeUndefined();
});

// Both test runners use the same real target reflection, not an echoed source contract.

test("post-0024 consumers preserve complete OpenAPI and native SDK operation projections", () => {
  const { effect, explicit, consumer } = compareDenseStatus();
  expect(consumer.openapi).toEqual(explicit.openapi);
  const index = explicit.operations;
  expect(index).toHaveLength(8);
  expect(consumer.operations).toEqual(index);
  expect(index.map(({ group, key, method, path }) => ({ group, key, method, path }))).toEqual([
    { group: "directory", key: "amendSchool", method: "PATCH", path: "/api/schools/management" },
    {
      group: "directory",
      key: "executeSchoolCommand",
      method: "POST",
      path: "/api/schools/commands",
    },
    { group: "directory", key: "listPeople", method: "GET", path: "/api/people" },
    { group: "directory", key: "listSchools", method: "GET", path: "/api/schools" },
    {
      group: "content",
      key: "publishArticle",
      method: "POST",
      path: "/api/content/articles/:articleId:publish",
    },
    { group: "profile", key: "readOwnProfile", method: "GET", path: "/api/profile" },
    {
      group: "content",
      key: "unpublishArticle",
      method: "POST",
      path: "/api/content/articles/:articleId:unpublish",
    },
    { group: "profile", key: "updateOwnProfile", method: "PATCH", path: "/api/profile" },
  ]);
  const spec = consumer.openapi;
  expect(spec.paths["/api/profile"]?.get?.responses[304]).toBeDefined();
  expect(spec.paths["/api/schools/management"]?.patch?.responses[200]).toBeDefined();
  expect(spec.paths["/api/schools/management"]?.patch?.responses[201]).toBeUndefined();

  return Effect.runPromise(
    Effect.gen(function* () {
      const metadata = yield* Schema.decodeEffect(ReflectionMetadata)(effect);
      expect(metadata.version).toBe("4.0.0-rc.116");
      expect(metadata.version).toBe(effectPackage.version);
      expect(metadata.moduleOrigin).toBe(import.meta.resolve("effect/unstable/httpapi"));
    }),
  );
});
