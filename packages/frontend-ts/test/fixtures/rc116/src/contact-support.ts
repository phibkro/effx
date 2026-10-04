import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/unstable/httpapi";

/** Fixture-only schemas; the real Contact package remains outside this project. */
export const ContactMessage = Schema.Struct({
  departmentId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  subject: Schema.String,
  message: Schema.String,
});

/** The canonical visitor address that the trusted ingress derives. */
export const ContactIpHeaders = Schema.Struct({ "x-vektor-contact-ip": Schema.String });

/** The success body of a submission: none. The declaration gives it status 201. */
export const ContactSubmitted = Schema.Void;

/** The no-store, origin-varying headers of the bodyless 201. */
export const ContactSubmittedResponseHeaders = Schema.Struct({
  "cache-control": Schema.Literal("no-store"),
  vary: Schema.Literal("Origin"),
});

/** Input and success of the Query that the negative fixtures declare. */
export const ContactStatusInput = Schema.Struct({});

export const ContactStatus = Schema.Struct({ accepting: Schema.Boolean });

/** The eight ordered problems of the Contact command. */
export const ContactCodes = [
  "request.malformed",
  "header.malformed",
  "request.too-large",
  "validation.failed",
  "rate-limit.exceeded",
  "contact.unavailable",
  "media-type.unsupported",
  "internal.error",
] as const;

export class ContactUnauthorized extends Schema.TaggedError<ContactUnauthorized>()(
  "ContactUnauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** Security marker only; the app-owned guard decides whether to grant authority. */
export class ContactSsrSecurity extends HttpApiMiddleware.Service<ContactSsrSecurity>()(
  "fixture/rc116/ContactSsrSecurity",
  {
    security: {
      contactBackend: HttpApiSecurity.apiKey({ key: "x-vektor-contact-backend", in: "header" }),
    },
    error: ContactUnauthorized,
  },
) {}

/** Explicit exported resolver symbol used by the Contact contract. */
export const ContactDepartmentRecipientResolver = { id: "contact.department-recipient" } as const;

export class ContactAccessAnnotation extends Context.Service<ContactAccessAnnotation, unknown>()(
  "fixture/rc116/ContactAccessAnnotation",
) {}

/** The one ObjectCapability access contract of the public submission, as the app checks it. */
const ContactAccessSpec = Schema.Struct({
  exposure: Schema.Literal("External"),
  acceptedCredentials: Schema.Tuple([Schema.Literal("ObjectCapability")]),
  principalKinds: Schema.Tuple([Schema.Literal("CapabilityHolder")]),
  capabilities: Schema.TaggedStruct("One", { capability: Schema.Literal("contact.submit") }),
  requirements: Schema.Array(Schema.Never),
  canonicalScopeResolver: Schema.declare(
    (value: unknown): value is typeof ContactDepartmentRecipientResolver =>
      value === ContactDepartmentRecipientResolver,
  ),
  concealment: Schema.TaggedStruct("Reveal", {}),
  decisionTime: Schema.Literal("SnapshotRead"),
});

const decodeContactAccess = Schema.decodeUnknownSync(ContactAccessSpec, {
  onExcessProperty: "error",
});

/** Like the application annotator, it rejects an excess AccessSpec field instead of ignoring it. */
export const contactAccessAnnotations = (spec: unknown) => {
  decodeContactAccess(spec);

  return Context.make(ContactAccessAnnotation, spec);
};

/** A test-only status classification, independent of the operation's authoritative code list. */
const problemStatus = (code: string): number => {
  if (code === "internal.error") return 500;
  if (code === "contact.unavailable") return 503;
  if (code === "rate-limit.exceeded") return 429;
  if (code === "request.too-large") return 413;
  if (code === "media-type.unsupported") return 415;
  if (code === "validation.failed") return 422;
  return 400;
};

/** The declaration passes one code list per operation; this fake registry copies no list. */
export const ContactProblemResponses = (identifier: string, codes: ReadonlyArray<string>) => [
  Schema.Union(
    codes.map((code) =>
      Schema.Struct({
        _tag: Schema.Literal("ContactProblem"),
        code: Schema.Literal(code),
        message: Schema.String,
      }).pipe(HttpApiSchema.status(problemStatus(code))),
    ),
  ).annotate({ identifier }),
];
