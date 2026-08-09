import { useEffect, useState } from "react";
import { KeyRoundIcon, RefreshCwIcon } from "lucide-react";

import { ToastMessage } from "@/components/ToastMessage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SaveCaptureDecisionResponseSchema, SaveCapturePendingResponseSchema, type SaveCaptureQueuedResponse } from "@/lib/protocol";
import { saveCaptureCountdown } from "@/lib/save-capture-countdown";
import { saveCapturePromptActionLabel, saveCapturePromptTitle } from "@/lib/save-capture-prompt";

export function SaveConfirmationApp() {
  const [prompt, setPrompt] = useState<SaveCaptureQueuedResponse | null>(null);
  const [countdown, setCountdown] = useState(() => saveCaptureCountdown(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let loaded = false;
    let attempts = 0;
    const load = async () => {
      attempts += 1;
      const response = SaveCapturePendingResponseSchema.safeParse(
        await browser.runtime.sendMessage({ kind: "vaultmesh.save-capture-window.get" }).catch(() => null),
      );
      if (!active) return;
      if (response.success && response.data.status === "queued") {
        loaded = true;
        setPrompt(response.data);
        return;
      }
      if (attempts >= 40) window.close();
    };
    void load();
    const retry = setInterval(() => { if (!loaded) void load(); }, 50);
    return () => { active = false; clearInterval(retry); };
  }, []);

  useEffect(() => {
    if (!prompt) {
      setCountdown(saveCaptureCountdown(0));
      return;
    }
    const update = () => setCountdown(saveCaptureCountdown(prompt.expiresAt));
    update();
    const countdownTimer = setInterval(update, 100);
    const timeout = setTimeout(() => void decide("ignore"), Math.max(0, prompt.expiresAt - Date.now()));
    return () => { clearInterval(countdownTimer); clearTimeout(timeout); };
  }, [prompt?.captureId, prompt?.expiresAt]);

  async function decide(decision: "save" | "ignore") {
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    const response = SaveCaptureDecisionResponseSchema.safeParse(await browser.runtime.sendMessage({
      kind: "vaultmesh.save-capture-window.decision",
      decision,
    }).catch(() => null));
    if (!response.success) {
      setBusy(false);
      setError("无法连接 VaultMesh 扩展后台。");
      return;
    }
    if (["saved", "discarded", "expired"].includes(response.data.status)) {
      window.close();
      return;
    }
    if (response.data.status === "unsupported-page" || response.data.status === "failed") {
      setBusy(false);
      setError(response.data.status === "failed" ? "保存失败。请解锁 VaultMesh 后重新登录。" : "此确认窗口已经失效。");
    }
  }

  if (!prompt) {
    return <main className="grid h-full place-items-center bg-background text-foreground"><div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCwIcon className="animate-spin" size={16} />正在读取待保存信息…</div></main>;
  }

  return (
    <main className="h-full w-full bg-background text-foreground">
      <Card className="h-full w-full rounded-none py-0 ring-0">
        <CardContent className="flex h-full flex-col gap-2 p-3">
          <div className="flex items-start gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><KeyRoundIcon size={17} /></span>
            <div className="min-w-0 space-y-0.5">
              <h1 className="text-base font-semibold leading-tight">{saveCapturePromptTitle(prompt)}</h1>
              <p className="truncate text-xs text-muted-foreground">{prompt.hostname} · {prompt.labels.join("、")}</p>
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full origin-left bg-primary transition-transform duration-100 ease-linear" style={{ transform: `scaleX(${countdown.progress})` }} /></div>
          <ToastMessage id="save-confirmation-error" message={error} variant="error" />
          <div className="mt-auto flex justify-end gap-1.5">
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void decide("ignore")}>忽略</Button>
            <Button type="button" size="xs" disabled={busy} autoFocus onClick={() => void decide("save")}>{busy ? "正在处理…" : saveCapturePromptActionLabel(prompt)}</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
