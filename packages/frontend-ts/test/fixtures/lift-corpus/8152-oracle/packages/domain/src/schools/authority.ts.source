import { Result, Array } from "effect";
import { allow, deny, type Decision } from "../authz/decision.js";
import type {
  OrganizationAuthorityMembership,
  OrganizationPersonAuthority,
} from "../organization/authority.js";
import type { DepartmentId } from "../organization/schema.js";
import { type SchoolDirectoryScope, SchoolDirectoryScopeSchema } from "./schema.js";

const compareDepartmentId = (left: DepartmentId, right: DepartmentId): number =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * Resolves the complete Organization projection at its injected instant.
 * Leadership never widens the result: every active membership contributes its
 * department and no primary membership is selected.
 */
export const resolveSchoolsDirectoryScope = (
  authority: OrganizationPersonAuthority,
): Decision<SchoolDirectoryScope> => {
  if (authority.globalAdministrator === "Active") {
    return allow<SchoolDirectoryScope>(SchoolDirectoryScopeSchema.cases.All.make({}));
  }

  const departmentIds = [
    ...new Set(
      Array.filterMap(authority.memberships, (membership: OrganizationAuthorityMembership) =>
        membership.active ? Result.succeed(membership.departmentId) : Result.failVoid,
      ),
    ),
  ].sort(compareDepartmentId);

  if (departmentIds.length > 0) {
    return allow<SchoolDirectoryScope>(
      SchoolDirectoryScopeSchema.cases.DepartmentIds.make({ departmentIds }),
    );
  }

  return deny<SchoolDirectoryScope>(
    authority.memberships.length > 0 || authority.globalAdministrator === "Inactive"
      ? "AuthorityInactive"
      : "NotInScope",
  );
};
