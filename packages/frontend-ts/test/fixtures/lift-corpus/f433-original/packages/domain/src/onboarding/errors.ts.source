import { Data } from "effect";

export class OnboardingFailure extends Data.TaggedError("OnboardingFailure")<{
  readonly code:
    | "onboarding.claim-invalid"
    | "onboarding.sign-in-required"
    | "onboarding.already-linked"
    | "resource.not-found";
  readonly status: 400 | 404 | 409;
}> {}
