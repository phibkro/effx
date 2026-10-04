/**
 * HttpApiBuilder passes paths through HttpApiPath.toRouterPath before FindMyWay
 * registers them. A declared name ends before a literal colon (including an
 * action suffix); undeclared colons become escaped literals, not parameters.
 * See effect/src/http-api/internal/path.ts:20-61 and
 * effect/src/http/FindMyWay/internal/router.ts:128-235 (Effect 4.0.0).
 *
 * Shared by the `Http.Contract` validation and the request-channel derivation (spec 0024 §2), which
 * must agree on what a route parameter is.
 */
export const routeParamNames = (path: string, declared?: ReadonlySet<string>): Array<string> => {
  const names: Array<string> = [];

  for (let i = 0; i < path.length; i++) {
    if (path[i] !== ":") continue;

    if (path[i + 1] === ":") {
      i++;
      continue;
    }

    const param = /^:(\w+)/u.exec(path.slice(i));

    if (param === null || (declared !== undefined && !declared.has(param[1]!))) continue;

    names.push(param[1]!);
    i += param[0].length - 1;

    // FindMyWay treats a parenthesized regex as part of this parameter, not
    // as another source of colon-prefixed names. Nested and escaped parens count.
    if (path[i + 1] === "(") {
      let depth = 0;

      for (i++; i < path.length; i++) {
        if (path[i] === "\\") {
          i++;
        } else if (path[i] === "(") {
          depth++;
        } else if (path[i] === ")" && --depth === 0) {
          break;
        }
      }
    }
  }

  return names;
};
