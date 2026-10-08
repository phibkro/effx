import { Schema } from "effect";
import { SymbolRef } from "@effx/ir";
import type { Location } from "../Diagnostic.ts";
import { TermSchema } from "./term-schema.ts";

/*
 * Source coordinates and availability states of the lift model (spec 0019 §3.1). Everything here lives in
 * the lift model and manifest side, never in the IR (ADR 0002/0003, invariant 10): offsets are UTF-16 code
 * unit offsets into the file text exactly as the TypeScript frontend reports them, and line/column are
 * 1-based like `Location`.
 */

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const OneBased = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** A point in a source file: the numeric offset orders and edits; line/col serve diagnostics. */
export const SourcePosition = Schema.Struct({ offset: Offset, line: OneBased, col: OneBased });

export type SourcePosition = typeof SourcePosition.Type;

/** A half-open source range `[start, end)` inside one file. */
export const SourceRange = Schema.Struct({
  file: Schema.String,
  start: SourcePosition,
  end: SourcePosition,
}).check(
  Schema.makeFilter((range) =>
    range.end.offset >= range.start.offset
      ? true
      : "Expected a range whose end does not precede its start",
  ),
);

export type SourceRange = typeof SourceRange.Type;

/** The diagnostic `Location` of a range: its start. */
export const locationOf = (range: SourceRange): Location => ({
  file: range.file,
  line: range.start.line,
  col: range.start.col,
});

/**
 * A path through a `Term` value: the property names and array indices that navigate from the root
 * term to a node (`["args", 1]`, `["calls", 0, "args", 2]`, `["entries", 3, "value"]`).
 */
export const TermPath = Schema.Array(Schema.Union([Schema.String, Schema.Int]));

export type TermPath = typeof TermPath.Type;

/** The source range of one node inside a lowered term. */
export const TermSpan = Schema.Struct({ path: TermPath, range: SourceRange });

export type TermSpan = typeof TermSpan.Type;

/**
 * The closed syntactic reasons the frontend cannot lower a node into a `Term`. The frontend classifies
 * syntax only; the core decides which diagnostic a finding becomes from the semantic position it sits in.
 */
export const FindingKind = Schema.Literals([
  "spread",
  "computed-key",
  "non-literal",
  "local-reference",
  "closure",
  "unresolved",
  "unsupported-syntax",
]);

export type FindingKind = typeof FindingKind.Type;

/**
 * One node the frontend could not lower: its kind, how the source names the construct, and where it is.
 * `enclosingCall` is the callee of the innermost enclosing call whose callee lowered to an exported symbol:
 * a whole call cannot be a term when one argument is unlowerable, and this keeps "a registered helper with a
 * non-literal argument" distinguishable from "an unregistered helper" without ever guessing.
 */
export const Finding = Schema.Struct({
  kind: FindingKind,
  construct: Schema.String,
  range: SourceRange,
  enclosingCall: Schema.optionalKey(Schema.Struct({ callee: SymbolRef })),
});

export type Finding = typeof Finding.Type;

/**
 * One expression position of the model. `Lowered` is complete: every node of `term` was lowered, and `spans`
 * gives the range of nodes the core may need to locate a cause (call nodes, callees and arguments at least;
 * the core falls back to the nearest ancestor span and finally to `range`). `Unlowered` carries no term, only
 * the findings that prevented it, so a partial term is unrepresentable.
 */
export const TermSlot = Schema.TaggedUnion({
  Lowered: { term: TermSchema, range: SourceRange, spans: Schema.Array(TermSpan) },
  Unlowered: { range: SourceRange, findings: Schema.NonEmptyArray(Finding) },
});

export type TermSlot = typeof TermSlot.Type;

const Sha256 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/u, { message: "Expected a lowercase hex SHA-256" }),
);

/** An import binding of a source file: the local name and the symbol it resolves to. */
export const ImportBinding = Schema.Struct({ local: Schema.String, ref: SymbolRef });

export type ImportBinding = typeof ImportBinding.Type;

/**
 * What the core needs to know about one analyzed source file to plan and print edits without reading it:
 * its module and identity path (so planned exports get real `SchemaRef`s), the hash of the analyzed text
 * (provenance for every edit), every exported and top-level name (collision-free naming), its import
 * bindings (file-local names) and where new imports go.
 */
export const SourceFileRecord = Schema.Struct({
  file: Schema.String,
  module: Schema.String,
  idPath: Schema.String,
  sha256: Sha256,
  exports: Schema.Array(Schema.String),
  topLevel: Schema.Array(Schema.String),
  imports: Schema.Array(ImportBinding),
  importsEnd: SourcePosition,
});

export type SourceFileRecord = typeof SourceFileRecord.Type;
