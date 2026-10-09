import { Http, Operation } from "@effx/runtime";
import { ErrorsStaticNativeApi } from "../../../src/errors-static-root.js";
import { ReadUserInput, UserErrors, UserRow } from "./errors-support.ts";

export const ErrorsStaticGroup = Http.group({
  root: ErrorsStaticNativeApi,
  group: "errors-static",
});

export const readUser = Operation.command({
  name: "Errors.ReadUser",
  input: ReadUserInput,
  success: UserRow,
})
  .http.post("/users/read")
  .http.contract({
    root: "errors-static-native-api",
    group: "errors-static",
    success: UserRow,
    metadata: { operationId: "errors-static.readUser" },
  })
  .errors(UserErrors.UserNotFound)
  .declare();
