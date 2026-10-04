/** @effect-diagnostics unstableApiUsage:off -- the test fixture declares one HttpApiMiddleware marker. */
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import { HttpApi, HttpApiMiddleware } from "effect/http-api";
import {
  Authorize,
  Capability,
  Cli,
  Command,
  Errors,
  Focus,
  Http,
  type HttpAccessOptions,
  Model,
  Operation,
  PersistentModel,
  Query,
  Reflect,
  Requirements,
  Rpc,
} from "@effx/runtime";

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String,
}) {}

class Users extends Context.Service<
  Users,
  { readonly find: (id: string) => Effect.Effect<string, UserNotFound> }
>()("test/Users") {}

@PersistentModel({ table: "users", focus: { email: ["email"] } })
class User extends Schema.Class<User>("User")({ id: Schema.String, email: Schema.String }) {
  static readonly Public = Schema.Struct({ id: Schema.String });
}

const GetUserInput = Schema.Struct({ id: Schema.String });

const Read = Capability.make("User.Read", { resource: User, focus: Focus.key(User, "email") });

class UserOperations {
  @Query({ name: "User.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id")
  @Rpc("User.Get")
  @Cli("users get")
  @Authorize(Read)
  @Errors(UserNotFound)
  @Requirements(Users)
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }

  @Command({ input: GetUserInput, success: User.Public })
  static touch(_input: typeof GetUserInput.Type) {
    return Effect.void;
  }
}

const getUser = Operation.query({ name: "User.Get", input: GetUserInput, success: User.Public })
  .http.get("/users/:id")
  .rpc("User.Get")
  .cli("users get")
  .authorize(Read)
  .errors(UserNotFound)
  .requirements(Users)
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    }),
  );

const userModel = Model.persistent(User, { table: "users", focus: { email: ["email"] } });

class PersonSecurity extends HttpApiMiddleware.Service<PersonSecurity>()(
  "test/http/PersonSecurity",
) {}

const registry = (identifier: string, codes: ReadonlyArray<string>) => [
  Schema.Struct({ identifier: Schema.Literal(identifier), count: Schema.Literal(codes.length) }),
];

const contract = {
  root: "effx",
  group: "users",
  params: GetUserInput,
  query: Schema.Struct({ include: Schema.optional(Schema.String) }),
  headers: Schema.Struct({ authorization: Schema.String }),
  success: User.Public,
  responseHeaders: Schema.Struct({ etag: Schema.String }),
  conditional: true,
  middleware: [PersonSecurity],
  metadata: { operationId: "users.get", summary: "Read user", tags: ["users"] },
};

const problems = { registry, codes: ["user.not-found"], map: { UserNotFound: "user.not-found" } };

