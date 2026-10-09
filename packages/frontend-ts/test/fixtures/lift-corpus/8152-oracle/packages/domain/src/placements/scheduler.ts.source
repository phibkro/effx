/**
 * Placement drafting: the legacy assistant scheduler as a pure function.
 *
 * A draft assigns assistants to open school places from their weekday availability and
 * teaching-block preference. It writes nothing. Skolekoordinering adjusts the draft and
 * creates placements through the ordinary placement commands.
 *
 * The search is the legacy one: a greedy first fit over shuffled weekdays, improved by the
 * legacy annealing loop, restarted several times. Like the legacy scheduler it works on
 * places per weekday and block summed over schools; a final pass assigns each weekday's
 * assistants to schools. The injected `Random` is the only source of randomness, so the
 * same input and seed give the same draft.
 */
import { Schema, type Random } from "effect";
import {
  AssistantLanguageSchema,
  ReturningAssistantPreferencesSchema,
  type AssistantAvailability,
  type AssistantPreferredGroup,
} from "../application/index.js";
import { PersonId } from "../organization/index.js";
import { SchoolId } from "../schools/index.js";
import {
  PlacementScope,
  PlacementValues,
  TeachingBlock,
  TeachingDay,
  type PlacementBoard,
} from "./schema.js";

const Count = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2_147_483_647)),
);

/**
 * The teaching blocks an assistant can serve: one named block, either single block, or both
 * blocks on one weekday at one school.
 */
export const DraftBlock = Schema.Literals(["1", "2", "Either", "Both"]);

/**
 * One assistant's supply for a draft: the weekdays the assistant can serve and the blocks.
 * The contract does not name its source, so any admission record can supply it.
 */
export const PlacementAvailability = Schema.Struct({
  personId: PersonId,
  days: Schema.Array(TeachingDay),
  block: DraftBlock,
});

/**
 * What an assistant wishes about the school: its teaching language and, from a returning
 * registration, one named school. A draft shows the wishes to the coordinator; it does not
 * score them.
 */
export const SchoolWishes = Schema.Struct({
  language: AssistantLanguageSchema,
  preferredSchool: ReturningAssistantPreferencesSchema.fields.preferredSchool,
});

/** An assistant's supply with the school wishes that the same record states. */
export const PlacementSupply = Schema.Struct({
  ...PlacementAvailability.fields,
  wishes: SchoolWishes,
});

/** Places a draft may still fill at one school, weekday, and block. */
export const DraftSlot = Schema.Struct({
  schoolId: SchoolId,
  day: TeachingDay,
  block: TeachingBlock,
  places: Count,
});

/** A school's capacity plan for one weekday. It bounds each block on that weekday. */
export const SchoolDayCapacity = Schema.Struct({
  schoolId: SchoolId,
  day: TeachingDay,
  places: Count,
});

export const DraftedPlacement = Schema.Struct({
  personId: PersonId,
  firstName: Schema.String,
  lastName: Schema.String,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: PlacementValues.fields.block,
  workdays: PlacementValues.fields.workdays,
  wishes: SchoolWishes,
});

/** An assistant the draft leaves without a place; `wishes` is null without a supply record. */
export const UnplacedAssistant = Schema.Struct({
  personId: PersonId,
  firstName: Schema.String,
  lastName: Schema.String,
  reason: Schema.Literals(["NoAvailability", "NoOpenPlace"]),
  wishes: Schema.NullOr(SchoolWishes),
});

export const OpenDraftSlot = Schema.Struct({
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
  places: Count,
});

/**
 * A placement draft for one department and semester. It is a read: nothing is stored.
 * `openPlaces` counts the places open before the draft and `filledPlaces` the places the
 * draft fills; an assistant in both blocks fills two.
 */
export const PlacementDraft = Schema.Struct({
  ...PlacementScope.fields,
  placements: Schema.Array(DraftedPlacement),
  unplaced: Schema.Array(UnplacedAssistant),
  openSlots: Schema.Array(OpenDraftSlot),
  openPlaces: Count,
  filledPlaces: Count,
});

