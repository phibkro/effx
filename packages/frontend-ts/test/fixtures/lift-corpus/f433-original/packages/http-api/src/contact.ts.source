import {
  ContactMessage,
  ContactVisitorIp,
  CONTACT_BACKEND_HEADER,
  CONTACT_IP_HEADER,
} from "@vektorprogrammet/domain/contact";
import {
  makeAccessSpec,
  CredentialMechanismSchema,
  CapabilityTypeId,
  CapabilityExpressionSchema,
  ConcealmentPolicySchema,
} from "@vektorprogrammet/domain/authz";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/unstable/httpapi";
import { annotateAccessSpec } from "./access.js";
import { operationAnnotations, SessionUnauthorizedResponse } from "./common.js";
import { endpointProblemResponses, problemUnion } from "./http-semantics.js";

export { ContactMessage, ContactVisitorIp };

export class ContactSsrSecurity extends HttpApiMiddleware.Service<ContactSsrSecurity>()(
  "@vektorprogrammet/http-api/ContactSsrSecurity",
  {
    security: {
      contactBackend: HttpApiSecurity.apiKey({ key: CONTACT_BACKEND_HEADER, in: "header" }).pipe(
        HttpApiSecurity.annotateMerge(
          OpenApi.annotations({
            description:
              "Server-only homepage-to-backend contact credential. Visitor needs no account; direct anonymous API requests are rejected.",
          }),
        ),
      ),
    },
    error: SessionUnauthorizedResponse,
  },
) {}

export const ContactProblem = problemUnion("ContactProblem", [
  "request.malformed",
  "header.malformed",
  "request.too-large",
  "validation.failed",
  "rate-limit.exceeded",
  "contact.unavailable",
  "media-type.unsupported",
  "internal.error",
]);

export const SubmitContactMessageEndpoint = HttpApiEndpoint.post(
  "submitContactMessage",
  "/api/contact-messages",
  {
    payload: ContactMessage,
    headers: Schema.Struct({ [CONTACT_IP_HEADER]: ContactVisitorIp }),
    success: HttpApiSchema.WithHeaders(Schema.Void.pipe(HttpApiSchema.status(201)), {
      "cache-control": Schema.Literal("no-store"),
      vary: Schema.Literal("Origin"),
    }),
    error: endpointProblemResponses(ContactProblem),
  },
)
  .middleware(ContactSsrSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      makeAccessSpec({
        exposure: "External",
        acceptedCredentials: [
          CredentialMechanismSchema.cases.ObjectCapability.make({
            capabilityType: CapabilityTypeId.make("contact.submit"),
          }),
        ],
        principalKinds: ["CapabilityHolder"],
        capabilities: CapabilityExpressionSchema.cases.One.make({
          capability: { type: CapabilityTypeId.make("contact.submit") },
        }),
        requirements: [],
        canonicalScopeResolver: "contact.department-recipient",
        concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Send public contact message",
      "Consumes one of five attempts per visitor fixed one-hour window and waits for delivery transport acceptance. No message is persisted; no automatic retry. HTTP 201 has no body and is not proof of inbox delivery.",
    ),
  );

export class ContactApi extends HttpApiGroup.make("contact")
  .add(SubmitContactMessageEndpoint)
  .annotateMerge(
    OpenApi.annotations({
      title: "Public contact",
      description: "Public visitor contact via authenticated homepage SSR ingress.",
    }),
  ) {}
