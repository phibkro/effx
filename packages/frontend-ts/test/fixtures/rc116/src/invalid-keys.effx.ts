import { Operation } from "@effx/runtime";
import {
  PersonSecurity,
  ProfileProblemResponses,
  ProfileReadInput,
  UserProfileResponse,
} from "./profile-support.js";

export const wrongGroupPrefix = Operation.query({
  name: "Invalid.WrongPrefix",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/wrong-prefix")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "other.readOwnProfile" },
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();

export const emptyEndpointKey = Operation.query({
  name: "Invalid.EmptyKey",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/empty")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile." },
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();

export const missingExternalKey = Operation.query({
  name: "Invalid.MissingKey",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/missing")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();

export const duplicateKeyOne = Operation.query({
  name: "Invalid.DuplicateOne",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/duplicate-one")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile.duplicate" },
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();

export const duplicateKeyTwo = Operation.query({
  name: "Invalid.DuplicateTwo",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/duplicate-two")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile.duplicate" },
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();

export const invalidIdentifierSyntax = Operation.query({
  name: "Invalid.Syntax",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/invalid-syntax")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile.9invalid" },
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();
