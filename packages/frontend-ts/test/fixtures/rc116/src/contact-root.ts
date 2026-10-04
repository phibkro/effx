import { HttpApi } from "effect/unstable/httpapi";

/** A standalone concrete root: the compiler reads its export and literal identifier only. */
export const ExternalContactApi = HttpApi.make("external-native-api");
