import { Array as Arr, Option, Result } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import type { Diagnostic } from "../Diagnostic.ts";
import { defaultGenerationContext } from "../Extension.ts";
import { Imports } from "../generate/target.ts";
import * as Terms from "../generate/term.ts";
import type { RefLike, Term } from "../generate/term.ts";
import {
  claimName,
  freeName,
  isDeclared,
  plannedSchemaRef,
  plannedSymbolRef,
  reserveName,
  type Context,
} from "./context.ts";
import { isNativeModule } from "./native.ts";
import { refIdentity, sameRef } from "./refs.ts";
import type { NameSource, PlannedExport, Refactor, SourceEdit } from "./result.ts";
import type { ImportBinding, SourceFileRecord, SourcePosition, SourceRange } from "./source.ts";

/*
 * Planning of new exports (spec 0019 §2.3, §4.3). A name comes from `LiftInput.names` when pinned, else it is
 * derived deterministically and made collision-free against everything the target file already declares.
 * Each planned export gets its REAL reference (module and identity path of the file that will hold it), and
 * each refactor is a list of typed edits with offsets into the analyzed text: nothing is a placeholder and
 * nothing is applied here.
 */

/** A planned export: where it will live, its name, where the name came from and the reference it has. */
export interface ExportPlan {
  readonly target: SourceFileRecord;
  readonly name: string;
  readonly source: NameSource;
  readonly ref: SchemaRef | SymbolRef;
}

/** The reference a planned export will have, or why its identity cannot be formed. */
const plannedRef = (
  kind: "schema" | "value",
  file: SourceFileRecord,
  name: string,
): Result.Result<SchemaRef | SymbolRef, string> =>
  kind === "schema" ? plannedSchemaRef(file, name) : Result.succeed(plannedSymbolRef(file, name));

/**
 * Pins win; otherwise `derived` is reserved collision-free in `home`. A failure names why the plan is unusable
 * (an unknown module, a taken name, an identity that cannot be formed) and reserves nothing.
 */
export const planExport = (
  ctx: Context,
  key: string,
  derived: string,
  home: SourceFileRecord,
  kind: "schema" | "value",
): Result.Result<ExportPlan, string> => {
  const pinned = ctx.input.names[key];

  if (pinned === undefined) {
    const name = freeName(ctx, home, derived);
    const ref = plannedRef(kind, home, name);

    if (Result.isFailure(ref)) return Result.fail(ref.failure);

    claimName(ctx, home, name);

    return Result.succeed({ target: home, name, source: "derived", ref: ref.success });
  }

  const target = ctx.filesByModule.get(pinned.module);

  if (target === undefined)
    return Result.fail(`pinned name ${key} resolves to the unknown module ${pinned.module}`);

  if (
    isDeclared(target, pinned.export) ||
    (ctx.taken.get(target.file)?.has(pinned.export) ?? false)
  )
    return Result.fail(`pinned name ${pinned.export} is already declared in ${target.module}`);

  const ref = plannedRef(kind, target, pinned.export);

  if (Result.isFailure(ref)) return Result.fail(ref.failure);

  claimName(ctx, target, pinned.export);

  return Result.succeed({ target, name: pinned.export, source: "names", ref: ref.success });
};

/** Every reference a term names, in print order, without duplicates. */
export const refsOf = (term: Term): ReadonlyArray<RefLike> => {
  const collected = (current: Term): ReadonlyArray<RefLike> => {
    switch (current._tag) {
      case "Lit":
        return [];
      case "Ref":
        return [current.ref];
      case "Call":
        return [...collected(current.callee), ...current.args.flatMap(collected)];
      case "Chain":
        return [
          ...collected(current.head),
          ...current.calls.flatMap((call) => call.args.flatMap(collected)),
        ];
      case "Member":
      case "OptionalMember":
        return collected(current.term);
      case "Nullish":
        return [...collected(current.head), ...current.tail.flatMap(collected)];
      case "StrictEqual":
        return [...collected(current.left), ...collected(current.right)];
      case "Cond":
        return [
          ...collected(current.test),
          ...collected(current.consequent),
          ...collected(current.alternate),
        ];
      case "Paren":
        return collected(current.term);
      case "Obj":
        return current.entries.flatMap((entry) => collected(entry.value));
      case "Arr":
        return current.items.flatMap(collected);
    }
  };

  return collected(term).filter(
    (reference, index, all) => all.findIndex((other) => sameRef(other, reference)) === index,
  );
};

