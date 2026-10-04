/**
 * @title Decorator and builder record the same annotations
 *
 * `Reflect.annotationsOf` reads the runtime annotation list. A decorated method
 * and a builder chain written in the same order produce equal lists.
 */
import { Errors, Http, Operation, Query, Reflect } from "@effx/runtime";
import { Effect } from "effect";
import { GetUserInput, UserNotFound, UserPublic, Users } from "./fixtures/users.ts";

// Share the argument objects between both forms. Annotation arguments are live
// values here, so sharing them lets us compare by identity.
const getUserOptions = { name: "User.Get", input: GetUserInput, success: UserPublic } as const;

// One handler body for both forms: only the declaration syntax differs.
const getUserHandler = (input: typeof GetUserInput.Type) =>
  Effect.gen(function* () {
    const users = yield* Users;
    const user = yield* users.find(input.id);

    return { id: user.id, displayName: user.displayName };
  });

export class DecoratedOperations {
  @Query(getUserOptions)
  @Http.Get("/users/:id")
  @Errors(UserNotFound)
  static get(input: typeof GetUserInput.Type) {
    return getUserHandler(input);
  }
}

// Same steps, same order as the decorators above (top to bottom).
export const builtGetUser = Operation.query(getUserOptions)
  .http.get("/users/:id")
  .errors(UserNotFound)
  .handler(getUserHandler);

// Decorators run bottom-up, but the runtime registry restores source order.
// So `annotationsOf(Class.method)` equals `builder.annotations` element by element.
export const annotationsMatch = (): boolean => {
  // oxlint-disable-next-line typescript/unbound-method -- annotationsOf is keyed by the method function itself
  const decorated = Reflect.annotationsOf(DecoratedOperations.get);
  const built = builtGetUser.annotations;

  return (
    decorated.length === built.length &&
    decorated.every((annotation, index) => {
      const other = built[index];

      return (
        other !== undefined &&
        annotation.name === other.name &&
        annotation.args.length === other.args.length &&
        annotation.args.every((arg, position) => Object.is(arg, other.args[position]))
      );
    })
  );
};
