import type { Annotation, AnnotationArg, Collected, Declaration } from "@effx/compiler";
import { type SchemaRef, StableId, type SymbolRef } from "@effx/ir";
import {
  ChangeEmailInput,
  GetUserInput,
  SqlError,
  UserNotFound,
  UserPublic,
  UserSchema,
  UserSelf,
} from "../../../ir/test/fixtures/users.ts";

const schema = (ref: SchemaRef): AnnotationArg => ({ _tag: "Schema", ref });

const symbol = (ref: SymbolRef): AnnotationArg => ({ _tag: "Symbol", ref });

export const UsersService: SymbolRef = { module: "users/service", export: "Users" };

export const UserLeasesService: SymbolRef = { module: "users/leases", export: "UserLeases" };

export const userModel: Declaration = {
  id: "User",
  kind: "model",
  module: "users/user",
  export: "User",
  annotations: [
    {
      name: "PersistentModel",
      args: [
        {
          table: "users",
          schema: schema(UserSchema),
          views: { Public: schema(UserPublic), Self: schema(UserSelf) },
          focus: { email: ["email"] },
        },
      ],
    },
  ],
};

export const getAnnotations: ReadonlyArray<Annotation> = [
  {
    name: "Query",
    args: [{ name: "User.Get", input: schema(GetUserInput), success: schema(UserPublic) }],
  },
  { name: "Http.Get", args: ["/users/:id"] },
  { name: "Rpc", args: ["User.Get"] },
  { name: "Cli", args: ["users get"] },
  { name: "Authorize", args: [{ name: "User.Read", resource: "User" }] },
];

export const changeAnnotations: ReadonlyArray<Annotation> = [
  {
    name: "Command",
    args: [
      { name: "User.ChangeEmail", input: schema(ChangeEmailInput), success: schema(UserSelf) },
    ],
  },
  { name: "Http.Patch", args: ["/users/:id/email"] },
  { name: "Rpc", args: ["User.ChangeEmail"] },
  { name: "Cli", args: ["users change-email"] },
  { name: "Authorize", args: [{ name: "User.ChangeEmail", resource: "User", focus: ["email"] }] },
];

export const getUser: Declaration = {
  id: "UserOperations.get",
  kind: "staticMethod",
  module: "users/operations",
  export: "UserOperations",
  member: "get",
  annotations: getAnnotations,
  handlerSignature: {
    success: { _tag: "Schema", ref: UserPublic },
    errors: [{ _tag: "Schema", ref: UserNotFound }],
    requirements: [
      { _tag: "Service", id: StableId.make("service", "Users"), symbol: UsersService },
    ],
  },
};

export const changeEmail: Declaration = {
  id: "UserOperations.changeEmail",
  kind: "staticMethod",
  module: "users/operations",
  export: "UserOperations",
  member: "changeEmail",
  annotations: changeAnnotations,
  handlerSignature: {
    success: { _tag: "Schema", ref: UserSelf },
    errors: [
      { _tag: "Schema", ref: UserNotFound },
      { _tag: "Schema", ref: SqlError },
    ],
    requirements: [
      { _tag: "Service", id: StableId.make("service", "Users"), symbol: UsersService },
      { _tag: "Service", id: StableId.make("service", "UserLeases"), symbol: UserLeasesService },
    ],
  },
};

/** The slice as a decorator-using source would be collected. */
export const decoratorStyle: Collected = {
  declarations: [userModel, getUser, changeEmail],
  diagnostics: [],
};

/**
 * The same slice as a builder chain (`Operation.command(...).http.patch(...)...`) would be
 * collected: different declaration kind, ids, declaration order and annotation order; same
 * symbols and arguments. The syntax-equivalence law says the IR must be identical.
 */
export const builderStyle: Collected = {
  diagnostics: [],
  declarations: [
    {
      ...changeEmail,
      id: "builder#2",
      kind: "builder",
      annotations: changeAnnotations.toReversed(),
    },
    { ...userModel, id: "builder#0", kind: "builder" },
    { ...getUser, id: "builder#1", kind: "builder", annotations: getAnnotations.toReversed() },
  ],
};

/** `@Errors`/`@Requirements` declared but out of sync with the handler signature. */
export const mismatched: Collected = {
  diagnostics: [],
  declarations: [
    userModel,
    {
      ...getUser,
      annotations: [
        ...getAnnotations,
        { name: "Errors", args: [schema(UserNotFound), schema(SqlError)] },
        { name: "Requirements", args: [symbol(UsersService), symbol(UserLeasesService)] },
      ],
    },
    {
      ...changeEmail,
      annotations: [...changeAnnotations, { name: "Errors", args: [schema(UserNotFound)] }],
    },
  ],
};

/** A Query exposed over POST. */
export const queryOverPost: Collected = {
  diagnostics: [],
  declarations: [
    userModel,
    {
      ...getUser,
      annotations: getAnnotations.map((a) =>
        a.name === "Http.Get" ? { name: "Http.Post", args: a.args } : a,
      ),
    },
  ],
};
