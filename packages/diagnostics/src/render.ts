import type { DiagnosticEntry } from "./model.ts";

const label = (text: string): string =>
  text.replace(/[\\`*_{}[\]()<>&|#!~\r\n]/gu, (character) => `&#${character.charCodeAt(0)};`);

const fenced = (text: string, language: string | undefined): string => {
  let width = 3;

  for (const run of text.matchAll(/`+/gu)) width = Math.max(width, run[0].length + 1);
  const fence = "`".repeat(width);
  const info = language?.replace(/[^a-zA-Z0-9_+-]/gu, "") || "text";

  return `${fence}${info}\n${text}\n${fence}`;
};

const body = (entry: DiagnosticEntry, heading: string): string => {
  const policy =
    entry.severityPolicy.kind === "fixed"
      ? "Fixed"
      : `${label(entry.severityPolicy.name)} — ${entry.severityPolicy.description}\n\nAllowed severities: ${entry.severityPolicy.allowedSeverities.toSorted().map(label).join(", ")}`;

  const sections = [
    `${heading} ${heading === "#" ? entry.code : label(entry.code)} — ${label(entry.title)}${heading === "##" ? ` [#${label(entry.code)}]` : ""}`,
    `Owner: ${label(entry.owner)}\n\nDefault severity: ${label(entry.severity)}\n\nSeverity policy: ${policy}`,
    entry.explanation.trim(),
  ];

  for (const [index, example] of entry.examples.entries()) {
    sections.push(
      `${heading}# Example ${index + 1}`,
      "Before:",
      fenced(example.before, example.language),
      "After:",
      fenced(example.after, example.language),
      example.explanation.trim(),
    );
  }

  return `${sections.join("\n\n").trimEnd()}\n`;
};

/** Plain Markdown explanation ending in exactly one newline. No IO or evaluation. */
export const renderEntry = (entry: DiagnosticEntry): string => body(entry, "#");

/**
 * Pure projection of validated entry data. Sorts by full code using code units;
 * labels are MDX/Markdown-safe and example fences cannot be closed by source text.
 * Full codes are explicit IDs using the site's Fumadocs [#id] heading convention;
 * no title slugging or raw HTML anchor competes with the site compiler.
 */
export const renderCatalogue = (entries: ReadonlyArray<DiagnosticEntry>): string => {
  const sorted = entries.toSorted((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );

  const sections = [
    "# Diagnostic catalogue",
    "| Code | Title | Default severity |\n| --- | --- | --- |",
  ];

  sections[1] += sorted
    .map(
      (entry) =>
        `\n| [${label(entry.code)}](#${encodeURIComponent(entry.code)}) | ${label(entry.title)} | ${label(entry.severity)} |`,
    )
    .join("");

  for (const entry of sorted) {
    sections.push(body(entry, "##").trimEnd());
  }

  return `${sections.join("\n\n").trimEnd()}\n`;
};
