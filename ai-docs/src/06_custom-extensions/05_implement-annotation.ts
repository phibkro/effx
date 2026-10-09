/**
 * @title Giving a declared annotation meaning
 *
 * `implement` is the compiler half. With no `read` it records the arguments as a declarative
 * `Extension` node `ext:<name>/<operation>` linked by `ExtensionOf`; analyses and generators add
 * checks and files. `extension` bundles implementations into an ordinary `Extension`, the value
 * you list in `effx.config.ts`.
 *
 * An optional `lift.recognize` is a pure, synchronous inverse of a source `.annotate` site. It reads
 * the frontend's neutral Term, returns typed `ReadArgs<D>`, and reports a non-match with a closed error;
 * the core validates the result with the definition's own cached plan codec. Pass the selected
 * extension registry explicitly to `lift(model, input, registry)`.
 */
import {
  CoreDiagnostics,
  type DefinitionLift,
  type Diagnostic,
  dataOf,
  extension,
  implement,
} from "@effx/compiler";
import { IRGraph } from "@effx/ir";
import { Option, Predicate, Result } from "effect";
import { RateLimit } from "./03_define-annotation.ts";

const recognizeRateLimit: DefinitionLift<typeof RateLimit>["recognize"] = (site) => {
  if (site.value._tag !== "Obj")
    return Result.fail({ _tag: "Unsupported", construct: "a literal RateLimit object" });

  const perMinute = site.value.entries.find((entry) => entry.key === "perMinute")?.value;

  if (
    perMinute?._tag !== "Lit" ||
    !Predicate.isNumber(perMinute.json) ||
    !Number.isInteger(perMinute.json)
  )
    return Result.fail({ _tag: "Unsupported", construct: "an integer perMinute field" });

  return Result.succeed([{ perMinute: perMinute.json }]);
};

const rateLimit = implement(RateLimit, {
  lift: { recognize: recognizeRateLimit },
  // Analyses read the normalized IR and return diagnostics (data, not failures).
  analyze: (ir, index) =>
    ir.nodes.flatMap((node): ReadonlyArray<Diagnostic> => {
      if (node._tag !== "Operation") return [];

      // `dataOf` decodes the declarative node with the same schema the compiler derived from `args`.
      const limit = dataOf(RateLimit, ir, node.id);

      if (Option.isNone(limit)) return [];

      const [options] = limit.value;

      const exposed = IRGraph.outgoing(index, node.id, "ExposedAs").some(
        (edge) => edge.qualifier === "http",
      );

      if (!exposed) {
        return [CoreDiagnostics["EFFX9101"].emit({ subject: node.name })];
      }

      return options.perMinute > 10_000
        ? [CoreDiagnostics["EFFX9102"].emit({ subject: node.name, perMinute: options.perMinute })]
        : [];
    }),
});

// An ordinary `Extension`. List it in `effx.config.ts`: the CLI compiles with the built-ins
// followed by the config's extensions (spec 0015), and lowers `@RateLimit(...)` by the plan of
// the definition it carries (spec 0020).
export const appExtension = extension("app", [rateLimit]);
