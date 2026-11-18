import type { ReleaseNoteEntry } from "../shared/releaseNotes";

export const englishReleaseNotes: ReleaseNoteEntry[] = [
  { title: "Codex profiles", body: "Import recognizes an existing profile after token rotation. Signing in again checks the account and workspace before replacing a profile." },
  { title: "Window switching", body: "A switch pauses when Codex has a window waiting to save work. Kvesser checks that the application has closed before changing the profile." },
  { title: "Taskbar quotas", body: "ChatGPT and Antigravity quotas sit side by side. Hover over a quota to see when it resets. Values below 10% turn red." },
  { title: "Updated interface", body: "Egoist graphite theme, platform and status filters, redesigned cards and settings navigation." }
];
