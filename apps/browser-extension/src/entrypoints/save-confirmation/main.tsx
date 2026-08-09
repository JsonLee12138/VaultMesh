import { createRoot } from "react-dom/client";

import "./styles.css";
import { SaveConfirmationApp } from "./save-confirmation-app";

const root = document.getElementById("root");
if (!root) throw new Error("VaultMesh save confirmation root is missing.");

createRoot(root).render(<SaveConfirmationApp />);
