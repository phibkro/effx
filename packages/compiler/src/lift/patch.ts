import { Array as Arr, Crypto, Effect, Order, Result } from "effect";
import { Hex } from "effect/encoding";
import { CompilerFault } from "../CompilerFault.ts";
import { printTerm, refKey, type NameOf, type RefLike, type Term } from "../generate/term.ts";
import { unifiedDiff } from "./diff.ts";
import { symbolRefOf } from "./refs.ts";
import { relativeModule } from "./relative.ts";
import type { Refactor, SourceEdit } from "./result.ts";
import type { SourceFileRecord } from "./source.ts";

/*
 * Refactors as patches (spec 0019 §4.1, §4.3). A `Refactor` is typed data with offsets into the exact text
 * whose SHA-256 it records. This renderer is the only place those edits become text, and it never applies
 * them: it verifies the hash of every file it is given, resolves each reference against the file's own
 * imports and the imports the refactor adds, and prints a unified diff. A file that changed since analysis
 * is a fault, because applying offsets to different text would corrupt it.
 */

export interface PatchInput {
  readonly refactors: ReadonlyArray<Refactor>;
  /** Every analyzed file the refactors touch, as the model recorded it. */
  readonly files: ReadonlyArray<SourceFileRecord>;
  /** The exact analyzed text of each file, by `SourceFileRecord.file`. */
  readonly texts: ReadonlyMap<string, string>;
  /** Whether new relative imports end in `.ts` (otherwise `.js`), as in the project's generated imports. */
  readonly allowImportingTsExtensions: boolean;
}

type InsertImport = Extract<SourceEdit, { readonly _tag: "InsertImport" }>;

interface Splice {
  readonly at: number;
  readonly end: number;
  readonly insert: string;
  /** Imports sort before exports before replacements at one offset. */
  readonly rank: number;
  readonly index: number;
}

const bySplice = Order.combine(
  Order.mapInput(Order.Number, (splice: Splice) => splice.at),
  Order.combine(
    Order.mapInput(Order.Number, (splice: Splice) => splice.rank),
    Order.mapInput(Order.Number, (splice: Splice) => splice.index),
  ),
);

const fault = (message: string): CompilerFault => new CompilerFault({ stage: "lift", message });

/** A statement inserted at `at`: whole lines at a line start, otherwise on new lines after the line. */
const placed = (text: string, at: number, statement: string, blankLine: boolean): string => {
  const atLineStart = at === 0 || text[at - 1] === "\n";
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const blank = blankLine ? newline : "";
  const rendered = statement.replace(/\n/gu, newline);

  return atLineStart ? `${rendered}${newline}${blank}` : `${newline}${blank}${rendered}`;
};

const importText = (
  file: SourceFileRecord,
  edit: InsertImport,
  extension: string,
): Result.Result<string, string> => {
  const symbol = symbolRefOf(edit.ref);
  const specifier = relativeModule(file.module, symbol.module);

  if (Result.isFailure(specifier)) return Result.fail(specifier.failure);

  const suffixed = /^\.\.?\//u.test(specifier.success)
    ? `${specifier.success}${extension}`
    : specifier.success;

  const binding =
    edit.local === symbol.export ? symbol.export : `${symbol.export} as ${edit.local}`;

  return Result.succeed(`import { ${binding} } from ${JSON.stringify(suffixed)};`);
};

interface FileEdits {
  readonly file: SourceFileRecord;
  readonly text: string;
  readonly refactors: ReadonlyArray<Refactor>;
}

