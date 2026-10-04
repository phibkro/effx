// Shared domain code for the operations examples. The effx compiler never
// executes this module; it only records which exports the annotations name.
import { Context, Effect, HashMap, Layer, Option, Ref, Schema } from "effect";

// Branded identifiers keep ids from being mixed up with plain strings.
export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export const Email = Schema.NonEmptyString;

// An operation's `input` and `success` are Schema values, exported so the
// compiler can reference them by symbol (ADR 0004).
export const GetUserInput = Schema.Struct({ id: UserId });

export const ChangeEmailInput = Schema.Struct({ id: UserId, email: Email });

// Two views of the same user: callers outside the account see no email.
export const UserPublic = Schema.Struct({ id: UserId, displayName: Schema.String });

export const UserSelf = Schema.Struct({ id: UserId, email: Email, displayName: Schema.String });

// Domain failures are Schema-defined tagged errors, so they can be named by
// `@Errors` and mapped to wire responses.
export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: UserId,
}) {}

export class EmailTaken extends Schema.TaggedError<EmailTaken>()("EmailTaken", {
  email: Email,
}) {}

export class Users extends Context.Service<
  Users,
  {
    readonly find: (id: typeof UserId.Type) => Effect.Effect<typeof UserSelf.Type, UserNotFound>;
    readonly setEmail: (
      id: typeof UserId.Type,
      email: typeof Email.Type,
    ) => Effect.Effect<typeof UserSelf.Type, UserNotFound | EmailTaken>;
  }
>()("docs/operations/Users") {
  // An in-memory implementation. Layers are ordinary Effect; effx has no
  // dependency-injection runtime of its own.
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const alice: typeof UserSelf.Type = {
        id: UserId.make("1"),
        email: "alice@example.com",
        displayName: "Alice",
      };

      const store = yield* Ref.make(HashMap.make([alice.id, alice]));

      const find = Effect.fn("Users.find")(function* (id: typeof UserId.Type) {
        const found = HashMap.get(yield* Ref.get(store), id);

        if (Option.isNone(found)) return yield* new UserNotFound({ id });

        return found.value;
      });

      const setEmail = Effect.fn("Users.setEmail")(function* (
        id: typeof UserId.Type,
        email: typeof Email.Type,
      ) {
        const user = yield* find(id);
        const all = Array.from(HashMap.values(yield* Ref.get(store)));

        if (all.some((other) => other.id !== id && other.email === email)) {
          return yield* new EmailTaken({ email });
        }

        const updated = { ...user, email };

        yield* Ref.update(store, HashMap.set(id, updated));

        return updated;
      });

      return Users.of({ find, setEmail });
    }),
  );
}
