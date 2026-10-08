import { Array as Arr, Option, Result } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import type { Diagnostic } from "../Diagnostic.ts";
import { defaultGenerationContext } from "../Extension.ts";
import { Imports } from "../generate/target.ts";
import * as Terms from "../generate/term.ts";
import type { RefLike, Term } from "../generate/term.ts";
import {
  isDeclared,
  plannedSchemaRef,
  plannedSymbolRef,
  reserveName,
  type Context,
} from "./context.ts";
import { isNativeModule } from "./native.ts";
import { refIdentity, sameRef } from "./refs.ts";
import type { NameSource, PlannedExport, Refactor, SourceEdit } from "./result.ts";
import type { SourceFileRecord, SourcePosition, SourceRange } from "./source.ts";

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

/** Pins win; otherwise `derived` is reserved collision-free in `home`. A failure names why a pin is unusable. */
export const planExport = (
  ctx: Context,
  key: string,
  derived: string,
  home: SourceFileRecord,
  kind: "schema" | "value",
): Result.Result<ExportPlan, string> => {
  const pinned = ctx.input.names[key];

  if (pinned === undefined) {
    const name = reserveName(ctx, home, derived);

    return Result.succeed({
      target: home,
      name,
      source: "derived",
      ref: kind === "schema" ? plannedSchemaRef(home, name) : plannedSymbolRef(home, name),
    });
  }

  const target = ctx.filesByModule.get(pinned.module);

  if (target === undefined)
    return Result.fail(`pinned name ${key} resolves to the unknown module ${pinned.module}`);

  if (
    isDeclared(target, pinned.export) ||
    (ctx.taken.get(target.file)?.has(pinned.export) ?? false)
  )
    return Result.fail(`pinned name ${pinned.export} is already declared in ${target.module}`);

  ctx.taken.set(target.file, new Set([...(ctx.taken.get(target.file) ?? []), pinned.export]));

  return Result.succeed({
    target,
    name: pinned.export,
    source: "names",
    ref:
      kind === "schema"
        ? plannedSchemaRef(target, pinned.export)
        : plannedSymbolRef(target, pinned.export),
  });
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
  module: Imports({ ...defaultGenerationContext, target: ctx.model.target }).core,
  export: "Schema",
});

/** `Schema.Struct(fields)` as a term. */
export const structTerm = (ctx: Context, fields: Term): Term =>
  Terms.call(Terms.member(Terms.ref(schemaNamespace(ctx)), "Struct"), [fields]);

const resolvable = (ctx: Context, file: SourceFileRecord, reference: RefLike): boolean =>
  reference.module === file.module ||
  file.imports.some(
    (binding) =>
      sameRef(binding.ref, reference) ||
      (reference.export === "Schema" &&
        binding.ref.export === "Schema" &&
        isNativeModule(ctx.model.target, "Schema", binding.ref.module) &&
        isNativeModule(ctx.model.target, "Schema", reference.module)),
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
export const exportRefactors = (ctx: Context, input: ExportRefactor): ReadonlyArray<Refactor> => {
  const planned: PlannedExport = {
    key: input.key,
    role: input.role,
    name: input.plan.name,
    source: input.plan.source,
    ref: input.plan.ref,
  };

  const sameFile = input.plan.target.file === input.use.file;

  const exportEdit: SourceEdit = {
    _tag: "InsertExport",
    at: sameFile ? input.anchor : input.plan.target.importsEnd,
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

  return [
    ...Option.toArray(refactorOf(input, input.plan.target, targetEdits, [planned])),
    ...Option.toArray(refactorOf(input, input.use, useEdits, [])),
  ];
};

/** Whether a reference is already named in a file; exported for the patch renderer's own resolution. */
export const namedIn = (file: SourceFileRecord, reference: RefLike): Option.Option<string> =>
  reference.module === file.module
    ? Option.some(reference.export)
    : Option.map(
        Option.fromUndefinedOr(
          file.imports.find((binding) => refIdentity(binding.ref) === refIdentity(reference)),
        ),
        (binding) => binding.local,
      );
