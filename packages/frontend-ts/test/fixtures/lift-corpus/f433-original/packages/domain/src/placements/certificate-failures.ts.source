/** Typed failures of days served and certificates; the HTTP layer maps each tag to one problem. */
import { Schema } from "effect";
import { PersonId } from "../organization/schema.js";

/**
 * The reader holds no authority here. `OwnCertificate`: only issuers download a certificate, and
 * the assistant never downloads their own, also when they hold an issuing seat.
 */
export class CertificateAccessDenied extends Schema.TaggedError<CertificateAccessDenied>()(
  "CertificateAccessDenied",
  { reason: Schema.Literals(["NotInScope", "OwnCertificate"]) },
) {}

/** The department or the semester does not exist. */
export class CertificateScopeNotFound extends Schema.TaggedError<CertificateScopeNotFound>()(
  "CertificateScopeNotFound",
  {},
) {}

/** The person has no service facts in the department (and semester). */
export class CertificateAssistantNotFound extends Schema.TaggedError<CertificateAssistantNotFound>()(
  "CertificateAssistantNotFound",
  { personId: PersonId },
) {}

export class CertificateInvalidCursor extends Schema.TaggedError<CertificateInvalidCursor>()(
  "CertificateInvalidCursor",
  {},
) {}

/** No semester of the department has a confirmed total above zero, so nothing can be issued. */
export class CertificateEmpty extends Schema.TaggedError<CertificateEmpty>()(
  "CertificateEmpty",
  {},
) {}

/** Internal cause information must not enter a public response. */
export class CertificatePersistenceError extends Schema.TaggedError<CertificatePersistenceError>()(
  "CertificatePersistenceError",
  {
    operation: Schema.String,
    conflict: Schema.Boolean,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type CertificateReadFailure =
  | CertificateAccessDenied
  | CertificateScopeNotFound
  | CertificateAssistantNotFound
  | CertificateInvalidCursor
  | CertificatePersistenceError;

/** The failures of resolving a command's authority before a stored response can replay. */
export type CertificateAuthorizationFailure =
  | CertificateAccessDenied
  | CertificateScopeNotFound
  | CertificatePersistenceError;

export type DaysServedCommandFailure =
  | CertificateAuthorizationFailure
  | CertificateAssistantNotFound;

export type CertificateCommandFailure = DaysServedCommandFailure | CertificateEmpty;
