import { Effect, Layer } from "effect";
import { Users } from "@effx-examples/users/services";
import { UsersPort } from "../.effx/generated/users-port.ts";

// Keep the original examples/users operations and their schemas byte-for-byte unchanged.
export const usersFromPort = Layer.effect(
  Users,
  Effect.gen(function* () {
    const port = yield* UsersPort;

    return Users.of({
      find: (id) => port.find({ id }),
      setEmail: (id, email) => port.setEmail({ id, email }),
    });
  }),
);
