import { Http, Operation } from "@effx/runtime";
import { EmptyDirectoryInput, PeopleDirectoryResponse } from "./directory-support.js";
import { ExternalDirectoryApi } from "./directory-root.js";

export const DirectoryGroup = Http.group({ root: ExternalDirectoryApi, group: "directory" });

export const WrongRoot = Operation.query({
  name: "directory.wrongRoot",
  input: EmptyDirectoryInput,
  success: PeopleDirectoryResponse,
})
  .in(DirectoryGroup)
  .http.get("/api/directory/wrong-root")
  .http.contract({ root: "another-api" })
  .declare();

export const WrongGroup = Operation.query({
  name: "directory.wrongGroup",
  input: EmptyDirectoryInput,
  success: PeopleDirectoryResponse,
})
  .in(DirectoryGroup)
  .http.get("/api/directory/wrong-group")
  .http.contract({ group: "other" })
  .declare();
