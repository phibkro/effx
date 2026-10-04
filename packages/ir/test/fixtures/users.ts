import type { ApplicationIR, Edge, Node, SchemaRef } from "@effx/ir";
import { StableId, make } from "@effx/ir";

const schema = (module: string, name: string): SchemaRef => ({
  module,
  export: name,
  symbolId: StableId.make("schema", `${module}/${name}`),
});

export const GetUserInput = schema("users/schemas", "GetUserInput");

export const ChangeEmailInput = schema("users/schemas", "ChangeEmailInput");

export const UserSchema = schema("users/user", "User");

export const UserPublic = {
  ...schema("users/user", "User"),
  symbolId: StableId.make("schema", "users/user/User.Public"),
};

export const UserSelf = {
  ...schema("users/user", "User"),
  symbolId: StableId.make("schema", "users/user/User.Self"),
};

export const UserNotFound = schema("users/errors", "UserNotFound");

export const SqlError = schema("effect/sql", "SqlError");

export const ids = {
  model: StableId.make("model", "User"),
  users: StableId.make("service", "Users"),
  leases: StableId.make("service", "UserLeases"),
  get: StableId.make("operation", "User.Get"),
  change: StableId.make("operation", "User.ChangeEmail"),
  read: StableId.make("capability", "User.Read"),
  changeEmail: StableId.make("capability", "User.ChangeEmail"),
  email: StableId.make("focus", "User.email"),
  httpGet: StableId.make("exposure", "http:User.Get"),
  rpcGet: StableId.make("exposure", "rpc:User.Get"),
  cliGet: StableId.make("exposure", "cli:User.Get"),
  httpChange: StableId.make("exposure", "http:User.ChangeEmail"),
  rpcChange: StableId.make("exposure", "rpc:User.ChangeEmail"),
  cliChange: StableId.make("exposure", "cli:User.ChangeEmail"),
};

/** Deliberately unsorted; `normalize` must fix the order. */
export const nodes: ReadonlyArray<Node> = [
  {
    _tag: "Operation",
    id: ids.change,
    name: "User.ChangeEmail",
    kind: "Command",
    input: ChangeEmailInput,
    success: UserSelf,
    errors: { values: [SqlError, UserNotFound], inferred: true },
    requirements: { values: [ids.leases, ids.users], inferred: true },
    handler: { module: "users/operations", export: "UserOperations", member: "changeEmail" },
  },
  {
    _tag: "Operation",
    id: ids.get,
    name: "User.Get",
    kind: "Query",
    input: GetUserInput,
    success: UserPublic,
    errors: { values: [UserNotFound], inferred: true },
    requirements: { values: [ids.users], inferred: true },
    handler: { module: "users/operations", export: "UserOperations", member: "get" },
  },
  {
    _tag: "Model",
    id: ids.model,
    name: "User",
    schema: UserSchema,
    table: "users",
    views: [
      { name: "Self", schema: UserSelf },
      { name: "Public", schema: UserPublic },
    ],
  },
  {
    _tag: "Service",
    id: ids.users,
    name: "Users",
    symbol: { module: "users/service", export: "Users" },
  },
  {
    _tag: "Service",
    id: ids.leases,
    name: "UserLeases",
    symbol: { module: "users/leases", export: "UserLeases" },
  },
  { _tag: "Capability", id: ids.read, name: "User.Read", resource: ids.model },
  {
    _tag: "Capability",
    id: ids.changeEmail,
    name: "User.ChangeEmail",
    resource: ids.model,
    focus: ids.email,
  },
  { _tag: "Focus", id: ids.email, root: ids.model, path: ["email"] },
  {
    _tag: "Exposure",
    id: ids.httpGet,
    operation: ids.get,
    transport: { _tag: "http", method: "GET", path: "/users/:id" },
  },
  {
    _tag: "Exposure",
    id: ids.rpcGet,
    operation: ids.get,
    transport: { _tag: "rpc", name: "User.Get" },
  },
  {
    _tag: "Exposure",
    id: ids.cliGet,
    operation: ids.get,
    transport: { _tag: "cli", command: ["users", "get"] },
  },
  {
    _tag: "Exposure",
    id: ids.httpChange,
    operation: ids.change,
    transport: { _tag: "http", method: "PATCH", path: "/users/:id/email" },
  },
  {
    _tag: "Exposure",
    id: ids.rpcChange,
    operation: ids.change,
    transport: { _tag: "rpc", name: "User.ChangeEmail" },
  },
  {
    _tag: "Exposure",
    id: ids.cliChange,
    operation: ids.change,
    transport: { _tag: "cli", command: ["users", "change-email"] },
  },
  { _tag: "Schema", id: GetUserInput.symbolId, ref: GetUserInput },
  { _tag: "Schema", id: ChangeEmailInput.symbolId, ref: ChangeEmailInput },
  { _tag: "Schema", id: UserPublic.symbolId, ref: UserPublic },
  { _tag: "Schema", id: UserSelf.symbolId, ref: UserSelf },
  { _tag: "Schema", id: UserSchema.symbolId, ref: UserSchema },
  { _tag: "Schema", id: UserNotFound.symbolId, ref: UserNotFound },
  { _tag: "Schema", id: SqlError.symbolId, ref: SqlError },
  {
    _tag: "Extension",
    id: StableId.make("ext", "audit/User.Get"),
    extension: "audit",
    tag: "Audited",
    data: { level: 2 },
  },
];

