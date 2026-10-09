import { Context, Effect } from "effect";
import type { PersonId } from "../organization/schema.js";
import type { ProfileFailure } from "./errors.js";
import type {
  OwnProfile,
  PersonContactProfile,
  PersonProfile,
  UpdateOwnProfileCommand,
} from "./schema.js";

export interface UpdateOwnProfileInput {
  readonly actorPersonId: PersonId;
  readonly command: UpdateOwnProfileCommand;
}

export interface ProfileOperations {
  /** Reads a bounded set of canonical names and fails if any requested person is missing. */
  readonly readProfiles: (
    personIds: ReadonlyArray<PersonId>,
  ) => Effect.Effect<ReadonlyArray<PersonProfile>, ProfileFailure>;
  /** Reads canonical staff contacts and fails if any requested contact is missing. */
  readonly readContacts: (
    personIds: ReadonlyArray<PersonId>,
  ) => Effect.Effect<ReadonlyArray<PersonContactProfile>, ProfileFailure>;
  /** Reads the authenticated actor's canonical names and contact data. */
  readonly readOwnProfile: (personId: PersonId) => Effect.Effect<OwnProfile, ProfileFailure>;
  /**
   * Updates only the authenticated actor. The command deliberately has no target person field.
   */
  readonly updateOwnProfile: (
    input: UpdateOwnProfileInput,
  ) => Effect.Effect<OwnProfile, ProfileFailure>;
  /**
   * Scans the paged Profile directory: person_profiles joined to
   * person_contact_profiles ordered by lastName, firstName, then personId.
   * A missing contact row for a scanned person is a typed failure; the
   * read is read-only.
   */
  readonly readDirectoryPage: (
    input: ReadDirectoryPageInput,
  ) => Effect.Effect<DirectoryPage, ProfileFailure>;
}

export interface ReadDirectoryPageInput {
  /** Maximum number of persons on one page; strictly positive. */
  readonly limit: number;
  /**
   * Opaque continuation token naming the last emitted sort tuple
   * (lastName, firstName, personId). The next page resumes strictly after it.
   */
  readonly cursor?: string;
}

/** One directory entry: canonical names joined to canonical contacts. */
export interface DirectoryEntry {
  readonly personId: PersonId;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
}

export interface DirectoryPage {
  readonly entries: ReadonlyArray<DirectoryEntry>;
  /** Names the last emitted sort tuple; absent when the scan is exhausted. */
  readonly nextCursor?: string;
}

export class Profile extends Context.Service<Profile, ProfileOperations>()(
  "@vektorprogrammet/domain/Profile",
) {}
