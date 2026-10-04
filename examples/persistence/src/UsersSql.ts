/** @effect-diagnostics unstableApiUsage:off -- EX-0022: spec 0022 pins native Effect SQL/PGlite at this persistence boundary. */
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { UsersPort } from "../.effx/generated/users-port.ts";
import { ChangeEmailInput, EmailTaken, GetUserInput } from "@effx-examples/users/schemas";
import { userFromRows } from "./rows.ts";
import { SetDisplayNameInput } from "./schemas.ts";
import { encodeDisplayName, encodeEmail, encodeId } from "./storage.ts";

/** Commands join the caller's ambient SqlClient transaction; otherwise the statement commits.
 * Unexpected SQL failures are defects; only the users_email_key conflict is EmailTaken.
 */
export const UsersSql = Layer.unwrap(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return Layer.succeed(UsersPort, {
      find: Effect.fn("UsersSql.find")(function* (input: typeof GetUserInput.Type) {
        const id = yield* encodeId(input.id).pipe(Effect.orDie);

        const rows =
          yield* sql`SELECT id, email, display_name AS "displayName" FROM users WHERE id = ${id}`.pipe(
            Effect.orDie,
          );

        return yield* userFromRows(rows, input.id);
      }),
      setEmail: Effect.fn("UsersSql.setEmail")(function* (input: typeof ChangeEmailInput.Type) {
        const id = yield* encodeId(input.id).pipe(Effect.orDie);
        const email = yield* encodeEmail(input.email).pipe(Effect.orDie);

        const rows = yield* sql`UPDATE users SET email = ${email} WHERE id = ${id}
        RETURNING id, email, display_name AS "displayName"`.pipe(
          Effect.catchReason("SqlError", "UniqueViolation", (reason) =>
            reason.constraint === "users_email_key"
              ? Effect.fail(new EmailTaken({ email: input.email }))
              : Effect.die(reason),
          ),
          Effect.catchTag("SqlError", Effect.die),
        );

        return yield* userFromRows(rows, input.id);
      }),
      setDisplayName: Effect.fn("UsersSql.setDisplayName")(function* (
        input: typeof SetDisplayNameInput.Type,
      ) {
        const id = yield* encodeId(input.id).pipe(Effect.orDie);
        const displayName = yield* encodeDisplayName(input.displayName).pipe(Effect.orDie);

        const rows = yield* sql`UPDATE users SET display_name = ${displayName} WHERE id = ${id}
        RETURNING id, email, display_name AS "displayName"`.pipe(Effect.orDie);

        return yield* userFromRows(rows, input.id);
      }),
    });
  }),
);