export type DraftBlock = typeof DraftBlock.Type;

export type PlacementAvailability = typeof PlacementAvailability.Type;

export type SchoolWishes = typeof SchoolWishes.Type;

export type PlacementSupply = typeof PlacementSupply.Type;

export type DraftSlot = typeof DraftSlot.Type;

export type SchoolDayCapacity = typeof SchoolDayCapacity.Type;

export type PlacementDraft = typeof PlacementDraft.Type;

export interface PlacementDraftInput {
  readonly slots: ReadonlyArray<DraftSlot>;
  readonly assistants: ReadonlyArray<PlacementAvailability>;
}

export interface DraftAssignment {
  readonly personId: PersonId;
  readonly schoolId: SchoolId;
  readonly day: typeof TeachingDay.Type;
  readonly block: (typeof PlacementValues.Type)["block"];
}

export interface PlacementDraftPlan {
  /** Ordered by school, weekday, block (both blocks first), and person. */
  readonly assignments: ReadonlyArray<DraftAssignment>;
  /** Assistants without a place, ordered by person. */
  readonly unplaced: ReadonlyArray<PersonId>;
  readonly openPlaces: number;
  /** The fitness: the places the draft fills. An assistant in both blocks fills two. */
  readonly filledPlaces: number;
}

/**
 * The search budget. The legacy scheduler ran 101 restarts of 2000 steps with 20
 * neighbours each; `restarts: 1, iterations: 0` is the plain greedy first fit.
 */
export interface DraftSearch {
  /** Independent runs. The first starts from the Monday-to-Friday greedy fit. */
  readonly restarts: number;
  /** Annealing steps per run. The temperature falls linearly from 1 towards 0. */
  readonly iterations: number;
  /** Neighbours evaluated per step. */
  readonly neighbours: number;
}

export const defaultDraftSearch: DraftSearch = { restarts: 12, iterations: 2000, neighbours: 20 };

/** The fixed seed behind the served draft, so the same board gives the same draft. */
export const placementDraftSeed = "vektorprogrammet:placement-draft:v1";

const days = TeachingDay.literals;

const dayCount = days.length;

const queued = -1;

const none = -1;

const either = 0;

const first = 1;

const second = 2;

const both = 3;

const blockCodes: Record<DraftBlock, number> = {
  "1": first,
  "2": second,
  Either: either,
  Both: both,
};

const blockRank: Record<DraftAssignment["block"], number> = { Both: 0, "1": 1, "2": 2 };

interface Candidate {
  readonly personId: PersonId;
  /** Available weekday indices, ascending and distinct. */
  readonly days: ReadonlyArray<number>;
  readonly mask: number;
  readonly block: number;
}

/** Open places per weekday and block (index `day * 2 + block - 1`), summed over schools. */
interface Capacity {
  readonly places: Int32Array;
  /** Assistants in both blocks each weekday can host: per school, the smaller block. */
  readonly pairs: Int32Array;
  readonly total: number;
}

/** A schedule is never changed after it is shared: a neighbour starts from a copy. */
interface Schedule {
  readonly day: Int8Array;
  readonly block: Int8Array;
  readonly load: Int32Array;
  readonly pairs: Int32Array;
  filled: number;
}

interface SchoolDay {
  readonly schoolId: SchoolId;
  /** Places in block 1 and block 2. */
  readonly open: [number, number];
}

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const at = (values: Int32Array | Int8Array | ReadonlyArray<number>, index: number): number =>
  values[index] ?? 0;

const pick = (random: Random.Random, length: number): number =>
  Math.floor(random.nextDoubleUnsafe() * length);

const emptySchedule = (size: number): Schedule => ({
  day: new Int8Array(size).fill(queued),
  block: new Int8Array(size),
  load: new Int32Array(dayCount * 2),
  pairs: new Int32Array(dayCount),
  filled: 0,
});

