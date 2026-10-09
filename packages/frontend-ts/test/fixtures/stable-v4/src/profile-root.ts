import { HttpApi } from "effect/http-api";
import { ProfileApi } from "../project/contract/.effx/generated/profile-contract.js";

/** Real generated Profile group on the full application root used by the backend binding. */
export const ExternalNativeApi = HttpApi.make("external-native-api").add(ProfileApi);