class ContractOperations {
  @Query({ name: "User.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id")
  @Http.Contract(contract)
  @Http.Problems(problems)
  static get(_input: typeof GetUserInput.Type) {
    return Effect.succeed({ id: "1" });
  }
}

const contractMethod = Object.getOwnPropertyDescriptor(ContractOperations, "get")?.value;

const contractBuilder = Operation.query({
  name: "User.Get",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/users/:id")
  .http.contract(contract)
  .http.problems(problems)
  .handler(contractMethod);

let annotatorCalls = 0;

export const canonicalScopeResolver = (_id: string) => "person";

export const accessAnnotator: HttpAccessOptions["annotator"] = (_spec) => {
  annotatorCalls += 1;

  return Context.empty();
};

const access = {
  annotator: accessAnnotator,
  exposure: "External",
  acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
  principalKinds: ["Person"],
  capabilities: { _tag: "All", capabilities: ["profile.read", "profile.owner"] },
  requirements: [{ id: "profile.owner", parameters: { nested: { id: "self" } } }],
  canonicalScopeResolver,
  concealment: { _tag: "NotFound", stages: ["Resolve", "Authorize"] },
  decisionTime: "SnapshotRead",
} satisfies HttpAccessOptions;

class AccessOperations {
  @Query({ name: "Profile.Read", input: GetUserInput, success: User.Public })
  @Http.Get("/api/profile")
  @Http.Access(access)
  static read(_input: typeof GetUserInput.Type) {
    return Effect.succeed({ id: "1" });
  }
}

const accessMethod = Object.getOwnPropertyDescriptor(AccessOperations, "read")?.value;

const accessBuilder = Operation.query({
  name: "Profile.Read",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/api/profile")
  .http.access(access)
  .handler(accessMethod);

const groupOptions = {
  root: "effx",
  group: "profile",
  title: "Profile",
  description: "Current person's profile",
  displayName: "Profile",
};

@Http.Group(groupOptions)
class ProfileGroup {}

const profileGroup = Http.group(groupOptions);

const RootApi = HttpApi.make("effx");

const concreteGroupOptions = { ...groupOptions, root: RootApi };

@Http.Group(concreteGroupOptions)
class ConcreteProfileGroup {}

const concreteProfileGroup = Http.group(concreteGroupOptions);

const declaredProfile = Operation.query({
  name: "Profile.Read",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/api/profile")
  .http.contract({ root: "effx", group: "profile", success: User.Public })
  .http.problems({ registry, codes: ["user.not-found"], identifier: "ProfileReadProblem" })
  .errors(UserNotFound)
  .requirements(Users)
  .declare();

describe("@effx/runtime", () => {
  it("group class and builder contribute identical metadata without replacing the class", () => {
    assert.deepStrictEqual(Reflect.annotationsOf(ProfileGroup), profileGroup.annotations);
    assert.deepStrictEqual(Reflect.annotationsOf(ProfileGroup), [
      { name: "Http.Group", args: [groupOptions] },
    ]);
    assert.strictEqual(profileGroup._tag, "HttpGroup");
  });
  it("keeps concrete root identity in the same decorator and builder metadata", () => {
    assert.deepStrictEqual(
      Reflect.annotationsOf(ConcreteProfileGroup),
      concreteProfileGroup.annotations,
    );
    assert.strictEqual(concreteProfileGroup.annotations[0]?.args[0], concreteGroupOptions);
    assert.strictEqual(RootApi.identifier, "effx");
  });
  it("preserves group defaults and association without executing callbacks", () => {
    const defaults = {
      middleware: [PersonSecurity],
      metadata: {
        annotator: () => {
          throw new Error("not invoked by group declaration");
        },
      },
      problems: { registry },
      access: { exposure: "External" as const, acceptedCredentials: ["Cookie"] as const },
    };

    const options = { root: RootApi, group: "profile", defaults };
    const builderGroup = Http.group(options);

    const operation = Operation.query({ input: GetUserInput, success: User.Public })
      .in(builderGroup)
      .http.get("/profile")
      .http.contract({ query: true })
      .http.problems({ codes: ["user.not-found"] })
      .http.access({
        capabilities: { _tag: "None" },
        requirements: [],
        canonicalScopeResolver,
        decisionTime: "SnapshotRead",
      })
      .declare();

    const classOperation = Operation.query({ input: GetUserInput, success: User.Public })
      .in(ConcreteProfileGroup)
      .http.get("/profile")
      .http.contract({})
      .declare();

    assert.strictEqual(builderGroup.annotations[0]?.args[0], options);
    assert.deepStrictEqual(operation.annotations[1], { name: "Http.In", args: [builderGroup] });
    assert.deepStrictEqual(classOperation.annotations[1], {
      name: "Http.In",
      args: [ConcreteProfileGroup],
    });
    assert.deepStrictEqual(operation.annotations[3], {
      name: "Http.Contract",
      args: [{ query: true }],
    });
    assert.deepStrictEqual(operation.annotations[4], {
      name: "Http.Problems",
      args: [{ codes: ["user.not-found"] }],
    });
    assert.deepStrictEqual(operation.annotations[5]?.args[0], {
      capabilities: { _tag: "None" },
      requirements: [],
      canonicalScopeResolver,
      decisionTime: "SnapshotRead",
    });
  });

  it("declaration terminal preserves all annotations but never creates a handler", () => {
    assert.strictEqual(declaredProfile._tag, "Operation");
    assert.notProperty(declaredProfile, "handler");
    assert.deepStrictEqual(
      declaredProfile.annotations.map((annotation) => annotation.name),
      ["Query", "Http.Get", "Http.Contract", "Http.Problems", "Errors", "Requirements"],
    );
    assert.deepStrictEqual(declaredProfile.annotations[3]?.args[0], {
      registry,
      codes: ["user.not-found"],
      identifier: "ProfileReadProblem",
    });
  });

  it("access syntax preserves exported values and annotation order without invoking security code", () => {
    const decorated = Reflect.annotationsOf(accessMethod);
    assert.deepStrictEqual(decorated, accessBuilder.annotations);
    assert.deepStrictEqual(
      decorated.map((annotation) => annotation.name),
      ["Query", "Http.Get", "Http.Access"],
    );
    assert.strictEqual(decorated[2]?.args[0], access);
    assert.strictEqual(access.annotator, accessAnnotator);
    assert.strictEqual(access.canonicalScopeResolver, canonicalScopeResolver);
    assert.strictEqual(annotatorCalls, 0);
    assert.strictEqual(accessBuilder.handler, accessMethod);
  });
  it("HTTP contract and problems syntax records identical ordered live annotations", () => {
    const decorated = Reflect.annotationsOf(contractMethod);
    assert.deepStrictEqual(decorated, contractBuilder.annotations);
    assert.deepStrictEqual(
      decorated.map((annotation) => annotation.name),
      ["Query", "Http.Get", "Http.Contract", "Http.Problems"],
    );
    assert.strictEqual(decorated[2]?.args[0], contract);
    assert.strictEqual(decorated[3]?.args[0], problems);
    assert.strictEqual(contractBuilder.handler, contractMethod);
  });
  it("decorators and builder record identical annotations (syntax equivalence)", () => {
    const getMethod = Object.getOwnPropertyDescriptor(UserOperations, "get");
    const touchMethod = Object.getOwnPropertyDescriptor(UserOperations, "touch");

    if (getMethod === undefined || touchMethod === undefined) {
      throw new Error("The decorated operation methods were not defined");
    }

    assert.deepStrictEqual(Reflect.annotationsOf(getMethod.value), getUser.annotations);
    assert.deepStrictEqual(
      Reflect.annotationsOf(getMethod.value).map((a) => a.name),
      ["Query", "Http.Get", "Rpc", "Cli", "Authorize", "Errors", "Requirements"],
    );
    assert.deepStrictEqual(Reflect.annotationsOf(User), userModel.annotations);
    assert.deepStrictEqual(Reflect.annotationsOf(touchMethod.value), [
      { name: "Command", args: [{ input: GetUserInput, success: User.Public }] },
    ]);
  });

  it("decorators never replace the method or generate behaviour", () =>
    Effect.gen(function* () {
      const result = yield* UserOperations.get({ id: "1" }).pipe(
        Effect.provideService(Users, { find: (id) => Effect.succeed(`user ${id}`) }),
      );

      assert.strictEqual(result, "user 1");
      assert.deepStrictEqual(
        Reflect.annotationsOf(() => undefined),
        [],
      );
    }).pipe(Effect.runPromise));

  it("Capability and Focus are plain tagged values", () => {
    assert.deepStrictEqual(Read, {
      _tag: "Capability",
      name: "User.Read",
      resource: User,
      focus: { _tag: "Focus", root: User, path: ["email"] },
    });
  });
});
