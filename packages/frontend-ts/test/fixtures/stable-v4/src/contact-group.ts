import { Concealment, Http } from "@effx/runtime";
import { ExternalContactApi } from "./contact-root.js";
import {
  ContactProblemResponses,
  ContactSsrSecurity,
  contactAccessAnnotations,
} from "./contact-support.js";

export const ContactGroup = Http.group({
  root: ExternalContactApi,
  group: "contact",
  title: "Public contact",
  description: "Public visitor contact via authenticated homepage SSR ingress.",
  defaults: {
    middleware: [ContactSsrSecurity],
    problems: { registry: ContactProblemResponses },
    access: {
      annotator: contactAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["ObjectCapability"],
      principalKinds: ["CapabilityHolder"],
      concealment: Concealment.reveal,
    },
  },
});
