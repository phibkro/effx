import { Effect, Schema } from "effect";
import { Command, Foldkit, Http } from "@effx/runtime";
import {
  ProfileResponse,
  ProfileUpdateFailed,
  ProfileUpdateInput,
} from "./client-foldkit-support.ts";

const PrivateMessage = Schema.TaggedStruct("PrivateMessage", { requestId: Schema.Int });

export class InvalidClientFoldkitMessage {
  @Command({ name: "Invalid.Message", input: ProfileUpdateInput, success: ProfileResponse })
  @Http.Patch("/invalid/message")
  @Http.Contract({ group: "profile", payload: ProfileUpdateInput, success: ProfileResponse })
  @Foldkit.Command({ success: PrivateMessage, failure: ProfileUpdateFailed })
  static update(input: typeof ProfileUpdateInput.Type) {
    return Effect.succeed({ firstName: input.firstName });
  }
}
