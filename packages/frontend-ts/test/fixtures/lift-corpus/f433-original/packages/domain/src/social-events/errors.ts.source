import { Data } from "effect";

export class SocialEventDecodeError extends Data.TaggedError("SocialEventDecodeError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class SocialEventPersistenceError extends Data.TaggedError("SocialEventPersistenceError")<{
  readonly operation: string;
  readonly message: string;
}> {}

/** The selected canonical department or semester does not exist. */
export class SocialEventScopeInvalid extends Data.TaggedError("SocialEventScopeInvalid")<{
  readonly departmentId: string;
  readonly semesterId: string;
}> {}

export type SocialEventFailure =
  | SocialEventDecodeError
  | SocialEventPersistenceError
  | SocialEventScopeInvalid;
