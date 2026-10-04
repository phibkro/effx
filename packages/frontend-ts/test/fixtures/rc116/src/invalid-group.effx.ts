import { Http } from "@effx/runtime";

export const ProfileGroupOne = Http.group({
  root: "external-native-api",
  group: "profile",
  title: "Profile",
  description: "Authenticated self-service profile API.",
  displayName: "Profile",
});

export const ProfileGroupTwo = Http.group({
  root: "external-native-api",
  group: "profile",
  title: "Other Profile",
  description: "Conflicting metadata for the same group.",
  displayName: "Other Profile",
});