const fits = (capacity: Capacity, schedule: Schedule, day: number, block: number): boolean =>
  block === both
    ? at(schedule.pairs, day) < at(capacity.pairs, day) &&
      at(schedule.load, day * 2) < at(capacity.places, day * 2) &&
      at(schedule.load, day * 2 + 1) < at(capacity.places, day * 2 + 1)
    : at(schedule.load, day * 2 + block - 1) < at(capacity.places, day * 2 + block - 1);

const adjust = (schedule: Schedule, day: number, block: number, change: number) => {
  if (block === both) {
    schedule.load[day * 2] = at(schedule.load, day * 2) + change;
    schedule.load[day * 2 + 1] = at(schedule.load, day * 2 + 1) + change;
    schedule.pairs[day] = at(schedule.pairs, day) + change;
    schedule.filled += 2 * change;
  } else {
    schedule.load[day * 2 + block - 1] = at(schedule.load, day * 2 + block - 1) + change;
    schedule.filled += change;
  }
};

const place = (schedule: Schedule, index: number, day: number, block: number) => {
  schedule.day[index] = day;
  schedule.block[index] = block;
  adjust(schedule, day, block, 1);
};

/** The block a candidate takes on a weekday, or `none` when that weekday is full for it. */
const firstFit = (capacity: Capacity, schedule: Schedule, candidate: Candidate, day: number) => {
  if (candidate.block !== either) {
    return fits(capacity, schedule, day, candidate.block) ? candidate.block : none;
  }

  if (fits(capacity, schedule, day, first)) return first;

  return fits(capacity, schedule, day, second) ? second : none;
};

/**
 * The legacy greedy pass: each queued candidate, in order, takes the first weekday in `order`
 * with room. Unlike the legacy pass, it skips no candidate after a placement.
 */
const fill = (
  capacity: Capacity,
  candidates: ReadonlyArray<Candidate>,
  schedule: Schedule,
  order: ReadonlyArray<number>,
) => {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    if (candidate === undefined || at(schedule.day, index) !== queued) continue;

    for (const day of order) {
      if ((candidate.mask & (1 << day)) === 0) continue;
      const block = firstFit(capacity, schedule, candidate, day);

      if (block !== none) {
        place(schedule, index, day, block);
        break;
      }
    }
  }
};

const canonicalOrder = days.map((_, index) => index);

/** Fisher-Yates in the legacy direction. */
const shuffledOrder = (random: Random.Random): ReadonlyArray<number> => {
  const order = [...canonicalOrder];

  for (let length = order.length; length > 0; length -= 1) {
    const other = pick(random, length);
    const last = at(order, length - 1);
    order[length - 1] = at(order, other);
    order[other] = last;
  }

  return order;
};

/**
 * The legacy mutation: move one assistant from a random weekday and block to another of its
 * weekdays when that weekday has room, then refill. A move keeps the filled places; only the
 * weekday it left can take a queued assistant, so the refill looks at that weekday alone.
 * Every neighbour is refilled; the legacy loop left its first neighbour unfilled.
 * Without a move the neighbour is `current` itself.
 */
