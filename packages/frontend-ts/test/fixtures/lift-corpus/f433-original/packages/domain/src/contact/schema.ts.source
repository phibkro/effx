import { Option, Schema } from "effect";
import { Address4, Address6 } from "ip-address";
import { DepartmentId } from "../organization/schema.js";

export const CONTACT_LIMITS = { name: 100, email: 254, subject: 200, message: 5000 } as const;

const text = (max: number, multiline = false) =>
  Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(max),
      Schema.makeFilter(
        (value) =>
          value.trim() === value &&
          !value.split("").some((character) => {
            const code = character.charCodeAt(0);

            return code === 127 || (code < 32 && (!multiline || ![9, 10, 13].includes(code)));
          }),
        { message: "trimmed text without header controls" },
      ),
    ),
  );

export const ContactEmail = text(CONTACT_LIMITS.email).pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value), {
      message: "a deliverable email address",
    }),
  ),
);

export const ContactMessage = Schema.Struct({
  departmentId: DepartmentId,
  name: text(CONTACT_LIMITS.name),
  email: ContactEmail,
  subject: text(CONTACT_LIMITS.subject),
  message: text(CONTACT_LIMITS.message, true),
}).annotate({
  identifier: "ContactMessage",
  description:
    "A transient public message. Recipient is resolved by Organization; no message is stored.",
});

export type ContactMessage = typeof ContactMessage.Type;

/** Normalize address identity; networks, zones, lists and ports are not visitor addresses. */
export const canonicalContactIp = (raw: string): Option.Option<string> => {
  if (!raw || /[\s,/%]/u.test(raw) || raw.includes("[") || raw.includes("]")) return Option.none();

  if (Address4.isValid(raw)) return Option.some(new Address4(raw).correctForm());

  if (!Address6.isValid(raw)) return Option.none();
  const address = new Address6(raw);

  return Option.some(address.isMapped4() ? address.to4().correctForm() : address.correctForm());
};

export const ContactVisitorIp = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => Option.contains(canonicalContactIp(value), value), {
      message: "a canonical visitor address",
    }),
  ),
  Schema.brand("ContactVisitorIp"),
);

export type ContactVisitorIp = typeof ContactVisitorIp.Type;

export const CONTACT_INGRESS_HEADER = "x-vektor-contact-ingress";

export const CONTACT_BACKEND_HEADER = "x-vektor-contact-backend";

export const CONTACT_IP_HEADER = "x-vektor-contact-ip";
