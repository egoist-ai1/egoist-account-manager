import codexLogoUrl from "../assets/codex-color.svg";
import antigravityLogoUrl from "../assets/antigravity-icon.png";

export function PlatformMark({ platform, size = "small" }: {
  platform: "codex" | "antigravity";
  size?: "small" | "large" | "tile" | "micro";
}) {
  const antigravity = platform === "antigravity";
  return (
    <span className={`platform-mark ${platform} ${size}`} aria-hidden="true" title={antigravity ? "Antigravity" : "Codex"}>
      <img src={antigravity ? antigravityLogoUrl : codexLogoUrl} alt="" />
    </span>
  );
}
