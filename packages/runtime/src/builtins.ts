import type { Context } from "effect";
import type {
  Capability as CapabilityValue,
  ExportedFunctionSymbol,
  Focus as FocusValue,
  HttpAccessAnnotationSpec,
  HttpOperationAnnotator,
  ProblemRegistry,
  ServiceLike,
} from "./Annotation.js";
import type { HttpGroupReference } from "./builder.js";
import { A, type RootSymbolMarker } from "./define/arg.js";
import { defineBuiltin, rest } from "./define/define.js";

/**
 * The built-in annotations, re-expressed with `define` (spec 0020 §3). Each definition reproduces the
 * hand-written option type of `Annotation.ts` and the compiler `Schema` it replaces one-for-one,
 * including the deliberate source sugar (`A.sourceOptional`, `A.sugar`); the strict value sets and the
 * non-empty `codes` tuple are the tightening of spec 0020 §0.1.
 */

const callableAnnotator = A.symbol<HttpOperationAnnotator>({
  check: "callable",
});

const identity = A.symbol<ExportedFunctionSymbol>({
  check: "exported-function",
});

const securityMarkers = A.array(A.symbol<ServiceLike>({ check: "security-marker" }));

const exposure = A.literal("External", "Internal");

/** Non-empty, duplicate-free names: one definition for Access and for the group defaults (spec 0020 §0.1). */
const names = A.nonEmptyArray(A.nonEmptyString, { unique: true });

const principalKinds = A.nonEmptyArray(
  A.literal("Anonymous", "Person", "ServicePrincipal", "CapabilityHolder"),
  { unique: true },
);

const concealment = A.taggedUnion({ Reveal: {}, NotFound: { stages: names } });

const exportedValue = A.symbol<(spec: HttpAccessAnnotationSpec) => Context.Context<never>>({
  check: "exported-value",
});

/**
 * `input` records its static field keys (`fields`) when it has them: the 0013 pre-pass derives the
 * request channels from them (spec 0024 §2). A schema without static keys still lowers, without `fields`.
 */
const operationInput = A.schema({ fieldKeys: "all", fieldsOptional: true });

export const Query = defineBuiltin({
  builder: "query",
  name: "Query",
  target: "operation",
  args: { name: A.optional(A.string), input: operationInput, success: A.schema() },
});

export const Command = defineBuiltin({
  builder: "command",
  name: "Command",
  target: "operation",
  args: { name: A.optional(A.string), input: operationInput, success: A.schema() },
});

export const Errors = defineBuiltin({
  builder: "errors",
  name: "Errors",
  target: "operation",
  args: rest(A.schema()),
});

export const Requirements = defineBuiltin({
  builder: "requirements",
  name: "Requirements",
  target: "operation",
  args: rest(A.symbol<ServiceLike>({ check: "generic" })),
});

export const Authorize = defineBuiltin({
  builder: "authorize",
  name: "Authorize",
  target: "operation",
  args: [A.capability<CapabilityValue>()],
});

export const Rpc = defineBuiltin({
  builder: "rpc",
  name: "Rpc",
  target: "operation",
  args: [A.string],
});

export const Cli = defineBuiltin({
  builder: "cli",
  name: "Cli",
  target: "operation",
  args: [A.string],
});

export const HttpGet = defineBuiltin({
  builder: "http.get",
  name: "Http.Get",
  target: "operation",
  args: [A.string],
});

export const HttpPost = defineBuiltin({
  builder: "http.post",
  name: "Http.Post",
  target: "operation",
  args: [A.string],
});

export const HttpPut = defineBuiltin({
  builder: "http.put",
  name: "Http.Put",
  target: "operation",
  args: [A.string],
});

export const HttpPatch = defineBuiltin({
  builder: "http.patch",
  name: "Http.Patch",
  target: "operation",
  args: [A.string],
});

export const HttpDelete = defineBuiltin({
  builder: "http.delete",
  name: "Http.Delete",
  target: "operation",
  args: [A.string],
});

export const HttpContract = defineBuiltin({
  builder: "http.contract",
  name: "Http.Contract",
  target: "operation",
  cardinality: "one",
  args: [
    A.struct(
      {
        root: A.optional(A.string),
        group: A.sourceOptional(A.string),
        params: A.optional(A.schema({ fieldKeys: "all" })),
        query: A.optional(A.sugar(A.schema(), A.literal(true))),
        headers: A.optional(A.schema({ fieldKeys: "required" })),
        payload: A.optional(A.schema()),
        payloadIsQuery: A.optional(A.boolean),
        success: A.sourceOptional(A.schema()),
        status: A.optional(A.int),
        mediaType: A.optional(A.string),
        responseHeaders: A.optional(A.schema()),
        conditional: A.optional(A.boolean),
        middleware: A.optional(securityMarkers),
        metadata: A.optional(
          A.struct(
            {
              annotator: A.optional(callableAnnotator),
              operationId: A.optional(A.string),
              summary: A.optional(A.string),
              description: A.optional(A.string),
              tags: A.optional(A.array(A.string)),
              commandIdentity: A.optional(identity),
            },
            { rejectDuplicate: ["commandIdentity"] },
          ),
        ),
      },
      { rejectDuplicate: ["metadata"] },
    ),
  ],
});

