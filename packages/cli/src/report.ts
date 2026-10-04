import { Array as Arr, Order } from "effect";
import type { Diagnostic } from "@effx/compiler";

/*
 * Pure text rendering of diagnostics (spec 0003 §"Diagnostic output"). File names are
 * made relative by the caller; this module never touches the filesystem.
 */

const NO_LOCATION = "(no location)";

const byPosition = Order.combine(
  Order.mapInput(Order.Number, (d: Diagnostic) => d.location?.line ?? 0),
  Order.combine(
    Order.mapInput(Order.Number, (d: Diagnostic) => d.location?.col ?? 0),
    Order.mapInput(Order.String, (d: Diagnostic) => d.code),
  ),
);

/** `EFFX2201 error    message  file:line:col` */
export const formatDiagnostic = (d: Diagnostic, file: string = d.location?.file ?? ""): string => {
  const head = `${d.code} ${d.severity.padEnd(8)} ${d.message}`;

  return d.location === undefined ? head : `${head}  ${file}:${d.location.line}:${d.location.col}`;
};

export interface Counts {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
}

export const count = (diagnostics: ReadonlyArray<Diagnostic>): Counts => ({
  errors: diagnostics.filter((d) => d.severity === "error").length,
  warnings: diagnostics.filter((d) => d.severity === "warning").length,
  infos: diagnostics.filter((d) => d.severity === "info").length,
});

export const summary = ({ errors, warnings, infos }: Counts): string =>
  `${errors} error(s), ${warnings} warning(s), ${infos} info`;

/**
 * Lines grouped by file (sorted), locationless diagnostics last. `relative` turns the
 * frontend's absolute file into what the user sees.
 */
export const report = (
  diagnostics: ReadonlyArray<Diagnostic>,
  relative: (file: string) => string,
): ReadonlyArray<string> => {
  const groups = Arr.groupBy(diagnostics, (d) =>
    d.location === undefined ? NO_LOCATION : relative(d.location.file),
  );

  const files = Object.keys(groups)
    .filter((file) => file !== NO_LOCATION)
    .toSorted(Order.String);

  const ordered = NO_LOCATION in groups ? [...files, NO_LOCATION] : files;

  return ordered.flatMap((file) => [
    file,
    ...groups[file]!.toSorted(byPosition).map((d) => `  ${formatDiagnostic(d, file)}`),
  ]);
};
