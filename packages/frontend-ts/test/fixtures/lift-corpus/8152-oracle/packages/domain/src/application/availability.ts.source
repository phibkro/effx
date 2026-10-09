/**
 * When and where an assistant can serve. The public application and the returning
 * registration state it; the placement draft reads it.
 *
 * The values are those of the legacy application form. A weekday is marked when it does not
 * suit. A position lasts four weeks, in one teaching block, or eight weeks, in both. A
 * four-week position can exclude a block. The teaching language names the school the
 * assistant wishes for: a Norwegian school, an international school, or either.
 */
import { Schema } from "effect";

/** Norsk: a Norwegian school. Engelsk: an international school. Norsk og engelsk: either. */
export const AssistantLanguageSchema = Schema.Literals(["Norsk", "Engelsk", "Norsk og engelsk"]);

export type AssistantLanguage = typeof AssistantLanguageSchema.Type;

/** The blocks a four-week position can serve: either block, only block 1, or only block 2. */
export const AssistantPreferredGroupSchema = Schema.Literals(["all", "block-1", "block-2"]);

export type AssistantPreferredGroup = typeof AssistantPreferredGroupSchema.Type;

/** A four-week position serves one teaching block; an eight-week position serves both. */
export const AssistantPositionWeeksSchema = Schema.Literals([4, 8]);

export const AssistantAvailabilityFields = {
  mondayUnavailable: Schema.Boolean,
  tuesdayUnavailable: Schema.Boolean,
  wednesdayUnavailable: Schema.Boolean,
  thursdayUnavailable: Schema.Boolean,
  fridayUnavailable: Schema.Boolean,
  positionWeeks: AssistantPositionWeeksSchema,
  preferredGroup: AssistantPreferredGroupSchema,
  language: AssistantLanguageSchema,
};

export const AssistantAvailabilitySchema = Schema.Struct(AssistantAvailabilityFields);

export type AssistantAvailability = typeof AssistantAvailabilitySchema.Type;