const neighbour = (
  capacity: Capacity,
  candidates: ReadonlyArray<Candidate>,
  current: Schedule,
  random: Random.Random,
): Schedule => {
  const group = first + pick(random, 2);
  const from = pick(random, dayCount);
  const members: Array<number> = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const block = at(current.block, index);

    if (at(current.day, index) === from && (block === group || block === both)) {
      members.push(index);
    }
  }

  if (members.length === 0) return current;
  const moved = at(members, pick(random, members.length));
  const candidate = candidates[moved];
  const targets = candidate === undefined ? [] : candidate.days.filter((day) => day !== from);

  if (candidate === undefined || targets.length === 0) return current;
  const to = at(targets, pick(random, targets.length));
  let block = none;

  if (candidate.block === both || candidate.block === group) block = candidate.block;
  else if (candidate.block === either) block = first + pick(random, 2);

  if (block === none || !fits(capacity, current, to, block)) return current;

  const next: Schedule = {
    day: current.day.slice(),
    block: current.block.slice(),
    load: current.load.slice(),
    pairs: current.pairs.slice(),
    filled: current.filled,
  };

  adjust(next, from, at(current.block, moved), -1);
  place(next, moved, to, block);

  for (let index = 0; index < candidates.length; index += 1) {
    const queuedCandidate = candidates[index];

    if (
      queuedCandidate === undefined ||
      at(next.day, index) !== queued ||
      (queuedCandidate.mask & (1 << from)) === 0
    ) {
      continue;
    }

    const fit = firstFit(capacity, next, queuedCandidate, from);

    if (fit !== none) place(next, index, from, fit);
  }

  return next;
};

const slotCount = dayCount * 2;

/**
 * An upper bound on the places any schedule fills: the maximum flow from assistants (one
 * unit, two for both blocks) to weekday blocks (their places), relaxing that both halves
 * share a weekday and a school. The flow is computed as its minimum cut: for each set of
 * weekday blocks on the source side, each assistant is cut at its source edge or at its
 * edges to the other blocks. Once the search reaches the bound, no restart can fill more.
 * It includes the legacy optimality test: every place filled or every assistant placed.
 */
const upperBound = (capacity: Capacity, candidates: ReadonlyArray<Candidate>): number => {
  const edges = candidates.map((candidate) => {
    let mask = 0;

    for (const day of candidate.days) {
      if (candidate.block !== second) mask |= 1 << (day * 2);

      if (candidate.block !== first) mask |= 1 << (day * 2 + 1);
    }

    return { mask, units: candidate.block === both ? 2 : 1 };
  });

  const all = (1 << slotCount) - 1;
  let bound = Number.POSITIVE_INFINITY;

  for (let sourceSide = 0; sourceSide <= all; sourceSide += 1) {
    let cut = 0;

    for (let slot = 0; slot < slotCount; slot += 1) {
      if ((sourceSide & (1 << slot)) !== 0) cut += at(capacity.places, slot);
    }

    for (const { mask, units } of edges) {
      let crossing = 0;

      for (let rest = mask & ~sourceSide & all; rest !== 0; rest &= rest - 1) crossing += 1;
      cut += Math.min(units, crossing);
    }

    bound = Math.min(bound, cut);
  }

  return bound;
};

/**
 * The legacy annealing loop. Every neighbour keeps or raises the filled places, so the loop
 * climbs; the temperature decides how often it follows the best neighbour instead of a
 * random one. The best schedule seen wins; the loop stops at the upper bound.
 */
const anneal = (
  capacity: Capacity,
  candidates: ReadonlyArray<Candidate>,
  bound: number,
  start: Schedule,
  random: Random.Random,
  search: DraftSearch,
): Schedule => {
  let best = start;
  let current = start;

  for (let step = 0; step < search.iterations; step += 1) {
    if (best.filled >= bound) break;
    const temperature = 1 - step / search.iterations;
    const neighbours = [neighbour(capacity, candidates, current, random)];
    let leader = neighbours[0] ?? current;

    for (let count = 1; count < search.neighbours; count += 1) {
      const next = neighbour(capacity, candidates, current, random);
      neighbours.push(next);

      if (next.filled > leader.filled) leader = next;
    }

    if (leader.filled > best.filled) best = leader;

    const gain =
      current.filled === 0
        ? leader.filled > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : (leader.filled - current.filled) / current.filled;

    const followLeader = Math.min(1, Math.exp(-gain / temperature));

    current =
      random.nextDoubleUnsafe() > followLeader
        ? leader
        : (neighbours[pick(random, neighbours.length)] ?? leader);
  }

  return best;
};