/** The `Schema` namespace reference new code is written against: the generator's own logical reference. */
export const schemaNamespace = (ctx: Context): SymbolRef => ({
  module: Imports({ ...defaultGenerationContext, target: ctx.model.project.target }).core,
  export: "Schema",
});

/** `Schema.Struct(fields)` as a term. */
export const structTerm = (ctx: Context, fields: Term): Term =>
  Terms.call(Terms.member(Terms.ref(schemaNamespace(ctx)), "Struct"), [fields]);

const runtimeBindings = (file: SourceFileRecord): ReadonlyArray<ImportBinding> =>
  file.imports.flatMap((sourceImport) =>
    sourceImport._tag === "Resolved" && sourceImport.kind === "value" ? sourceImport.bindings : [],
  );

const resolvable = (ctx: Context, file: SourceFileRecord, reference: RefLike): boolean =>
  reference.module === file.module ||
  runtimeBindings(file).some(
    (binding) =>
      sameRef(binding.ref, reference) ||
      (reference.export === "Schema" &&
        binding.ref.export === "Schema" &&
        isNativeModule(ctx.model.project.target, "Schema", binding.ref.module) &&
        isNativeModule(ctx.model.project.target, "Schema", reference.module)),
  );

/** Import edits for every reference of `terms` that `file` cannot already name; each local is collision-free. */
const importEdits = (
  ctx: Context,
  file: SourceFileRecord,
  terms: ReadonlyArray<Term>,
  skip: ReadonlyArray<RefLike>,
): ReadonlyArray<SourceEdit> =>
  Arr.dedupeWith(terms.flatMap(refsOf), sameRef).flatMap((reference): ReadonlyArray<SourceEdit> =>
    resolvable(ctx, file, reference) || skip.some((other) => sameRef(other, reference))
      ? []
      : [
          {
            _tag: "InsertImport",
            at: file.importsEnd,
            ref: reference,
            local: reserveName(ctx, file, reference.export),
          },
        ],
  );

/** One export of a refactor: the inline expression it replaces and what the new export holds. */
export interface ExportRefactor {
  readonly code: Refactor["code"];
  readonly subject: string;
  readonly cause: Diagnostic;
  readonly key: string;
  readonly role: PlannedExport["role"];
  /** The file holding the inline expression, its statement start and the exact range being replaced. */
  readonly use: SourceFileRecord;
  readonly anchor: SourcePosition;
  readonly replace: SourceRange;
  readonly plan: ExportPlan;
  readonly initializer: Term;
  readonly asConst: boolean;
}

interface ExportPlacementFailure {
  readonly at: SourceRange;
  readonly reason: string;
}

