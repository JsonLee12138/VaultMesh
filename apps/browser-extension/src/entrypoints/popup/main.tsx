import { createRoot } from "react-dom/client";

import "@/assets/tailwind.css";
import { Toaster } from "@/components/ui/sonner";
import { loadCachedPopupWorkspace } from "@/lib/popup-workspace";
import { PopupApp } from "./popup-app";

const root = document.getElementById("root");
if (!root) {
  throw new Error("VaultMesh popup root is missing.");
}

// Read the volatile background snapshot before React's first paint. Reading it
// from an effect would always render one skeleton frame, even on a cache hit.
const initialWorkspace = new URLSearchParams(window.location.search).get("tab") === "generator"
  ? null
  : await loadCachedPopupWorkspace();

createRoot(root).render(
  <>
    <PopupApp initialWorkspace={initialWorkspace} />
    <Toaster position="top-center" />
  </>,
);