/** Each weekday's schools in id order, with duplicate slots added up. */
const schoolDays = (slots: ReadonlyArray<DraftSlot>): ReadonlyArray<ReadonlyArray<SchoolDay>> => {
  const byDay = days.map(() => new Map<SchoolId, SchoolDay>());

  for (const slot of slots) {
    const schools = byDay[days.indexOf(slot.day)];
    const entry = schools?.get(slot.schoolId) ?? { schoolId: slot.schoolId, open: [0, 0] };
    entry.open[slot.block === "1" ? 0 : 1] += slot.places;
    schools?.set(slot.schoolId, entry);
  }

  return byDay.map((schools) =>
    [...schools.values()].sort((left, right) => left.schoolId - right.schoolId),
  );
};

const capacityOf = (schools: ReadonlyArray<ReadonlyArray<SchoolDay>>): Capacity => {
  const places = new Int32Array(dayCount * 2);
  const pairs = new Int32Array(dayCount);

  for (const [day, entries] of schools.entries()) {
    for (const { open } of entries) {
      places[day * 2] = at(places, day * 2) + open[0];
      places[day * 2 + 1] = at(places, day * 2 + 1) + open[1];
      pairs[day] = at(pairs, day) + Math.min(open[0], open[1]);
    }
  }

  return { places, pairs, total: places.reduce((sum, value) => sum + value, 0) };
};

/** One candidate per person, in person order; the first entry for a person wins. */
const candidatesOf = (assistants: ReadonlyArray<PlacementAvailability>) => {
  const seen = new Set<PersonId>();
  const candidates: Array<Candidate> = [];

  for (const assistant of assistants) {
    if (seen.has(assistant.personId)) continue;
    seen.add(assistant.personId);

    const available = [...new Set(assistant.days.map((day) => days.indexOf(day)))].sort(
      (left, right) => left - right,
    );

    candidates.push({
      personId: assistant.personId,
      days: available,
      mask: available.reduce((mask, day) => mask | (1 << day), 0),
      block: blockCodes[assistant.block],
    });
  }

  return candidates.sort((left, right) => compareText(left.personId, right.personId));
};

/** Assistants in both blocks go first, while schools still have room in both halves. */
const distributionOrder = [
  [both, "Both", [0, 1]],
  [first, "1", [0]],
  [second, "2", [1]],
] as const;

/**
 * Assigns each weekday's assistants to schools in school order: assistants in both blocks
 * first, where one school has room in both blocks, then each block. The weekday totals
 * guarantee room: both-block assistants never exceed the sum of each school's smaller
 * block, and no block exceeds its places.
 */
const distribute = (
  schools: ReadonlyArray<ReadonlyArray<SchoolDay>>,
  candidates: ReadonlyArray<Candidate>,
  schedule: Schedule,
): Array<DraftAssignment> => {
  const assignments: Array<DraftAssignment> = [];

  for (const [day, name] of days.entries()) {
    const open = (schools[day] ?? []).map((entry) => ({
      schoolId: entry.schoolId,
      open: [...entry.open],
    }));

    for (const [block, blockName, parts] of distributionOrder) {
      let school = 0;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];

        if (
          candidate === undefined ||
          at(schedule.day, index) !== day ||
          at(schedule.block, index) !== block
        ) {
          continue;
        }

        school = open.findIndex(
          (entry, position) =>
            position >= school && parts.every((part) => at(entry.open, part) > 0),
        );

        const target = open[school];

        // The weekday totals leave a school with room for every assistant of this day and block.
        if (target === undefined) continue;

        for (const part of parts) target.open[part] = at(target.open, part) - 1;

        assignments.push({
          personId: candidate.personId,
          schoolId: target.schoolId,
          day: name,
          block: blockName,
        });
      }
    }
  }

  return assignments.sort(
    (left, right) =>
      left.schoolId - right.schoolId ||
      days.indexOf(left.day) - days.indexOf(right.day) ||
      blockRank[left.block] - blockRank[right.block] ||
      compareText(left.personId, right.personId),
  );
};

