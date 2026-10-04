import { Option } from "effect";
import { Contribution, extension, implement } from "@effx/compiler";
import { StableId } from "@effx/ir";
import { persistenceGenerator } from "./generate.ts";
import { portsOf } from "./ports.ts";
import { Port } from "./syntax.ts";

const port = implement(Port, {
  duplicate: { code: "EFFX3403" },
  read: ([data], { ctx }) => {
    const operation = Option.getOrThrow(ctx.operationId);
    const id = StableId.make("ext", `persistence/${StableId.nameOf(operation)}`);

    return Contribution.make(
      [{ _tag: "Extension", id, extension: "persistence", tag: "Port", data }],
      [{ kind: "ExtensionOf", from: id, to: operation, qualifier: "Port" }],
    );
  },
  analyze: (ir, index) => portsOf(ir, index).diagnostics,
  write: persistenceGenerator,
});

/** Register in defineConfig({ extensions: [persistenceExtension] }); core has no persistence dependency. */
export const persistenceExtension = extension("persistence", [port]);
