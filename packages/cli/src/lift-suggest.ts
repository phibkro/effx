import { Option, Result } from "effect";
import { dense, printSuggestion, type Collected, type LiftResult } from "@effx/compiler";

/*
 * The two suggestion forms of the lift command (spec 0019 §4.2 items 1–2). The exact bytes every render
 * surface shares: stdout, `--write`, the `--check` overlay, and `--json`, so no caller can drift from the
 * pure core's own printer.
 */

/** The exact per-form suggestion text, straight from the one real printer. */
export const printedSuggestion = (
  collected: Collected,
  module: string,
  codeReferences: LiftResult["codeReferences"],
): Result.Result<string, string> =>
  printSuggestion(collected, { module, codeReferences: [...codeReferences] });

/** The dense rewrite only when the canonical-IR equality held (law L4); `None` means no dense form. */
export const denseSuggestion = (collected: Collected): Option.Option<Collected> => dense(collected);
