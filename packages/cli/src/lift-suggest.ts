import { Effect, Option, Result } from "effect";
import { canonical } from "@effx/ir";
import {
  compileCollected,
  dense,
  printSuggestion,
  type Collected,
  type CompilerFault,
  type Extension,
  type LiftResult,
} from "@effx/compiler";

/*
 * The two suggestion forms of the lift command (spec 0019 §4.2 items 1–2). The exact bytes every render
 * surface shares: stdout, `--write`, the `--check` overlay, and `--json`, so no caller can drift from the
 * pure core's own printer. The dense form is offered only after its canonical IR was shown equal to the
 * verbose form's (law L4).
 */

/** The exact per-form suggestion text, straight from the one real printer. */
export const printedSuggestion = (
  collected: Collected,
  module: string,
  codeReferences: LiftResult["codeReferences"],
): Result.Result<string, string> =>
  printSuggestion(collected, { module, codeReferences: [...codeReferences] });

/** The dense rewrite only when the group-default expansion rebuilt the verbose declarations; no proof of IR yet. */
export const denseSuggestion = (collected: Collected): Option.Option<Collected> => dense(collected);

/** The same `Collected` limited to a contract pass: IR does not depend on emit, so no files or inventory run. */
const contractPass = (collected: Collected): Collected =>
  collected.project === undefined
    ? collected
    : { ...collected, project: { ...collected.project, emit: "contract" } };

/** A `Collected` compiled only far enough to read its normalized IR: no files, no inventory, no handlers. */
const irOf = Effect.fnUntraced(function* (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
): Effect.fn.Return<Option.Option<string>, CompilerFault> {
  const compiled = yield* compileCollected(contractPass(collected), extensions);

  return Option.map(compiled.ir.value, canonical);
});

/**
 * The dense rewrite of a verbose lift, offered only when both forms normalize to byte-identical canonical
 * IR. A form whose IR cannot be read, or which differs, is not offered: the verbose form is then the only
 * suggestion.
 */
export const provenDense = Effect.fn("lift.provenDense")(function* (
  verbose: Collected,
  extensions: ReadonlyArray<Extension>,
): Effect.fn.Return<Option.Option<Collected>, CompilerFault> {
  const candidate = denseSuggestion(verbose);

  if (Option.isNone(candidate)) return Option.none();

  const verboseIr = yield* irOf(verbose, extensions);
  const denseIr = yield* irOf(candidate.value, extensions);

  return Option.isSome(verboseIr) && Option.isSome(denseIr) && verboseIr.value === denseIr.value
    ? candidate
    : Option.none();
});
