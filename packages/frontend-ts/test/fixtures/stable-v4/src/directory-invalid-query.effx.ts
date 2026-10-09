import { Http, Operation } from "@effx/runtime";
import { SchoolCommand, SchoolCommandResult } from "./directory-support.js";
import { ExternalDirectoryApi } from "./directory-root.js";

export const DirectoryGroup = Http.group({ root: ExternalDirectoryApi, group: "directory" });
export const InvalidQuery = Operation.command({
  name: "directory.invalidQuery",
  input: SchoolCommand,
  success: SchoolCommandResult,
})
  .in(DirectoryGroup)
  .http.post("/api/schools/commands")
  .http.contract({ query: true })
  .declare();
