import { Predicate } from "effect";
import type { AnnotationArg } from "../Collected.ts";

/*
 * Typed access to the object-shaped members of an annotation argument (tagged `Schema`/`Symbol`/`Lambda`
 * arguments and plain option objects). The union keeps no index signature across its members, so callers
 * read entries through one place instead of narrowing by hand.
 */

/** The members of an annotation argument that are neither scalars nor arrays. */
export type ObjectArg = Exclude<
  AnnotationArg,
  string | number | boolean | ReadonlyArray<AnnotationArg>
>;

export const isObjectArg = (arg: AnnotationArg): arg is ObjectArg => Predicate.isObject(arg);

export const entriesOf = (arg: ObjectArg): ReadonlyArray<readonly [string, AnnotationArg]> =>
  Object.entries(arg);

/** Structural equality of annotation arguments; key order is never significant. */
export const sameArg = (
  left: AnnotationArg | undefined,
  right: AnnotationArg | undefined,
): boolean => {
  if (left === right) return true;

  if (left === undefined || right === undefined) return false;

  if (!isObjectArg(left) || !isObjectArg(right)) {
    return (
      !isObjectArg(left) &&
      !isObjectArg(right) &&
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameArg(item, right[index]))
    );
  }

  const leftEntries = entriesOf(left);
  const rightEntries = new Map(entriesOf(right));

  return (
    leftEntries.length === rightEntries.size &&
    leftEntries.every(([key, value]) => sameArg(value, rightEntries.get(key)))
  );
};