/**
 * Drafts placements: assigns assistants to open places on an available weekday and an
 * accepted block, never beyond a slot's places. An assistant in both blocks gets both halves
 * of one weekday at one school. Duplicate slots add up; a repeated person counts once.
 * The result depends on the input content and `random`, not on input order.
 */
export const draftPlacements = (
  input: PlacementDraftInput,
  random: Random.Random,
  search: DraftSearch = defaultDraftSearch,
): PlacementDraftPlan => {
  const schools = schoolDays(input.slots);
  const capacity = capacityOf(schools);
  const everyone = candidatesOf(input.assistants);
  const empty = emptySchedule(0);

  // A candidate with no weekday that could ever take it stays out of the search.
  const candidates = everyone.filter((candidate) =>
    candidate.days.some((day) => firstFit(capacity, empty, candidate, day) !== none),
  );

  const bound = upperBound(capacity, candidates);
  let best: Schedule | undefined;

  for (let run = 0; run < Math.max(1, search.restarts); run += 1) {
    const start = emptySchedule(candidates.length);
    fill(capacity, candidates, start, run === 0 ? canonicalOrder : shuffledOrder(random));
    const result = anneal(capacity, candidates, bound, start, random, search);

    if (best === undefined || result.filled > best.filled) best = result;

    if (best.filled >= bound) break;
  }

  const schedule = best ?? emptySchedule(candidates.length);
  const assignments = distribute(schools, candidates, schedule);
  const assigned = new Set(assignments.map((assignment) => assignment.personId));

  return {
    assignments,
    unplaced: everyone.flatMap((candidate) =>
      assigned.has(candidate.personId) ? [] : [candidate.personId],
    ),
    openPlaces: capacity.total,
    filledPlaces: schedule.filled,
  };
};

export interface PlacementDraftSource {
  readonly board: Pick<
    PlacementBoard,
    "departmentId" | "semesterId" | "affiliations" | "placements" | "schools" | "demands"
  >;
  /** Supply per person, one entry each; a person without one has no availability on record. */
  readonly availability: ReadonlyArray<PlacementSupply>;
  /** Capacity plans; a school without a plan for a weekday is bounded by demand alone. */
  readonly capacities: ReadonlyArray<SchoolDayCapacity>;
}

/** "all" takes either block of a four-week position; a named block excludes the other. */
const blockByGroup: Record<AssistantPreferredGroup, DraftBlock> = {
  all: "Either",
  "block-1": "1",
  "block-2": "2",
};

/**
 * The supply that an assistant's stated availability gives: the weekdays not marked
 * unavailable, and, as in the legacy scheduler, both blocks for an eight-week position,
 * whatever block a four-week position would take.
 */
export const placementSupplyOf = (
  personId: PersonId,
  availability: AssistantAvailability,
  preferredSchool: SchoolWishes["preferredSchool"],
): PlacementSupply => ({
  personId,
  days: days.filter(
    (day) =>
      !{
        Monday: availability.mondayUnavailable,
        Tuesday: availability.tuesdayUnavailable,
        Wednesday: availability.wednesdayUnavailable,
        Thursday: availability.thursdayUnavailable,
        Friday: availability.fridayUnavailable,
      }[day],
  ),
  block: availability.positionWeeks === 8 ? "Both" : blockByGroup[availability.preferredGroup],
  wishes: { language: availability.language, preferredSchool },
});

const workdaysPerBlock = 4;

const slotKey = (
  schoolId: SchoolId,
  day: typeof TeachingDay.Type,
  block: typeof TeachingBlock.Type,
) => `${schoolId}:${day}:${block}`;

const halves = (block: DraftAssignment["block"]): ReadonlyArray<typeof TeachingBlock.Type> =>
  block === "Both" ? ["1", "2"] : [block];

/**
 * Drafts the board's open demand for its assistants.
 * Open places are the demand of each active school, weekday, and block, bounded by the
 * school's capacity plan for that weekday, minus active placements there. Assistants are the
 * active affiliations without an active placement in the semester; those without an
 * available weekday are reported, not drafted. A drafted placement serves 4 workdays per block.
 */
