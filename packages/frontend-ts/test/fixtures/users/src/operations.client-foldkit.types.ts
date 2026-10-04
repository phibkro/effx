/** @effect-diagnostics unstableApiUsage:off -- this type witness compares generated clients with Effect's HttpApiClient.ForApi. */
import type { Effect } from "effect";
import type { HttpApiClient } from "effect/http-api";
import {
  Client,
  ProfileRead,
  ProfileUpdate,
  ProfileUpdateCommandIdentity,
  type EffectSdkFailure,
  TransportFailure,
} from "../.effx/generated/client.ts";
import { ProfileCommandsFor } from "../.effx/generated/foldkit.ts";
import type { Api } from "../.effx/generated/http.ts";
import {
  CredentialMissing,
  ProfileUpdated,
  ProfileUpdateFailed,
} from "./client-foldkit-support.ts";

type Assert<True extends true> = True;

export type Declared401IsInFailure = Assert<
  CredentialMissing extends EffectSdkFailure<"effx", "profile", "update"> ? true : false
>;

export type TransportIsInFailure = Assert<
  TransportFailure extends EffectSdkFailure<"effx", "profile", "update"> ? true : false
>;

// A wrapper must accept precisely the native HttpApi request, including headers and payload.
type NativeUpdateRequest = Parameters<HttpApiClient.ForApi<typeof Api>["profile"]["update"]>[0];

type UpdateRequest = Parameters<typeof ProfileUpdate>[0];

export type NativeRequestAccepted = Assert<
  UpdateRequest extends NativeUpdateRequest ? true : false
>;

export type NativeRequestPreserved = Assert<
  NativeUpdateRequest extends UpdateRequest ? true : false
>;

export const updateRequest: UpdateRequest = {
  headers: { "idempotency-key": "save-42", "if-match": '"v1"', "x-trace-id": "trace-42" },
  payload: { firstName: "Grace" },
};

const identity = ProfileUpdateCommandIdentity(updateRequest);

export const key: (typeof updateRequest.headers)["idempotency-key"] = identity.key;

export const precondition: (typeof updateRequest.headers)["if-match"] = identity.precondition;

export const input: typeof updateRequest = identity.input;

export const invalidKeyRequest = ProfileUpdate({
  // @ts-expect-error The idempotency key cannot disappear from the write request.
  headers: { "if-match": '"v1"' },
  payload: { firstName: "Grace" },
});

export const invalidQueryRequest = ProfileUpdate({
  headers: { "idempotency-key": "save-42", "if-match": '"v1"' },
  // @ts-expect-error PATCH input belongs in the payload, not the query channel.
  query: { firstName: "Grace" },
});

// @ts-expect-error GET has a required query schema and cannot be called with only headers.
export const invalidReadRequest = ProfileRead({ headers: {} });

export const typedClientCall: Effect.Effect<
  unknown,
  EffectSdkFailure<"effx", "profile", "update">,
  Client
> = ProfileUpdate(updateRequest);

declare const client: Client["Service"];

export const commands = ProfileCommandsFor(client, {
  ProfileUpdate: {
    success: ({ requestId, result }) =>
      ProfileUpdated.make({ requestId, profile: result.body, etag: result.headers.etag }),
    failure: ({ requestId, failure }) => ProfileUpdateFailed.make({ requestId, failure }),
  },
});

ProfileCommandsFor(client, {
  // @ts-expect-error An unrelated Message is not the annotated success or failure schema.
  ProfileUpdate: { success: () => ({ _tag: "Wrong" }), failure: () => ({ _tag: "Wrong" }) },
});
