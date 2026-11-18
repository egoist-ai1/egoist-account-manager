import fs from "node:fs";
import path from "node:path";

// Visible renaming never moves the vault or starts an empty parallel database.
export function resolveStoredUserData(appData: string): string {
  const directories = ["Account Manager EGO", "Egoist Account Manager", "Egoist", "Codex Account Manager"].map((name) => path.join(appData, name));
  const databases = directories.map((directory) => {
    const file = path.join(directory, "accounts.sqlite");
    return fs.existsSync(file) ? { exists: true, size: fs.statSync(file).size } : { exists: false, size: 0 };
  });
  const populated = databases.findIndex((database) => database.size > 4096);
  if (populated !== -1) return directories[populated];
  const existing = databases.findIndex((database) => database.exists);
  return directories[existing === -1 ? 0 : existing];
}
