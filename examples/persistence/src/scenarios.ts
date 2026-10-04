/** @effect-diagnostics unstableApiUsage:off -- EX-0022: spec 0022 pins native Effect SQL/PGlite at this persistence boundary. */
import { assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import type { UsersScenarios } from "../.effx/generated/users-conformance.ts";
import { UsersPort } from "../.effx/generated/users-port.ts";
import { EmailTaken, UserId, UserNotFound } from "@effx-examples/users/schemas";
import { User } from "@effx-examples/users/user";
import { seedUsers } from "./database.ts";
import { alice, bob } from "./fixtures.ts";

const missing = UserId.make("missing");

const changedEmail = "alice+port@example.com";

const changedName = "Alice Updated";

const exoticEmail = "nul\u0000-surrogate\ud800@example.com";

const exoticName = "Name\u0000\ud800";

const exoticMissing = UserId.make("missing\u0000\ud800");

// Authored once and shared by both drivers; cases name real domain outcomes, not adapter internals.
export const sharedUsersScenarios: UsersScenarios<SqlError.SqlError, SqlClient.SqlClient> = {
  seed: seedUsers,
  methods: {
    find: {
      success: [{ name: "finds the seeded user", input: { id: alice.id }, expected: alice }],
      errors: {
        UserNotFound: [
          {
            name: "missing user",
            input: { id: missing },
            expected: new UserNotFound({ id: missing }),
          },
          {
            name: "missing NUL and surrogate id stays a domain failure",
            input: { id: exoticMissing },
            expected: new UserNotFound({ id: exoticMissing }),
          },
        ],
      },
    },
    setEmail: {
      success: [
        {
          name: "changes and returns the email",
          input: { id: alice.id, email: changedEmail },
          expected: new User({ id: alice.id, email: changedEmail, displayName: alice.displayName }),
        },
        {
          name: "setting the same email is idempotent",
          input: { id: alice.id, email: alice.email },
          expected: alice,
        },
        {
          name: "losslessly stores NUL and lone surrogate email",
          input: { id: alice.id, email: exoticEmail },
          expected: new User({ id: alice.id, email: exoticEmail, displayName: alice.displayName }),
        },
      ],
      errors: {
        UserNotFound: [
          {
            name: "cannot change a missing user",
            input: { id: missing, email: changedEmail },
            expected: new UserNotFound({ id: missing }),
          },
        ],
        EmailTaken: [
          {
            name: "unique email conflict stays typed",
            input: { id: alice.id, email: bob.email },
            expected: new EmailTaken({ email: bob.email }),
          },
        ],
      },
    },
    setDisplayName: {
      success: [
        {
          name: "changes and returns the display name",
          input: { id: alice.id, displayName: changedName },
          expected: new User({ id: alice.id, email: alice.email, displayName: changedName }),
        },
        {
          name: "losslessly stores NUL and lone surrogate display name",
          input: { id: alice.id, displayName: exoticName },
          expected: new User({ id: alice.id, email: alice.email, displayName: exoticName }),
        },
      ],
      errors: {
        UserNotFound: [
          {
            name: "cannot rename a missing user",
            input: { id: missing, displayName: changedName },
            expected: new UserNotFound({ id: missing }),
          },
        ],
      },
    },
  },
  sharedTransactions: {
    "setDisplayName+setEmail": [
      {
        name: "both changes commit on one user",
        inputs: [
          { id: alice.id, displayName: changedName },
          { id: alice.id, email: changedEmail },
        ],
        observe: Effect.gen(function* () {
          const users = yield* UsersPort;
          const persisted = yield* users.find({ id: alice.id }).pipe(Effect.orDie);
          assert.deepStrictEqual(
            persisted,
            new User({ id: alice.id, email: changedEmail, displayName: changedName }),
          );
        }),
      },
    ],
  },
};
