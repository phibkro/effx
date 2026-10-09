import { Match, Data, Predicate } from "effect";
import { allow, deny, type Decision } from "../authz/decision.js";
import { reachedDepartments, ReachedDepartments } from "../authz/reach.js";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import type { DepartmentId, PersonId } from "../organization/schema.js";

/** The content actor derived from one Organization projection at one instant. */
export type ContentActor =
  | { readonly _tag: "ContentAdministrator"; readonly personId: PersonId }
  | {
      readonly _tag: "ContentPublisher";
      readonly personId: PersonId;
      readonly departmentIds: ReadonlyArray<DepartmentId>;
    }
  | {
      readonly _tag: "ContentEditor";
      readonly personId: PersonId;
      readonly departmentIds: ReadonlyArray<DepartmentId>;
    };

export const ContentActor = Data.taggedEnum<ContentActor>();

export type ContentActorDenial = "AuthorityInactive" | "NotInScope";

const compareDepartmentId = (left: DepartmentId, right: DepartmentId): number =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * Maps the complete Organization projection onto the content actor (spec 0062
 * §Actor model). Pure over its input. An active global administrator, or whoever
 * holds `content.publish` for the whole organization, administers content. A
 * person who holds `content.publish` in departments, through a board leadership or
 * a delegation, publishes there. Any other active member edits own drafts in the
 * member's departments; a team leadership never widens that scope. An ended
 * administrator grant removes no membership authority; it only names the denial
 * when nothing else remains.
 */
export const resolveContentActor = (
  authority: OrganizationPersonAuthority,
): Decision<ContentActor> => {
  const publishing = reachedDepartments(authority, "content.publish");

  if (ReachedDepartments.$is("All")(publishing)) {
    return allow<ContentActor>(ContentActor.ContentAdministrator({ personId: authority.personId }));
  }

  if (publishing.departmentIds.length > 0) {
    return allow<ContentActor>(
      ContentActor.ContentPublisher({
        personId: authority.personId,
        departmentIds: publishing.departmentIds,
      }),
    );
  }

  const departmentIds = [
    ...new Set(
      authority.memberships.flatMap((membership) =>
        membership.active ? [membership.departmentId] : [],
      ),
    ),
  ].sort(compareDepartmentId);

  if (departmentIds.length === 0) {
    return deny<ContentActor>(
      authority.memberships.length > 0 || authority.globalAdministrator === "Inactive"
        ? "AuthorityInactive"
        : "NotInScope",
    );
  }

  return allow<ContentActor>(
    ContentActor.ContentEditor({ personId: authority.personId, departmentIds }),
  );
};

/** The department intersection a publisher may see and revise. */
export type ContentScope =
  | { readonly _tag: "All" }
  | { readonly _tag: "DepartmentIds"; readonly departmentIds: ReadonlyArray<DepartmentId> };

export const ContentScope = Data.taggedEnum<ContentScope>();

export const contentScopeFor = (actor: ContentActor): ContentScope => {
  return Match.value(actor).pipe(
    Match.withReturnType<ContentScope>(),
    Match.tag("ContentAdministrator", () => {
      return ContentScope.All();
    }),
    Match.tag("ContentPublisher", (actor) => {
      return ContentScope.DepartmentIds({ departmentIds: actor.departmentIds });
    }),
    Match.tag("ContentEditor", (actor) => {
      return ContentScope.DepartmentIds({ departmentIds: actor.departmentIds });
    }),
    Match.exhaustive,
  );
};

/** Whether the actor may set sticky or run publish/unpublish transitions. */
export const canPublishContent = (
  actor: ContentActor,
  articleDepartmentIds: ReadonlyArray<DepartmentId>,
): boolean => {
  if (Predicate.isTagged(actor, "ContentAdministrator")) return true;

  if (!Predicate.isTagged(actor, "ContentPublisher")) return false;

  // A leader may not publish org-wide (empty-department) articles.
  if (articleDepartmentIds.length === 0) return false;

  return articleDepartmentIds.some((departmentId) => actor.departmentIds.includes(departmentId));
};

/**
 * Draft ownership boundary (spec 0062): editors revise only their own drafts
 * carrying at least one department within their active memberships; leaders
 * revise any draft scoped to their departments; administrators span all.
 */
export const canReviseDraft = (
  actor: ContentActor,
  draft: {
    readonly createdByPersonId: PersonId;
    readonly currentVersionNumber: number | null;
    readonly departmentIds: ReadonlyArray<DepartmentId>;
  },
): boolean => {
  if (Predicate.isTagged(actor, "ContentAdministrator")) return true;

  if (Predicate.isTagged(actor, "ContentEditor")) {
    const editor = actor;

    return (
      draft.currentVersionNumber === null &&
      draft.createdByPersonId === editor.personId &&
      draft.departmentIds.length > 0 &&
      draft.departmentIds.every((departmentId) =>
        authorityDepartmentIds(actor).includes(departmentId),
      )
    );
  }

  // Publisher: any non-org-wide draft intersecting the leader's departments.
  if (draft.departmentIds.length === 0) return false;

  return draft.departmentIds.some((departmentId) => actor.departmentIds.includes(departmentId));
};

const authorityDepartmentIds = (actor: ContentActor): ReadonlyArray<DepartmentId> =>
  Predicate.isTagged(actor, "ContentAdministrator") ? [] : actor.departmentIds;
