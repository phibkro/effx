import { Context, type Effect } from "effect";
import type { EmailTaken, UserNotFound } from "./errors.ts";
import type { UserId } from "./schemas.ts";
import type { User } from "./user.ts";

export class Users extends Context.Service<
  Users,
  {
    readonly find: (id: typeof UserId.Type) => Effect.Effect<User, UserNotFound>;
    readonly setEmail: (
      id: typeof UserId.Type,
      email: string,
    ) => Effect.Effect<User, UserNotFound | EmailTaken>;
  }
>()("users/Users") {}

export class Audit extends Context.Service<
  Audit,
  { readonly log: (message: string) => Effect.Effect<void> }
>()("users/Audit") {}
