import type { Extension } from "../Extension.ts";
import { cliGenerator } from "../generate/cli.ts";
import { cliInterpreters } from "./transports.ts";

/** `@Cli` → `Exposure{cli}`; generates `cli.ts` (`effect/cli` `Command`). */
export const cli: Extension = {
  name: "cli",
  interpreters: cliInterpreters,
  analyses: [],
  generators: [cliGenerator],
};
