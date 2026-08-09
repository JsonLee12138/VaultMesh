import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  ...(process.env.VAULTMESH_BROWSER_PROFILE
    ? {
        webExt: {
          chromiumProfile: process.env.VAULTMESH_BROWSER_PROFILE,
          keepProfileChanges: true,
        },
      }
    : {}),
  manifest: {
    name: "VaultMesh",
    description: "Use VaultMesh securely from the browser popup.",
    minimum_chrome_version: "127",
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
    action: {
      default_icon: {
        "16": "icon-16.png",
        "32": "icon-32.png",
      },
    },
    permissions: ["activeTab", "alarms", "clipboardRead", "clipboardWrite", "contextMenus", "idle", "nativeMessaging", "notifications", "storage", "webAuthenticationProxy", "webNavigation"],
    host_permissions: ["http://*/*", "https://*/*"],
    commands: {
      "request-identity-fill": {
        description: "Fill this form with a selected VaultMesh item"
      }
    },
    ...(process.env.WXT_CHROME_EXTENSION_KEY
      ? { key: process.env.WXT_CHROME_EXTENSION_KEY }
      : {})
  },
  vite: () => ({
    plugins: [tailwindcss()]
  })
});
