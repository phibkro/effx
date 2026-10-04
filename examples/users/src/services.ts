import { Context, Effect, HashMap, Layer, Option, Ref, Result } from "effect";
import { Email, EmailTaken, UserId, UserNotFound } from "./schemas.ts";
import { User } from "./user.ts";

/** An in-process example store. Successful writes are visible to this layer's readers, but are not durable across restarts. */
export class Users extends Context.Service<
  Users,
  {
    readonly find: (id: typeof UserId.Type) => Effect.Effect<User, UserNotFound>;
    readonly setEmail: (
      id: typeof UserId.Type,
      email: typeof Email.Type,
    ) => Effect.Effect<User, UserNotFound | EmailTaken>;
  }
>()("@effx-examples/users/src/services/Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const alice = new User({
        id: UserId.make("1"),
        email: "alice@example.com",
        displayName: "Alice",
      });

      const bob = new User({ id: UserId.make("2"), email: "bob@example.com", displayName: "Bob" });

      const users = yield* Ref.make<HashMap.HashMap<typeof UserId.Type, User>>(
        HashMap.make([alice.id, alice], [bob.id, bob]),
      );

      const find = Effect.fn("Users.find")(function* (id: typeof UserId.Type) {
        const user = HashMap.get(yield* Ref.get(users), id);

        if (Option.isNone(user)) return yield* new UserNotFound({ id });

        return user.value;
      });

      const setEmail = Effect.fn("Users.setEmail")(function* (
        id: typeof UserId.Type,
        email: typeof Email.Type,
      ) {
        const result = yield* Ref.modify(
          users,
          (
            current,
          ): readonly [
            Result.Result<User, UserNotFound | EmailTaken>,
            HashMap.HashMap<typeof UserId.Type, User>,
          ] => {
            const found = HashMap.get(current, id);

            if (Option.isNone(found)) {
              return [Result.fail(new UserNotFound({ id })), current];
            }

            for (const [otherId, other] of current) {
              if (otherId !== id && other.email === email) {
                return [Result.fail(new EmailTaken({ email })), current];
              }
            }

            const updated = new User({
              id: found.value.id,
              email,
              displayName: found.value.displayName,
            });

            return [Result.succeed(updated), HashMap.set(current, id, updated)];
          },
        );

        return yield* Effect.fromResult(result);
      });

      return Users.of({ find, setEmail });
    }),
  );
}
