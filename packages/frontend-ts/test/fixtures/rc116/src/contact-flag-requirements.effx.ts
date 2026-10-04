import { Capability, Operation } from "@effx/runtime";
import { ContactGroup } from "./contact-group.js";
import {
  ContactCodes,
  ContactDepartmentRecipientResolver,
  ContactIpHeaders,
  ContactMessage,
  ContactSubmitted,
  ContactSubmittedResponseHeaders,
} from "./contact-support.js";

/** The claim beside a mutable authority requirement is invalid: EFFX2506, and EFFX2501 remains. */
export const SubmitContactMessage = Operation.command({
  name: "contact.submitContactMessage",
  input: ContactMessage,
  success: ContactSubmitted,
})
  .in(ContactGroup)
  .http.post("/api/contact-messages")
  .http.contract({
    headers: ContactIpHeaders,
    status: 201,
    responseHeaders: ContactSubmittedResponseHeaders,
    metadata: {
      summary: "Send public contact message",
      description: "Consumes one of five attempts per visitor and awaits delivery acceptance.",
    },
  })
  .http.problems({ identifier: "ContactProblem", codes: ContactCodes })
  .http.access({
    capabilities: Capability.one("contact.submit"),
    requirements: [{ id: "contact.recipient-active" }],
    canonicalScopeResolver: ContactDepartmentRecipientResolver,
    decisionTime: "SnapshotRead",
    snapshotDecisionForCommand: true,
  })
  .declare();
