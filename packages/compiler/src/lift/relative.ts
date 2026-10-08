import { Result } from "effect";

/*
 * Module keys (spec 0019 §3.1) are the extensionless relative specifiers a frontend records from one
 * canonical base (`./src/profile`, `../../src/profile-support`) or bare package names (`effect`,
 * `@app/support`). Printing an import for a file needs the specifier from THAT file, so both keys are
 * resolved against their common base. Pure string math: no node path module, no filesystem.
 */

interface Located {
  /** How many levels above the base the path starts. */
  readonly ups: number;
  readonly names: ReadonlyArray<string>;
}

const locate = (path: string): Located => {
  const names: Array<string> = [];
  let ups = 0;

  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;

    if (part !== "..") names.push(part);
    else if (names.length > 0) names.pop();
    else ups += 1;
  }

  return { ups, names };
};

const isRelative = (module: string): boolean => module.startsWith("./") || module.startsWith("../");

const commonLength = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): number => {
  const first = left.findIndex((name, index) => right[index] !== name);

  return first === -1 ? Math.min(left.length, right.length) : first;
};

/**
 * The specifier an import in the file `from` writes for the module `to`. A bare `to` is its own specifier.
 * A path that would have to descend into a directory whose name no module key records (`from` is further
 * above the base than `to`) cannot be written, and is an error naming both keys.
 */
export const relativeModule = (from: string, to: string): Result.Result<string, string> => {
  if (!isRelative(to)) return Result.succeed(to);

  const file = locate(from);
  const target = locate(to);
  const directory = file.names.slice(0, -1);

  if (file.ups > target.ups)
    return Result.fail(
      `${to} cannot be imported from ${from}: the importing file is above the base of the module key`,
    );

  const common = file.ups === target.ups ? commonLength(directory, target.names) : 0;
  const climb = directory.length - common + (target.ups - file.ups);
  const rest = target.names.slice(common).join("/");
  const prefix = climb === 0 ? "./" : "../".repeat(climb);

  return Result.succeed(`${prefix}${rest}`);
};
