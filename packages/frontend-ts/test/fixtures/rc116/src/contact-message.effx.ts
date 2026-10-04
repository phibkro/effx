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

/**
 * A command: it consumes one of five attempts per visitor and awaits delivery. Its access
 * decision stays `SnapshotRead`, as the handwritten AccessSpec states, and the declaration says
 * so explicitly.
 */
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
    requirements: [],
    canonicalScopeResolver: ContactDepartmentRecipientResolver,
    decisionTime: "SnapshotRead",
    snapshotDecisionForCommand: true,
  })
  .declare();
