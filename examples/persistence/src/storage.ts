import { Schema } from "effect";
import { Email, UserId } from "@effx-examples/users/schemas";
import { User } from "@effx-examples/users/user";

// PostgreSQL text cannot hold NUL or lone surrogates, but the original operation
// schemas accept all JS strings. Canonical JSON string encoding is lossless for
// that domain, including those values, and preserves equality for the UNIQUE key.
const StoredId = Schema.fromJsonString(UserId);

const StoredEmail = Schema.fromJsonString(Email);

const StoredDisplayName = Schema.fromJsonString(Schema.String);

const StoredUser = Schema.Struct({
  id: StoredId,
  email: StoredEmail,
  displayName: StoredDisplayName,
}).pipe(Schema.decodeTo(User));

export const encodeId = Schema.encodeEffect(StoredId);

export const encodeEmail = Schema.encodeEffect(StoredEmail);

export const encodeDisplayName = Schema.encodeEffect(StoredDisplayName);

export const encodeStoredUsers = Schema.encodeEffect(Schema.Array(StoredUser));

export const decodeStoredUsers = Schema.decodeUnknownEffect(Schema.Array(StoredUser));