export const buildPlacementDraft = (
  source: PlacementDraftSource,
  random: Random.Random,
  search: DraftSearch = defaultDraftSearch,
): PlacementDraft => {
  const { board } = source;
  const occupied = new Map<string, number>();
  const placed = new Set<PersonId>();

  for (const placement of board.placements) {
    if (!placement.active) continue;
    placed.add(placement.personId);

    for (const block of halves(placement.block)) {
      const key = slotKey(placement.schoolId, placement.day, block);
      occupied.set(key, (occupied.get(key) ?? 0) + 1);
    }
  }

  const bounds = new Map(
    source.capacities.map((capacity) => [`${capacity.schoolId}:${capacity.day}`, capacity.places]),
  );

  const schoolNames = new Map(board.schools.map((school) => [school.schoolId, school.name]));

  const slots = board.demands.flatMap((demand): ReadonlyArray<DraftSlot> => {
    if (!schoolNames.has(demand.schoolId)) return [];

    const bound = Math.min(
      demand.requiredVolunteers,
      bounds.get(`${demand.schoolId}:${demand.day}`) ?? demand.requiredVolunteers,
    );

    const places = bound - (occupied.get(slotKey(demand.schoolId, demand.day, demand.block)) ?? 0);

    return places > 0
      ? [{ schoolId: demand.schoolId, day: demand.day, block: demand.block, places }]
      : [];
  });

  const people = board.affiliations.filter(
    (affiliation) => affiliation.status === "Active" && !placed.has(affiliation.personId),
  );

  const supply = new Map(source.availability.map((entry) => [entry.personId, entry]));

  const assistants = people.flatMap((person) => {
    const entry = supply.get(person.personId);

    return entry === undefined || entry.days.length === 0 ? [] : [entry];
  });

  const plan = draftPlacements({ slots, assistants }, random, search);
  const byPerson = new Map(people.map((person) => [person.personId, person]));
  const withoutPlace = new Set(plan.unplaced);
  const drafted = new Set(plan.assignments.map((assignment) => assignment.personId));
  const filled = new Map<string, number>();

  for (const assignment of plan.assignments) {
    for (const block of halves(assignment.block)) {
      const key = slotKey(assignment.schoolId, assignment.day, block);
      filled.set(key, (filled.get(key) ?? 0) + 1);
    }
  }

  return {
    departmentId: board.departmentId,
    semesterId: board.semesterId,
    placements: plan.assignments.flatMap((assignment) => {
      const entry = supply.get(assignment.personId);

      // The scheduler places only the assistants that the supply lists.
      if (entry === undefined) return [];

      return [
        {
          ...assignment,
          firstName: byPerson.get(assignment.personId)?.firstName ?? "",
          lastName: byPerson.get(assignment.personId)?.lastName ?? "",
          schoolName: schoolNames.get(assignment.schoolId) ?? "",
          workdays: halves(assignment.block).length * workdaysPerBlock,
          wishes: entry.wishes,
        },
      ];
    }),
    unplaced: people.flatMap((person) =>
      drafted.has(person.personId)
        ? []
        : [
            {
              personId: person.personId,
              firstName: person.firstName,
              lastName: person.lastName,
              reason: withoutPlace.has(person.personId)
                ? ("NoOpenPlace" as const)
                : ("NoAvailability" as const),
              wishes: supply.get(person.personId)?.wishes ?? null,
            },
          ],
    ),
    openSlots: slots.flatMap((slot) => {
      const places = slot.places - (filled.get(slotKey(slot.schoolId, slot.day, slot.block)) ?? 0);

      return places > 0
        ? [{ ...slot, schoolName: schoolNames.get(slot.schoolId) ?? "", places }]
        : [];
    }),
    openPlaces: plan.openPlaces,
    filledPlaces: plan.filledPlaces,
  };
};
