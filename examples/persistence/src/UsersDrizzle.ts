/** @effect-diagnostics unstableApiUsage:off -- EX-0022: spec 0022 pins native Effect SQL/PGlite at this persistence boundary. */
import { eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-pglite";
import { pgTable, text, unique } from "drizzle-orm/pg-core";
import { Cause, Effect, Layer, Schema } from "effect";
import { SqlError } from "effect/sql";
import { UsersPort } from "../.effx/generated/users-port.ts";
import { ChangeEmailInput, EmailTaken, GetUserInput } from "@effx-examples/users/schemas";
import { userFromRows } from "./rows.ts";
import { SetDisplayNameInput } from "./schemas.ts";
import { encodeDisplayName, encodeEmail, encodeId } from "./storage.ts";

// Hand-owned ORM schema. PgDrizzle uses the same PgliteClient/TransactionConnection as raw SQL.
const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
  },
  (table) => [unique("users_email_key").on(table.email)],
);

const isUniqueViolation = Schema.is(SqlError.UniqueViolation);

/** The pinned stable-Effect patch is required at this foreign ORM boundary.
 * Retire the patch when Drizzle's native Effect adapter supports Effect 4.0.0.
 * Methods never open a runtime or acquire another connection.
 */
export const UsersDrizzle = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* PgDrizzle.makeWithDefaults();

    return Layer.succeed(UsersPort, {
      find: Effect.fn("UsersDrizzle.find")(function* (input: typeof GetUserInput.Type) {
        const id = yield* encodeId(input.id).pipe(Effect.orDie);
        const rows = yield* db.select().from(users).where(eq(users.id, id)).pipe(Effect.orDie);

        return yield* userFromRows(rows, input.id);
      }),
      setEmail: Effect.fn("UsersDrizzle.setEmail")(function* (input: typeof ChangeEmailInput.Type) {
        const id = yield* encodeId(input.id).pipe(Effect.orDie);
        const email = yield* encodeEmail(input.email).pipe(Effect.orDie);

        const rows = yield* db
          .update(users)
          .set({ email })
          .where(eq(users.id, id))
          .returning()
          .pipe(
            Effect.catchTag("EffectDrizzleQueryError", (error) => {
              if (!Cause.isCause(error.cause)) return Effect.die(error);

              if (Cause.hasInterrupts(error.cause)) return Effect.interrupt;

              const sqlError = Cause.squash(error.cause);

              if (
                SqlError.isSqlError(sqlError) &&
                isUniqueViolation(sqlError.reason) &&
                sqlError.reason.constraint === "users_email_key"
              ) {
                return Effect.fail(new EmailTaken({ email: input.email }));
              }

              return Effect.die(error);
            }),
          );

        return yield* userFromRows(rows, input.id);
      }),
      setDisplayName: Effect.fn("UsersDrizzle.setDisplayName")(function* (
        input: typeof SetDisplayNameInput.Type,
      ) {
        const id = yield* encodeId(input.id).pipe(Effect.orDie);
        const displayName = yield* encodeDisplayName(input.displayName).pipe(Effect.orDie);

        const rows = yield* db
          .update(users)
          .set({ displayName })
          .where(eq(users.id, id))
          .returning()
          .pipe(Effect.orDie);

        return yield* userFromRows(rows, input.id);
      }),
    });
  }),
);
