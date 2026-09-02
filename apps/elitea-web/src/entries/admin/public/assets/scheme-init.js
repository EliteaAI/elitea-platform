// First-paint colour scheme (ADR-0024 WP3; spec §4.2). Runs before the bundle:
// reads the persisted mode MUI keeps under `el-mode`, resolves `system` via
// the OS preference, and stamps `data-el-scheme` on <html> so the first frame
// already matches the stylesheet MUI will emit. Default: dark.
//
// Keep in step with `index.html` (inline) — `src/app/schemeInit.test.ts` pins
// the two bodies equal. The admin entry loads it as a file because its CSP
// hash-pins exactly one inline script (adminui/handler.go).
{
  let mode = "dark";
  try {
    const stored = localStorage.getItem("el-mode");
    if (stored === "light" || stored === "dark") {
      mode = stored;
    } else if (stored === "system") {
      mode = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  } catch {
    // Storage or matchMedia unavailable: keep the default.
  }
  document.documentElement.setAttribute("data-el-scheme", mode);
}
