import { HttpApi } from "effect/unstable/httpapi";
import { ErrorsStaticApi } from "../project/errors-static/.effx/generated/errors-static-contract.js";

/** The exported concrete root the external errors-static group is declared against. */
export const ErrorsStaticNativeApi = HttpApi.make("errors-static-native-api").add(ErrorsStaticApi);
