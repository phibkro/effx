import { Context, Effect } from "effect";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import type { DepartmentId, SemesterId } from "../organization/schema.js";
import type { SocialEventFailure } from "./errors.js";
import type {
  CreateSocialEventCommand,
  SocialEventListResource,
  SocialEventObservedAt,
  SocialEventResource,
  SocialEventScope,
  SocialEventScopeResource,
} from "./schema.js";

export interface ReadSocialEventScopeInput {
  readonly authority: OrganizationPersonAuthority;
  /** The transaction_timestamp-derived instant used for authority resolution. */
  readonly observedAt?: SocialEventObservedAt;
}

export interface ReadSocialEventListInput {
  readonly departmentId: DepartmentId;
  readonly semesterId: SemesterId;
  /** The transaction_timestamp-derived response instant, if already resolved. */
  readonly observedAt?: SocialEventObservedAt;
}

/** Portable social-event capability; callers retain transaction ownership. */
export interface SocialEventsOperations {
  readonly readSnapshotInstant: Effect.Effect<SocialEventObservedAt, SocialEventFailure>;
  readonly readScope: (
    input: ReadSocialEventScopeInput,
  ) => Effect.Effect<SocialEventScopeResource, SocialEventFailure>;
  readonly readList: (
    input: ReadSocialEventListInput,
  ) => Effect.Effect<SocialEventListResource, SocialEventFailure>;
  readonly validateScope: (
    scope: SocialEventScope,
  ) => Effect.Effect<SocialEventScope, SocialEventFailure>;
  readonly create: (
    command: CreateSocialEventCommand,
  ) => Effect.Effect<SocialEventResource, SocialEventFailure>;
}

export class SocialEvents extends Context.Service<SocialEvents, SocialEventsOperations>()(
  "@vektorprogrammet/domain/SocialEvents",
) {}
