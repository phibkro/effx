/**
 * @title Giving a declared annotation meaning
 *
 * `implement` is the compiler half. With no `read` it records the arguments as a declarative
 * `Extension` node `ext:<name>/<operation>` linked by `ExtensionOf`; analyses and generators add
 * checks and files. `extension` bundles implementations into an ordinary `Extension`, the value
 * you list in `effx.config.ts`.
 */
import { dataOf, error, extension, implement, warning } from "@effx/compiler";
import { IRGraph } from "@effx/ir";
import { Option } from "effect";
import { RateLimit } from "./03_define-annotation.ts";

const rateLimit = implement(RateLimit, {
  // Analyses read the normalized IR and return diagnostics (data, not failures).
  analyze: (ir, index) =>
    ir.nodes.flatMap((node) => {
      if (node._tag !== "Operation") return [];

      // `dataOf` decodes the declarative node with the same schema the compiler derived from `args`.
      const limit = dataOf(RateLimit, ir, node.id);

      if (Option.isNone(limit)) return [];

      const [options] = limit.value;

      const exposed = IRGraph.outgoing(index, node.id, "ExposedAs").some(
        (edge) => edge.qualifier === "http",
      );

      if (!exposed) {
        return [error("EFFX9101", `${node.name}: @RateLimit needs an HTTP exposure`)];
      }

      return options.perMinute > 10_000
        ? [
            warning(
              "EFFX9102",
              `${node.name}: perMinute ${options.perMinute} is effectively unlimited`,
            ),
          ]
        : [];
    }),
});

// An ordinary `Extension`. List it in `effx.config.ts`: the CLI compiles with the built-ins
// followed by the config's extensions (spec 0015), and lowers `@RateLimit(...)` by the plan of
// the definition it carries (spec 0020).
export const appExtension = extension("app", [rateLimit]);
