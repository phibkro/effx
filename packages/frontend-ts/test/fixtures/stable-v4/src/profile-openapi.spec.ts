import { expect, test } from "bun:test";
import { OpenApi } from "effect/http-api";
import { ExternalDirectoryApi } from "./directory-root.js";
import { ExternalNativeApi } from "./profile-root.js";

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
