import {
  CreateSocialEventRequest,
  SocialEventAudience,
  SocialEventId,
  SocialEventListResource,
  SocialEventObservedAt,
  SocialEventResource,
  SocialEventScope,
  SocialEventScopeResource,
} from "@vektorprogrammet/domain";
import { Schema } from "effect";
import { problemUnion, type NativeProblemCode } from "./http-semantics.js";

export {
  CreateSocialEventRequest,
  SocialEventAudience,
  SocialEventId,
  SocialEventListResource,
  SocialEventObservedAt,
  SocialEventResource,
  SocialEventScope,
  SocialEventScopeResource,
};

/** A scope read has no query, route parameters or request body. */
export const EmptySocialEventInput = Schema.Struct({});

/** The exported query schema reuses the domain scope fields without new wire members. */
export const SocialEventScopeQuery = Schema.Struct(SocialEventScope.fields);

export const SocialEventsReadScopeCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "dependency.unavailable",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const SocialEventsReadScopeProblem = problemUnion(
  "SocialEventsReadScopeProblem",
  SocialEventsReadScopeCodes,
);

export const SocialEventsListCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "scope.invalid",
  "internal.error",
  "dependency.unavailable",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const SocialEventsListProblem = problemUnion(
  "SocialEventsListProblem",
  SocialEventsListCodes,
);

export const SocialEventsCreateCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "scope.invalid",
  "internal.error",
  "dependency.unavailable",
  "organization.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const SocialEventsCreateProblem = problemUnion(
  "SocialEventsCreateProblem",
  SocialEventsCreateCodes,
);
