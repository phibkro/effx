import { Binding } from "@effx/runtime";
import { ProfileGroup } from "./profile.effx.js";
import { makeProfileRawHandlers, makeProfileGuards } from "./profile-bound-http.js";

export const ProfileBinding = Binding.group(ProfileGroup, {
  handlers: makeProfileRawHandlers,
  guards: makeProfileGuards,
});
