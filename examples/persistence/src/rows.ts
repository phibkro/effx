import { Effect } from "effect";
import { UserId, UserNotFound } from "@effx-examples/users/schemas";
import { decodeStoredUsers } from "./storage.ts";

export const userFromRows = Effect.fnUntraced(function* (
  rows: ReadonlyArray<unknown>,
  id: typeof UserId.Type,
) {
  // A malformed stored row is an invariant defect, not a domain absence.
  const users = yield* decodeStoredUsers(rows).pipe(Effect.orDie);
  const user = users[0];

  if (user === undefined) return yield* new UserNotFound({ id });

  return user;
});
