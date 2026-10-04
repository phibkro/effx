import { UserId } from "@effx-examples/users/schemas";
import { User } from "@effx-examples/users/user";

export const alice = new User({
  id: UserId.make("1"),
  email: "alice@example.com",
  displayName: "Alice",
});

export const bob = new User({ id: UserId.make("2"), email: "bob@example.com", displayName: "Bob" });
