import type { ViewportContract } from "@patchcourt/core";

export const CANONICAL_USER_TASK = "Sign in as the brand demo, open Creator Directory, search US, open John Smith, determine audience, verified channel, market fit, and next action, then change the fee to 1500 and prepare an unsent offer draft.";
export const TASK_CONTRACT_VERSION = "pc01-v1";
export const DEFAULT_TARGET_URL = "http://127.0.0.1:4173";
export const DEFAULT_VIEWPORTS: ViewportContract[] = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];
export const GEMINI_DESIGN_MODEL = process.env.PATCHCOURT_GEMINI_MODEL?.trim() || "gemini-3.6-flash";
export const EXECUTION_MODE = process.env.PATCHCOURT_EXECUTION_MODE === "live-gemini" ? "live-gemini" : "offline-demo";
