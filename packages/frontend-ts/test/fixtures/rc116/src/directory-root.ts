import { HttpApi } from "effect/unstable/httpapi";
import { DirectoryApi } from "../project/contract/.effx/generated/directory-contract.js";

/** The same concrete application root is used by both source forms. */
export const ExternalDirectoryApi = HttpApi.make("external-native-api").add(DirectoryApi);
