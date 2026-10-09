import { OnboardingApi } from "./onboarding.js";
import { PlacementsApi } from "./placements.js";
/**
 * Composition of all Vektor-owned native HTTP groups.
 *
 * @since 0.1.0
 */
import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { ContactApi } from "./contact.js";
import { AdmissionsApi } from "./admissions.js";
import { AdmissionOutcomesApi } from "./admission-outcomes.js";
import { ContentApi } from "./content.js";
import { DirectoryApi } from "./directory.js";
import { OrganizationApi } from "./organization.js";
import { ProfileApi } from "./profile.js";
import { InternalReceiptsApi, ReceiptsApi } from "./receipts.js";
import { RecruitmentApi } from "./recruitment.js";
import { SocialEventsApi } from "./social-events.js";
import { TeamApplicationsApi } from "./team-application.js";
import { CertificatesApi } from "./certificates.js";
import { RequestSchemaErrorMiddleware } from "./common.js";
import { NativeApiReleaseVersion } from "./release.js";
import { SystemApi } from "./system.js";

/**
 * Complete externally reachable Vektor-owned native HTTP contract.
 *
 * Better Auth `/api/auth/*` remains an independent external credential-engine
 * surface. Internal operations are not members of this root.
 *
 * @since 0.1.0
 * @category APIs
 */
export class ExternalNativeApi extends HttpApi.make("external-native-api")
  .add(PlacementsApi)
  .add(OnboardingApi)
  .add(ContactApi)
  .add(SystemApi)
  .add(ProfileApi)
  .add(OrganizationApi)
  .add(DirectoryApi)
  .add(AdmissionsApi)
  .add(AdmissionOutcomesApi)
  .add(RecruitmentApi)
  .add(ReceiptsApi)
  .add(ContentApi)
  .add(SocialEventsApi)
  .add(TeamApplicationsApi)
  .add(CertificatesApi)
  .middleware(RequestSchemaErrorMiddleware)
  .annotateMerge(
    OpenApi.annotations({
      title: "Vektorprogrammet native preview API",
      version: NativeApiReleaseVersion,
      description: "The complete Vektor-owned native backend contract for preview environments.",
      servers: [],
      override: {
        "x-vektorprogrammet-provenance": {
          contract: "@vektorprogrammet/http-api/ExternalNativeApi",
          generator: "effect/unstable/httpapi/OpenApi.fromApi",
          schemas: "Effect.Schema",
          statuses: "HttpApiSchema.status",
          security: "HttpApiMiddleware.security",
          exclusions: ["Better Auth /api/auth/*", "all internal operations"],
        },
        "x-tagGroups": [
          { name: "Platform", tags: ["System", "Profile"] },
          { name: "Directories", tags: ["Organization", "Directories"] },
          { name: "Admissions", tags: ["Admissions", "Admission outcomes"] },
          { name: "Recruitment", tags: ["Recruitment", "Team applications"] },
          { name: "Economy", tags: ["Receipts"] },
          { name: "Content", tags: ["Content and news"] },
          { name: "Social", tags: ["Social events"] },
        ],
      },
    }),
  ) {}

/**
 * Internal native operations. A caller must mount this root on an explicit
 * internal ingress. It is never part of public OpenAPI generation.
 *
 * @since 0.1.0
 * @category APIs
 */
export class InternalNativeApi extends HttpApi.make("internal-native-api")
  .add(InternalReceiptsApi)
  .middleware(RequestSchemaErrorMiddleware) {}
