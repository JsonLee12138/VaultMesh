import { applyAssignments, discoverFields, documentHttpOrigin, type SupportedControl } from "@/lib/form-discovery";
import { startAutofillPage } from "@/lib/autofill-page";
import { createContentScriptMessageSender, registerContentScriptMessageListener } from "@/lib/content-script-messaging";
import { startInlineTotpCapture } from "@/lib/inline-totp-capture";
import { detectPageInformationWithQr, scanTotpQrCodes } from "@/lib/page-information-capture";
import { ContentMessageSchema, SaveCaptureReadyMessageSchema, type ContentMessage } from "@/lib/protocol";
import { createUuid } from "@/lib/uuid";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: "document_idle",
  main(ctx) {
    const documentId = createUuid();
    const frameOrigin = documentHttpOrigin(document);
    let fields = new Map<string, SupportedControl>();
    const sendMessage = createContentScriptMessageSender(
      (message) => browser.runtime.sendMessage(message),
      () => ctx.abort("Extension context invalidated"),
    );
    const autofillPage = startAutofillPage(document, documentId, sendMessage);
    const inlineTotpCapture = startInlineTotpCapture(document, documentId, sendMessage, () => {
      void autofillPage.refreshOtpCandidates();
      autofillPage.scan();
    });

    const onMessage = (message: unknown) => {
      const readyPrompt = SaveCaptureReadyMessageSchema.safeParse(message);
      if (readyPrompt.success) {
        return { status: autofillPage.showPendingCapture(readyPrompt.data.prompt) ? "shown" as const : "ignored" as const };
      }
      const parsed = ContentMessageSchema.safeParse(message);
      if (!parsed.success) {
        return undefined;
      }
      if (parsed.data.kind === "vaultmesh.autofill-rescan") {
        autofillPage.scan();
        return { status: "rescanning" };
      }
      if (parsed.data.kind === "vaultmesh.detect-page-information") {
        const pageUrl = document.defaultView?.location.href ?? "";
        if (!isHttpPage(pageUrl)) return { status: "unsupported-page" as const };
        return detectPageInformationWithQr(document, pageUrl).then((detected) => detected
          ? { status: "detected" as const, captureId: createUuid(), ...detected }
          : { status: "empty" as const, pageUrl });
      }
      if (parsed.data.kind === "vaultmesh.scan-totp-qr") {
        const pageUrl = document.defaultView?.location.href ?? "";
        if (!isHttpPage(pageUrl)) return { status: "unsupported-page" as const };
        return scanTotpQrCodes(document).then((values) => values.length
          ? { status: "found" as const, values }
          : { status: "empty" as const });
      }
      if (parsed.data.kind === "vaultmesh.save-page-information") {
        const pageUrl = document.defaultView?.location.href ?? "";
        if (!sameHttpOrigin(parsed.data.pageUrl, pageUrl)) return { status: "unsupported-page" as const };
        return sendMessage({
          kind: "vaultmesh.save-capture-confirmed",
          captureId: parsed.data.captureId,
          pageUrl: parsed.data.pageUrl,
          pageContext: "unknown",
          data: parsed.data.data,
        });
      }

      if (parsed.data.kind === "vaultmesh.apply-assignments" && parsed.data.selectedItem) {
        const assignedControls = parsed.data.assignments
          .map((assignment) => fields.get(assignment.handle))
          .filter((control): control is SupportedControl => Boolean(control));
        autofillPage.recordFilledItem(parsed.data.selectedItem, assignedControls);
      }

      return handleMessage(parsed.data, documentId, fields, frameOrigin).then((result) => {
        if (parsed.data.kind === "vaultmesh.discover-fields") {
          fields = result.fields;
          return result.response;
        }

        fields.clear();
        return result.response;
      });
    };
    ctx.onInvalidated(() => {
      autofillPage.dispose();
      inlineTotpCapture.dispose();
      fields.clear();
      try {
        browser.runtime.onMessage.removeListener(onMessage);
      } catch {
        // The runtime API itself is unavailable after an extension reload.
      }
    });
    registerContentScriptMessageListener(
      (listener) => browser.runtime.onMessage.addListener(listener),
      onMessage,
      () => ctx.abort("Extension context invalidated"),
    );
  },
});

async function handleMessage(
  message: ContentMessage,
  documentId: string,
  fields: Map<string, SupportedControl>,
  frameOrigin: string,
) {
  if (message.kind === "vaultmesh.discover-fields") {
    const discovered = discoverFields(document);
    return {
      fields: discovered.handles,
      response: {
        documentId,
        frameOrigin,
        fields: discovered.descriptors,
      },
    };
  }

  if (message.kind === "vaultmesh.autofill-rescan") return { fields, response: { status: "rescanning" } };
  if (message.kind === "vaultmesh.detect-page-information" || message.kind === "vaultmesh.scan-totp-qr" || message.kind === "vaultmesh.save-page-information") {
    return { fields, response: { status: "unsupported-page" } };
  }

  return {
    fields,
    response: await applyAssignments({
      message,
      documentId,
      fields,
      currentOrigin: frameOrigin,
    }),
  };
}

function isHttpPage(pageUrl: string): boolean {
  try { return ["http:", "https:"].includes(new URL(pageUrl).protocol); } catch { return false; }
}

function sameHttpOrigin(expectedUrl: string, currentUrl: string): boolean {
  try {
    const expected = new URL(expectedUrl);
    const current = new URL(currentUrl);
    return ["http:", "https:"].includes(current.protocol) && expected.origin === current.origin;
  } catch {
    return false;
  }
}
