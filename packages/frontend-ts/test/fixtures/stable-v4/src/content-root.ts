import { HttpApi } from "effect/http-api";
import { ContentApi } from "../.effx/generated/content-contract.js";

/** The raw Content handlers bind to this generated, concrete API group. */
export const ExternalContentApi = HttpApi.make("external-native-api").add(ContentApi);
