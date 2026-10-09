import { Http, Operation } from "@effx/runtime";
import { EmptyDirectoryInput, PeopleDirectoryResponse } from "./directory-support.js";
import { ExternalDirectoryApi } from "./directory-root.js";

export const DirectoryGroup = Http.group({ root: ExternalDirectoryApi, group: "directory" });
export const OtherGroup = Http.group({ root: ExternalDirectoryApi, group: "other" });

export const DoubleAssociation = Operation.query({
  name: "directory.double",
  input: EmptyDirectoryInput,
  success: PeopleDirectoryResponse,
})
  .in(DirectoryGroup)
  .in(OtherGroup)
  .http.get("/api/directory/double")
  .http.contract({})
  .declare();
