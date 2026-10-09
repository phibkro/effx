import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api";

/** Nonsecurity middleware exercises an explicit per-operation middleware override. */
export class DirectoryRequestMarker extends HttpApiMiddleware.Service<DirectoryRequestMarker>()(
  "fixture/stable-v4/DirectoryRequestMarker",
) {}

export const EmptyDirectoryInput = Schema.Struct({});
export const SchoolsDirectoryQuery = Schema.Struct({ search: Schema.optionalKey(Schema.String) });
export const PeopleDirectoryResponse = Schema.Struct({ people: Schema.Array(Schema.String) });
export const SchoolDirectoryResponse = Schema.Struct({ schools: Schema.Array(Schema.String) });
export const SchoolCommand = Schema.Struct({ schoolId: Schema.String, action: Schema.String });
export const SchoolCommandResult = Schema.Struct({ revision: Schema.Number });
export const SchoolPatch = Schema.Struct({ schoolId: Schema.String, name: Schema.String });
/** Deliberately 201: the Directory contract's explicit 200 must override it. */
export const SchoolPatchResult = Schema.Struct({
  schoolId: Schema.String,
  revision: Schema.Number,
}).pipe(HttpApiSchema.status(201));
export const PrivateReadResponseHeaders = Schema.Struct({
  "cache-control": Schema.Literal("private, no-store"),
});
export const EntityMutationResponseHeaders = Schema.Struct({ etag: Schema.String });
export const IdempotencyHeaders = Schema.Struct({ "idempotency-key": Schema.String });
export const SchoolPatchHeaders = Schema.Struct({ "if-match": Schema.String });

export const PeopleDirectoryResolver = { id: "directory.people" } as const;
export const SchoolsDirectoryResolver = { id: "directory.schools" } as const;
export const SchoolsManagementResolver = { id: "directory.management" } as const;

export class DirectoryAccessAnnotation extends Context.Service<
  DirectoryAccessAnnotation,
  unknown
>()("fixture/stable-v4/DirectoryAccessAnnotation") {}
export const directoryAccessAnnotations = (spec: unknown) =>
  Context.make(DirectoryAccessAnnotation, spec);

export const directoryOperationAnnotations = (metadata: {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
}) =>
  OpenApi.annotations({
    transform: (operation) => ({ ...operation, "x-directory": metadata }),
  });

/** Status is fixture-only; operation declarations own their distinct error-code lists. */
export const DirectoryProblemResponses = (identifier: string, codes: ReadonlyArray<string>) => [
  Schema.Union(
    codes.map((code) =>
      Schema.Struct({
        _tag: Schema.Literal("DirectoryProblem"),
        code: Schema.Literal(code),
        message: Schema.String,
      }).pipe(
        HttpApiSchema.status(
          code === "school.not-found" ? 404 : code === "authority.denied" ? 403 : 409,
        ),
      ),
    ),
  ).annotate({ identifier }),
];

export const ListPeopleCodes = ["authority.denied"] as const;
export const ListSchoolsCodes = ["authority.denied", "directory.unavailable"] as const;
export const SchoolCommandCodes = [
  "authority.denied",
  "school.not-found",
  "school.conflict",
] as const;
export const SchoolPatchCodes = [
  "authority.denied",
  "school.not-found",
  "school.conflict",
  "revision.conflict",
] as const;