/** Every edge in this walk is a recorded runtime value import. Type-only imports never enter it. */
const crossFileExportAnchor = (
  ctx: Context,
  input: ExportRefactor,
): Result.Result<SourcePosition, ExportPlacementFailure> => {
  const target = input.plan.target;

  if (target.file === input.use.file) return Result.succeed(input.anchor);

  if (target.module === input.use.module)
    return Result.fail({
      at: input.replace,
      reason:
        "two source files share one module identity, so the cross-file refactor location is ambiguous",
    });

  if (target.end.offset < target.importsEnd.offset)
    return Result.fail({
      at: input.replace,
      reason: "the target source end precedes its imports",
    });

  const modules = Imports({ ...defaultGenerationContext, target: ctx.model.project.target });

  const isUnder = (module: string, root: string): boolean =>
    module === root || (module.startsWith(root) && module.charAt(root.length) === "/");

  const nativeModule = (module: string): boolean =>
    isUnder(module, modules.core) ||
    isUnder(module, modules.http) ||
    isUnder(module, modules.httpApi) ||
    isUnder(module, modules.net) ||
    isUnder(module, modules.rpc) ||
    isUnder(module, modules.cli) ||
    isUnder(module, modules.sql);

  const additional = refsOf(input.initializer)
    .filter((reference) => !resolvable(ctx, target, reference))
    .map((reference) => reference.module);

  const visited = new Set<string>();

  const reachesUse = (
    module: string,
    at: SourceRange,
  ): Result.Result<boolean, ExportPlacementFailure> => {
    if (module === input.use.module) return Result.succeed(true);

    if (visited.has(module)) return Result.succeed(false);

    visited.add(module);
    const file = ctx.filesByModule.get(module);

    if (file === undefined)
      return nativeModule(module)
        ? Result.succeed(false)
        : Result.fail({
            at,
            reason:
              "source module " + module + " is not available to prove the cross-file import path",
          });

    const edges: Array<{ readonly module: string; readonly at: SourceRange }> = [];

    for (const sourceImport of file.imports) {
      if (sourceImport._tag === "Unresolved") {
        if (sourceImport.kind !== "type")
          return Result.fail({
            at: sourceImport.range,
            reason: "an unresolved runtime import prevents proof of a safe cross-file refactor",
          });

        continue;
      }

      if (sourceImport.kind === "value")
        edges.push({ module: sourceImport.module, at: sourceImport.range });
    }

    if (file.file === target.file)
      edges.push(...additional.map((dependency) => ({ module: dependency, at: input.replace })));

    for (const edge of edges) {
      const reachable = reachesUse(edge.module, edge.at);

      if (Result.isFailure(reachable)) return reachable;

      if (reachable.success) return Result.succeed(true);
    }

    return Result.succeed(false);
  };

  const safe = reachesUse(target.module, input.replace);

  if (Result.isFailure(safe)) return Result.fail(safe.failure);

  return safe.success
    ? Result.fail({
        at: input.replace,
        reason: "the planned use import would create a runtime module cycle",
      })
    : Result.succeed(target.end);
};

const refactorOf = (
  input: ExportRefactor,
  file: SourceFileRecord,
  edits: ReadonlyArray<SourceEdit>,
  planned: ReadonlyArray<PlannedExport>,
): Option.Option<Refactor> =>
  Arr.matchLeft(edits, {
    onEmpty: () => Option.none(),
    onNonEmpty: (head, tail) =>
      Option.some({
        code: input.code,
        subject: input.subject,
        file: file.file,
        sourceSha256: file.sha256,
        cause: input.cause,
        edits: [head, ...tail],
        planned,
      }),
  });

/**
 * The refactors for one planned export. When the export lives in the file that holds the inline expression,
 * one refactor inserts and replaces; otherwise the target file gets the export and the using file the import
 * and the replacement.
 */
export const exportRefactors = (
  ctx: Context,
  input: ExportRefactor,
): Result.Result<ReadonlyArray<Refactor>, ExportPlacementFailure> => {
  const planned: PlannedExport = {
    key: input.key,
    role: input.role,
    name: input.plan.name,
    source: input.plan.source,
    ref: input.plan.ref,
  };

  const sameFile = input.plan.target.file === input.use.file;
  const at = sameFile ? Result.succeed(input.anchor) : crossFileExportAnchor(ctx, input);

  if (Result.isFailure(at)) return Result.fail(at.failure);

  const exportEdit: SourceEdit = {
    _tag: "InsertExport",
    at: at.success,
    name: input.plan.name,
    initializer: input.initializer,
    asConst: input.asConst,
  };

  const replaceEdit: SourceEdit = {
    _tag: "Replace",
    range: input.replace,
    replacement: Terms.ref(input.plan.ref),
  };

  const targetImports = importEdits(ctx, input.plan.target, [input.initializer], []);
  const useImports = sameFile ? [] : importEdits(ctx, input.use, [Terms.ref(input.plan.ref)], []);
  const targetEdits = [...targetImports, exportEdit, ...(sameFile ? [replaceEdit] : [])];
  const useEdits = sameFile ? [] : [...useImports, replaceEdit];

  return Result.succeed([
    ...Option.toArray(refactorOf(input, input.plan.target, targetEdits, [planned])),
    ...Option.toArray(refactorOf(input, input.use, useEdits, [])),
  ]);
};

/** Whether a reference is already named in a file by a runtime value binding. */
export const namedIn = (file: SourceFileRecord, reference: RefLike): Option.Option<string> => {
  if (reference.module === file.module) return Option.some(reference.export);

  const binding = runtimeBindings(file).find(
    (entry) => refIdentity(entry.ref) === refIdentity(reference),
  );

  return Option.fromUndefinedOr(binding?.local);
};