const splicesOf = (
  input: PatchInput,
  target: FileEdits,
  problems: Array<string>,
): ReadonlyArray<Splice> => {
  const { file, text } = target;
  const extension = input.allowImportingTsExtensions ? ".ts" : ".js";
  const edits = target.refactors.flatMap((refactor) => refactor.edits);
  const inserts = edits.filter((edit): edit is InsertImport => edit._tag === "InsertImport");

  const locals = new Map<string, string>([
    ...file.imports.map((binding) => [refKey(binding.ref), binding.local] as const),
    ...inserts.map((edit) => [refKey(edit.ref), edit.local] as const),
  ]);

  const names: NameOf = (reference: RefLike) => {
    const symbol = symbolRefOf(reference);
    const member = symbol.member === undefined ? "" : `.${symbol.member}`;

    if (symbol.module === file.module) return `${symbol.export}${member}`;

    const local = locals.get(refKey(reference));

    if (local === undefined) {
      problems.push(`${file.file}: ${symbol.export} has no import in the file or in the refactor`);

      return symbol.export;
    }

    return `${local}${member}`;
  };

  const print = (term: Term): string => printTerm(names, term);

  return edits.flatMap((edit, index): ReadonlyArray<Splice> => {
    if (edit._tag === "Replace") {
      const start = edit.range.start.offset;
      const end = edit.range.end.offset;

      if (end > text.length) {
        problems.push(`${file.file}: a replaced range ends beyond the analyzed text`);

        return [];
      }

      return [{ at: start, end, insert: print(edit.replacement), rank: 2, index }];
    }

    const at = edit.at.offset;

    if (at > text.length) {
      problems.push(`${file.file}: an insertion point lies beyond the analyzed text`);

      return [];
    }

    if (edit._tag === "InsertExport") {
      const suffix = edit.asConst ? " as const" : "";
      const statement = `export const ${edit.name} = ${print(edit.initializer)}${suffix};`;

      return [{ at, end: at, insert: placed(text, at, statement, true), rank: 1, index }];
    }

    const statement = importText(file, edit, extension);

    if (Result.isFailure(statement)) {
      problems.push(statement.failure);

      return [];
    }

    return [{ at, end: at, insert: placed(text, at, statement.success, false), rank: 0, index }];
  });
};

const applied = (text: string, splices: ReadonlyArray<Splice>): Result.Result<string, string> => {
  const ordered = splices.toSorted(bySplice);
  let output = "";
  let cursor = 0;

  for (const splice of ordered) {
    if (splice.at < cursor) return Result.fail(`edits overlap at offset ${splice.at}`);

    output += text.slice(cursor, splice.at) + splice.insert;
    cursor = splice.end;
  }

  return Result.succeed(output + text.slice(cursor));
};

const utf8 = new TextEncoder();

/** Verifies that the text is the one the refactors were planned against. */
const verified = Effect.fn("verifyAnalyzedText")(function* (target: FileEdits) {
  const crypto = yield* Crypto.Crypto;

  const digest = yield* crypto
    .digest("SHA-256", utf8.encode(target.text))
    .pipe(
      Effect.mapError(
        (cause) =>
          new CompilerFault({ stage: "lift", message: `cannot hash ${target.file.file}`, cause }),
      ),
    );

  const actual = Hex.encode(digest);

  const stale = target.refactors.find((refactor) => refactor.sourceSha256 !== actual);

  if (stale !== undefined)
    return yield* fault(
      `${target.file.file} changed after it was analyzed (${stale.sourceSha256} was planned, ${actual} was read)`,
    );
});

/**
 * The unified diff of every refactor, or a `CompilerFault` when a file is missing, changed since analysis or
 * its edits cannot be placed. An empty refactor list is the empty patch.
 */
export const renderPatch = Effect.fn("renderPatch")(function* (input: PatchInput) {
  const byFile = Arr.groupBy(input.refactors, (refactor) => refactor.file);
  const diffs: Array<string> = [];

  for (const [path, refactors] of Object.entries(byFile).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const file = input.files.find((candidate) => candidate.file === path);
    const text = input.texts.get(path);

    if (file === undefined || text === undefined)
      return yield* fault(`${path}: the analyzed file or its text is not available`);

    const target: FileEdits = { file, text, refactors };

    yield* verified(target);

    const problems: Array<string> = [];
    const after = applied(text, splicesOf(input, target, problems));

    if (problems.length > 0) return yield* fault(Array.from(new Set(problems)).join("; "));

    if (Result.isFailure(after)) return yield* fault(`${path}: ${after.failure}`);

    diffs.push(unifiedDiff(path, text, after.success));
  }

  return diffs.filter((diff) => diff !== "").join("\n") + (diffs.length === 0 ? "" : "\n");
});
