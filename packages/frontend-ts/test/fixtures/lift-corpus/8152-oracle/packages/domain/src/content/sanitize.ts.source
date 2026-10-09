import { Effect } from "effect";
import { defaultTreeAdapter, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { ContentDecodeError } from "./errors.js";

/**
 * Parser-backed write-time sanitizer for editorial body HTML (spec 0062 law
 * 6). parse5 applies the HTML parsing algorithm, including character-reference
 * decoding in attributes, before policy checks run.
 */

const REMOVED_ELEMENTS = {
  base: true,
  embed: true,
  iframe: true,
  link: true,
  math: true,
  meta: true,
  object: true,
  noscript: true,
  script: true,
  style: true,
  template: true,
  svg: true,
} satisfies Record<string, true>;

const ELEMENTS_REQUIRING_A_CLOSE_TAG = {
  iframe: true,
  math: true,
  object: true,
  noscript: true,
  script: true,
  style: true,
  template: true,
  svg: true,
} satisfies Record<string, true>;

const URL_ATTRIBUTES = {
  action: true,
  background: true,
  cite: true,
  formaction: true,
  href: true,
  poster: true,
  src: true,
  "xlink:href": true,
} satisfies Record<string, true>;

const SAFE_URL_SCHEMES = {
  http: true,
  https: true,
  mailto: true,
  tel: true,
} satisfies Record<string, true>;

type ParentNode = DefaultTreeAdapterTypes.ParentNode;

type Element = DefaultTreeAdapterTypes.Element;

const unsafeScheme = (value: string): string | undefined => {
  const canonical = value
    .normalize("NFKC")
    .replace(/\p{Cc}|\p{White_Space}/gu, "")
    .toLowerCase();

  const separator = canonical.indexOf(":");

  if (separator <= 0) return undefined;
  const scheme = canonical.slice(0, separator);

  return Object.hasOwn(SAFE_URL_SCHEMES, scheme) ? undefined : scheme;
};

const sanitizeChildren = (parent: ParentNode): string | undefined => {
  for (const node of parent.childNodes.slice()) {
    if (defaultTreeAdapter.isCommentNode(node)) {
      defaultTreeAdapter.detachNode(node);
      continue;
    }

    if (!defaultTreeAdapter.isElementNode(node)) continue;

    const element: Element = node;

    for (const attribute of element.attrs) {
      const qualifiedName =
        attribute.prefix === undefined ? attribute.name : `${attribute.prefix}:${attribute.name}`;

      if (
        Object.hasOwn(URL_ATTRIBUTES, qualifiedName) ||
        (attribute.prefix === undefined && Object.hasOwn(URL_ATTRIBUTES, attribute.name))
      ) {
        const scheme = unsafeScheme(attribute.value);

        if (scheme !== undefined) {
          return `article body contains disallowed ${scheme}: URL scheme`;
        }
      }
    }

    const tagName = element.tagName.toLowerCase();

    if (Object.hasOwn(REMOVED_ELEMENTS, tagName)) {
      if (
        Object.hasOwn(ELEMENTS_REQUIRING_A_CLOSE_TAG, tagName) &&
        element.sourceCodeLocation?.startTag !== undefined &&
        element.sourceCodeLocation.endTag === undefined
      ) {
        return `article body contains an unclosed ${tagName} document`;
      }

      defaultTreeAdapter.detachNode(element);
      continue;
    }

    element.attrs = element.attrs.filter((attribute) => {
      const name = attribute.name.toLowerCase();

      return (
        !name.startsWith("on") &&
        name !== "srcdoc" &&
        name !== "srcset" &&
        name !== "ping" &&
        name !== "style"
      );
    });
    const nestedRejection = sanitizeChildren(element);

    if (nestedRejection !== undefined) return nestedRejection;
  }

  return undefined;
};

const sanitize = (bodyHtml: string) => {
  const fragment = parseFragment(bodyHtml, { sourceCodeLocationInfo: true });
  const rejection = sanitizeChildren(fragment);

  return rejection === undefined ? { html: serialize(fragment) } : { html: "", rejection };
};

/** Sanitizes and validates one editorial body write before persistence. */
export const sanitizeArticleBodyHtml = (
  operation: string,
  bodyHtml: string,
): Effect.Effect<string, ContentDecodeError> =>
  Effect.try({
    try: () => sanitize(bodyHtml),
    catch: () => new ContentDecodeError({ operation, message: "sanitizer failure" }),
  }).pipe(
    Effect.flatMap((result) => {
      if (result.rejection !== undefined) {
        return Effect.fail(new ContentDecodeError({ operation, message: result.rejection }));
      }

      if (result.html.trim().length === 0) {
        return Effect.fail(
          new ContentDecodeError({
            operation,
            message: "sanitized article body must contain non-empty content",
          }),
        );
      }

      if (new TextEncoder().encode(result.html).byteLength > 100000) {
        return Effect.fail(
          new ContentDecodeError({
            operation,
            message: "sanitized article body exceeds the 100000-byte limit",
          }),
        );
      }

      return Effect.succeed(result.html);
    }),
  );
