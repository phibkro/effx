import { Capability, Operation } from "@effx/runtime";
import { ContactGroup } from "./contact-group.js";
import {
  ContactCodes,
  ContactDepartmentRecipientResolver,
  ContactStatus,
  ContactStatusInput,
} from "./contact-support.js";

/** A Query is already a read: it has no Command/SnapshotRead exception to claim. EFFX2506 only. */
export const ReadContactStatus = Operation.query({
  name: "contact.readContactStatus",
  input: ContactStatusInput,
  success: ContactStatus,
})
  .in(ContactGroup)
  .http.get("/api/contact-messages/status")
  .http.contract({ status: 200 })
  .http.problems({ identifier: "ContactStatusProblem", codes: ContactCodes })
  .http.access({
    capabilities: Capability.one("contact.submit"),
    requirements: [],
    canonicalScopeResolver: ContactDepartmentRecipientResolver,
    decisionTime: "SnapshotRead",
    snapshotDecisionForCommand: true,
  })
  .declare();
