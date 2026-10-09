import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import { Collected } from "../Collected.ts";
import { Diagnostic } from "../Diagnostic.ts";
import { UnsupportedSite } from "./causes.ts";
import { HandlerSource } from "./model.ts";
import { SourcePosition, SourceRange } from "./source.ts";
import { TermSchema } from "./term-schema.ts";

/*
 * What the pure core returns (spec 0019 §3.1, §4.2, §4.3). Everything an unsupported or refactored
 * declaration needs is data with real coordinates: the CLI renders and never invents AST information.
 */

/** A reference a planned export will have once its edit is applied: a real ref, never a placeholder. */
const PlannedRef = Schema.Union([SchemaRef, SymbolRef]);

/** Where a planned or derived export name came from. */
export const NameSource = Schema.Literals(["names", "derived"]);

export type NameSource = typeof NameSource.Type;

/**
 * One typed edit of one source file, with the coordinates and initializer data the CLI needs. Positions are
 * offsets into the exact text whose hash the owning refactor records. Terms are printed against the file's
 * own import bindings by the patch renderer; nothing here is a source string built from unknown payload.
 */
export const SourceEdit = Schema.TaggedUnion({
  InsertExport: {
    at: SourcePosition,
    name: Schema.String,
    initializer: TermSchema,
    asConst: Schema.Boolean,
  },
  InsertImport: { at: SourcePosition, ref: PlannedRef, local: Schema.String },
  Replace: { range: SourceRange, replacement: TermSchema },
});

export type SourceEdit = typeof SourceEdit.Type;

/**
 * One export a refactor introduces and the real reference the suggestion uses for it. `key` is the key of
 * `LiftInput.names` it answers to (`<group>.<endpointKey>#<role>`, `<module>#<export>#codes` or
 * `<module>#<export>#headers`), so a pinned name and a derived name are told apart by `source` alone.
 */
export const PlannedExport = Schema.Struct({
  key: Schema.String,
  role: Schema.Literals([
    "params",
    "query",
    "headers",
    "payload",
    "success",
    "codes",
    "responseHeaders",
  ]),
  name: Schema.String,
  source: NameSource,
  ref: PlannedRef,
});

export type PlannedExport = typeof PlannedExport.Type;

/**
 * A wire-preserving source refactor (EFFX3002-3004): the registered diagnostic that explains it, the file it
 * edits with the hash of the analyzed text, its typed edits and the exports it plans. The compiler never
 * applies it.
 */
export const Refactor = Schema.Struct({
  code: Schema.Literals(["EFFX3002", "EFFX3003", "EFFX3004"]),
  subject: Schema.String,
  file: Schema.String,
  sourceSha256: Schema.String,
  cause: Diagnostic,
  edits: Schema.NonEmptyArray(SourceEdit),
  planned: Schema.Array(PlannedExport),
});

export type Refactor = typeof Refactor.Type;

/** A semantic fact of the lift with no Effect twin, printed for review and never reported as verified. */
export const Decision = Schema.TaggedUnion({
  OperationKind: {
    subject: Schema.String,
    kind: Schema.Literals(["Query", "Command"]),
    method: Schema.String,
  },
  OperationInput: {
    subject: Schema.String,
    channel: Schema.Literals(["payload", "query", "headers", "params", "emptyInput"]),
    schema: SchemaRef,
    others: Schema.Array(Schema.String),
  },
  ExportName: {
    subject: Schema.String,
    role: Schema.String,
    name: Schema.String,
    source: NameSource,
    module: Schema.String,
  },
});

export type Decision = typeof Decision.Type;

/** A symbol a lifter rule names that does not resolve in the analyzed project. */
export const AdapterPrerequisite = Schema.Struct({
  rule: Schema.String,
  role: Schema.String,
  ref: SymbolRef,
});

export type AdapterPrerequisite = typeof AdapterPrerequisite.Type;

/**
 * The key-set comparison of an application binding with its group, and what the registrations resolve to.
 * Verification is always `UNVERIFIED` here: only the real binding typecheck can verify it.
 */
export const BindingReport = Schema.Struct({
  group: Schema.String,
  declared: Schema.Array(Schema.String),
  bound: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.String),
  extra: Schema.Array(Schema.String),
  registrations: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      kind: Schema.Literals(["raw", "normal"]),
      handler: HandlerSource,
    }),
  ),
  authorizeCalls: Schema.Array(SourceRange),
  verification: Schema.Literal("UNVERIFIED"),
});

export type BindingReport = typeof BindingReport.Type;

/** An exported tuple associated with its exact problem identifier and literal codes, never by name alone. */
export const CodeReference = Schema.Struct({
  identifier: Schema.String,
  codes: Schema.Array(Schema.String),
  ref: SymbolRef,
});

export type CodeReference = typeof CodeReference.Type;

/** The complete outcome of lifting one group. Lifting never throws; every problem is a diagnostic here. */
export const LiftResult = Schema.Struct({
  group: Schema.String,
  collected: Collected,
  refactors: Schema.Array(Refactor),
  decisions: Schema.Array(Decision),
  unsupported: Schema.Array(UnsupportedSite),
  adapterPrerequisites: Schema.Array(AdapterPrerequisite),
  codeReferences: Schema.Array(CodeReference),
  bindings: Schema.Array(BindingReport),
  diagnostics: Schema.Array(Diagnostic),
});

export type LiftResult = typeof LiftResult.Type;
