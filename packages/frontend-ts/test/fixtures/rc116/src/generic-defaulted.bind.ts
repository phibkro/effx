import { Binding } from "@effx/runtime";
import { ProfileGroup } from "./profile.effx.js";
import {
  defaultedProfileGuardFor,
  makeDefaultedProfileRawHandlers,
} from "./profile-bound-defaulted.js";

export const DefaultedBinding = Binding.group(ProfileGroup, {
  handlers: makeDefaultedProfileRawHandlers,
  guardFor: defaultedProfileGuardFor,
});
