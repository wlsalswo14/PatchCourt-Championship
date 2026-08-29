const DEFAULT_TARGET_URL = "http://127.0.0.1:4173";
const configuredTarget = import.meta.env.VITE_PATCHCOURT_TARGET_URL?.trim();

export const PATCHCOURT_TARGET_URL =
  configuredTarget && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/u.test(configuredTarget)
    ? configuredTarget.replace(/\/$/u, "")
    : DEFAULT_TARGET_URL;

export const PUBLIC_REPLAY_ONLY = import.meta.env.VITE_PUBLIC_REPLAY_ONLY === "true";
