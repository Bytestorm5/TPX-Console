import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

/**
 * The theme lives on `<html data-theme>` (set before paint by the inline
 * script in root.tsx) and in the `tpx_theme` cookie so SSR agrees with the
 * browser. The toggle subscribes to the attribute instead of holding state.
 */
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readTheme(): Theme {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === "light" || pinned === "dark") return pinned;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle({ initial }: { initial: Theme | null }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => initial ?? "light");
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `tpx_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