export const HttpProblems = defineBuiltin({
  builder: "http.problems",
  name: "Http.Problems",
  target: "operation",
  cardinality: "one",
  args: [
    A.struct({
      registry: A.sourceOptional(
        A.symbol<ProblemRegistry>({
          check: "registry",
        }),
      ),
      codes: A.nonEmptyArray(A.nonEmptyString),
      identifier: A.optional(A.string),
      map: A.optional(A.record(A.nonEmptyString)),
    }),
  ],
});

export const HttpAccess = defineBuiltin({
  builder: "http.access",
  name: "Http.Access",
  target: "operation",
  cardinality: "one",
  args: [
    A.struct({
      annotator: A.sourceOptional(exportedValue),
      exposure: A.sourceOptional(exposure),
      acceptedCredentials: A.sourceOptional(names),
      principalKinds: A.sourceOptional(principalKinds),
      capabilities: A.taggedUnion({
        None: {},
        One: { capability: A.nonEmptyString },
        Any: { capabilities: names },
        All: { capabilities: names },
      }),
      requirements: A.array(
        A.struct({ id: A.nonEmptyString, parameters: A.optional(A.jsonObject) }),
      ),
      canonicalScopeResolver: A.symbol<object>({
        check: "exported-value",
      }),
      concealment: A.sourceOptional(concealment),
      // Optional to write: the 0013 pre-pass defaults it from the operation kind (spec 0024 §4).
      decisionTime: A.sourceOptional(A.literal("SnapshotRead", "Transaction")),
      /**
       * Compiler-checked claim that a Command decides authority in a read snapshot. Only `true` has
       * meaning, and only for `decisionTime: "SnapshotRead"` with empty `requirements`,
       * `acceptedCredentials: ["ObjectCapability"]` and `principalKinds: ["CapabilityHolder"]`
       * (ADR 0013); anything else is `EFFX2506`. The annotator never receives it: it is not part of
       * `HttpAccessAnnotationSpec`.
       */
      snapshotDecisionForCommand: A.optional(A.boolean),
    }),
  ],
});

export const HttpGroup = defineBuiltin({
  name: "Http.Group",
  target: "group",
  cardinality: "one",
  args: [
    A.struct({
      root: A.union(
        A.string,
        A.symbol<{ readonly identifier: string }, RootSymbolMarker>({ check: "httpapi-root" }),
      ),
      group: A.string,
      title: A.optional(A.string),
      description: A.optional(A.string),
      displayName: A.optional(A.string),
      defaults: A.optional(
        A.struct({
          middleware: A.optional(securityMarkers),
          metadata: A.optional(A.struct({ annotator: A.optional(callableAnnotator) })),
          problems: A.optional(
            A.struct({
              registry: A.optional(
                A.symbol<ProblemRegistry>({
                  check: "registry",
                }),
              ),
            }),
          ),
          access: A.optional(
            A.struct({
              annotator: A.optional(exportedValue),
              exposure: A.optional(exposure),
              acceptedCredentials: A.optional(names),
              principalKinds: A.optional(principalKinds),
              concealment: A.optional(concealment),
            }),
          ),
        }),
      ),
    }),
  ],
});

/** Builder-only association (`.in(Group)`); consumed by the 0013 pre-pass, never interpreted. */
export const HttpIn = defineBuiltin({
  builder: "in",
  name: "Http.In",
  target: "operation",
  args: [A.symbol<HttpGroupReference>({ check: "exported-group" })],
});

export const FoldkitCommand = defineBuiltin({
  builder: "foldkit.command",
  name: "Foldkit.Command",
  target: "operation",
  cardinality: "one",
  args: { success: A.schema({ taggedMessage: true }), failure: A.schema({ taggedMessage: true }) },
});

export const PersistentModel = defineBuiltin({
  name: "PersistentModel",
  target: "model",
  selfAs: "schema",
  args: {
    table: A.string,
    schema: A.injected(A.schema()),
    views: A.optional(A.record(A.schema())),
    // `Focus.key(...)` lowers to the same string path as a literal array (frontend `runtimeCall`).
    focus: A.optional(A.record(A.sugar(A.array(A.string), A.typed<FocusValue>()))),
  },
});

/** Every built-in definition: the frontend's plan table and builder-step name table derive from this. */
export const all = [
  Query,
  Command,
  Errors,
  Requirements,
  Authorize,
  Rpc,
  Cli,
  HttpGet,
  HttpPost,
  HttpPut,
  HttpPatch,
  HttpDelete,
  HttpContract,
  HttpProblems,
  HttpAccess,
  HttpGroup,
  HttpIn,
  FoldkitCommand,
  PersistentModel,
] as const;
