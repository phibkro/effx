import { extension } from "../annotation.ts";
import type { Extension } from "../Extension.ts";
import { cliGenerator } from "../generate/cli.ts";
import { cliImplementations } from "./transports.ts";

/** `@Cli` → `Exposure{cli}`; generates `cli.ts` (`effect/cli` `Command`). */
export const cli: Extension = extension("cli", cliImplementations, { generators: [cliGenerator] });
