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

  const entries = site.value.entries;
  const count = (name: string) => entries.filter((entry) => entry.key === name).length;

  const integer = (name: string) => {
    const value = entries.find((entry) => entry.key === name)?.value;

    return value?._tag === "Lit" && Predicate.isNumber(value.json) && Number.isInteger(value.json)
      ? value.json
      : undefined;
  };

  const perMinute = integer("perMinute");
  const burst = integer("burst");
  const burstCount = count("burst");

  if (
    perMinute === undefined ||
    count("perMinute") !== 1 ||
    burstCount > 1 ||
    (burstCount === 1 && burst === undefined) ||
    entries.some((entry) => entry.key !== "perMinute" && entry.key !== "burst")
  )
    return Result.fail({ _tag: "Unsupported", construct: "a literal RateLimit object" });

  const args = burst === undefined ? { perMinute } : { perMinute, burst };

  return Result.succeed([args]);
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
