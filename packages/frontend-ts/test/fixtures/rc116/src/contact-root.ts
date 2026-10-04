import { HttpApi } from "effect/unstable/httpapi";
import { ContactApi } from "../.effx/generated/contact-contract.js";

/** Concrete root inventory is required; the generated group imports support schemas, not this root. */
export const ExternalContactApi = HttpApi.make("external-native-api").add(ContactApi);
