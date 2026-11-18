import type { ReleaseNoteEntry } from "../shared/releaseNotes";

export const englishReleaseNotes: ReleaseNoteEntry[] = [
  { title: "Codex profiles", body: "Import recognizes an existing profile after token rotation. Signing in again checks the account and workspace before replacing a profile." },
  { title: "Window switching", body: "A switch pauses when Codex has a window waiting to save work. Kvesser checks that the application has closed before changing the profile." },
  { title: "Tray quotas", body: "The indicators follow the Windows system theme. Hover over a quota to see details or click to refresh it." }
];