export const edges: ReadonlyArray<Edge> = [
  { kind: "ExposedAs", from: ids.change, to: ids.rpcChange, qualifier: "rpc" },
  { kind: "ExposedAs", from: ids.change, to: ids.cliChange, qualifier: "cli" },
  { kind: "ExposedAs", from: ids.get, to: ids.httpGet, qualifier: "http" },
  { kind: "ExposedAs", from: ids.get, to: ids.rpcGet, qualifier: "rpc" },
  { kind: "ExposedAs", from: ids.get, to: ids.cliGet, qualifier: "cli" },
  { kind: "ExposedAs", from: ids.change, to: ids.httpChange, qualifier: "http" },
  { kind: "InputOf", from: GetUserInput.symbolId, to: ids.get },
  { kind: "SuccessOf", from: UserPublic.symbolId, to: ids.get },
  { kind: "ErrorOf", from: UserNotFound.symbolId, to: ids.get },
  { kind: "InputOf", from: ChangeEmailInput.symbolId, to: ids.change },
  { kind: "SuccessOf", from: UserSelf.symbolId, to: ids.change },
  { kind: "ErrorOf", from: UserNotFound.symbolId, to: ids.change },
  { kind: "ErrorOf", from: SqlError.symbolId, to: ids.change },
  { kind: "Requires", from: ids.get, to: ids.users },
  { kind: "Requires", from: ids.change, to: ids.users },
  { kind: "Requires", from: ids.change, to: ids.leases },
  { kind: "AuthorizedBy", from: ids.get, to: ids.read },
  { kind: "AuthorizedBy", from: ids.change, to: ids.changeEmail },
  { kind: "Focuses", from: ids.changeEmail, to: ids.email },
  { kind: "PersistsAs", from: ids.model, to: UserSchema.symbolId, qualifier: "users" },
  { kind: "ViewOf", from: UserPublic.symbolId, to: ids.model, qualifier: "Public" },
  { kind: "ViewOf", from: UserSelf.symbolId, to: ids.model, qualifier: "Self" },
  // duplicate on purpose: normalize must dedupe it
  { kind: "Requires", from: ids.get, to: ids.users },
];

export const users: ApplicationIR = make(nodes, edges);

/** Same IR plus an edge to a node that does not exist. */
export const usersWithDangling: ApplicationIR = make(nodes, [
  ...edges,
  { kind: "Requires", from: ids.get, to: StableId.make("service", "Audit") },
]);
