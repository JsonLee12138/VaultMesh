import { ApprovedFillSchema, type ApprovedFill, type FillRequest } from "@/lib/protocol";
import { desktopRpc, DesktopRpcError } from "@/lib/desktop-rpc";

export type NativeSubmission =
  | { status: "approved"; approval: ApprovedFill }
  | { status: "cancelled" | "unlock-required" }
  | { status: "desktop-unavailable" };

/**
 * This client forwards only value-free field descriptors and receives an
 * origin/document-bound one-time assignment payload after approval. This is
 * retained only for compatibility with the legacy desktop-approval transport.
 */
export async function submitDiscovery(request: FillRequest): Promise<NativeSubmission> {
  try {
    const approval = ApprovedFillSchema.parse(await desktopRpc("browser.fill.request", { discovery: request }));
    return { status: "approved", approval };
  } catch (error) {
    if (error instanceof DesktopRpcError) {
      if (error.code === "unlock-required") return { status: "unlock-required" };
      if (error.code === "cancelled" || error.code === "request-expired") return { status: "cancelled" };
    }
    return { status: "desktop-unavailable" };
  }
}
