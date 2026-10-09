import { Context, Effect } from "effect";
import type { SchoolsFailure } from "./errors.js";
import type { SchoolDirectory, SchoolDirectoryListInput } from "./schema.js";
import type { PersonId } from "../organization/schema.js";
import type {
  SchoolCommand,
  SchoolCommandResult,
  SchoolManagement,
  SchoolCommandFailure,
} from "./administration.js";

export interface SchoolsOperations {
  readonly readManagement: (
    personId: PersonId,
  ) => Effect.Effect<SchoolManagement, SchoolsFailure | SchoolCommandFailure>;
  readonly authorizeCommand: (
    command: SchoolCommand,
    personId: PersonId,
  ) => Effect.Effect<void, SchoolsFailure | SchoolCommandFailure>;
  readonly executeCommand: (
    command: SchoolCommand,
    personId: PersonId,
  ) => Effect.Effect<SchoolCommandResult, SchoolsFailure | SchoolCommandFailure>;
  readonly listDirectory: (
    input: SchoolDirectoryListInput,
  ) => Effect.Effect<SchoolDirectory, SchoolsFailure>;
}

export class Schools extends Context.Service<Schools, SchoolsOperations>()(
  "@vektorprogrammet/domain/Schools",
) {}
