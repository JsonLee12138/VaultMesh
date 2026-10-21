import { useEffect, useRef, useState, type ReactNode } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { LockKeyholeIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { desktopRpc } from "@/lib/desktop-rpc";
import { authenticatePopup, biometricStatusSchema } from "@/lib/popup-biometric";

type Phase = "idle" | "biometric" | "authenticating" | "loading";
export function PopupUnlockPage({ hasVault, onUnlocked, notice }: { hasVault: boolean; onUnlocked: () => Promise<boolean>; notice?: (busy: boolean) => ReactNode }) {
  const [credential, setCredential] = useState("");
  const [useMasterPassword, setUseMasterPassword] = useState(false);
  const [biometric, setBiometric] = useState<{ available: boolean; enabled: boolean } | null>(null);
  const [pin, setPin] = useState<{ enabled: boolean; locked: boolean; remainingAttempts: number } | null>(null);
  const defaultMessage = hasVault ? "在插件中解锁本机保险库。" : "尚未创建保险库，请先在 VaultMesh 桌面端创建。";
  const [message, setMessage] = useState(defaultMessage);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const autoAttempted = useRef(false);
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;
  function changePhase(next: Phase) { phaseRef.current = next; setPhase(next); }
  function cancelBiometric(markAttempted = true) {
    if (markAttempted) autoAttempted.current = true;
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (mounted.current && phaseRef.current === "biometric") changePhase("idle");
  }
  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (hasVault) {
      void desktopRpc("pin.status").then((next) => { if (active) setPin(next as typeof pin); }).catch(() => undefined);
      void desktopRpc("biometric.status").then((next) => {
        if (!active) return;
        const status = biometricStatusSchema.parse(next);
        setBiometric(status);
        if (status.available && status.enabled && !autoAttempted.current && !document.hidden && phaseRef.current === "idle") {
          autoAttempted.current = true;
          void unlockWithBiometrics();
        }
      }).catch(() => undefined);
    }
    const hide = () => { if (document.hidden) { cancelBiometric(); setCredential(""); } };
    const close = () => { cancelBiometric(); setCredential(""); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", close);
    return () => {
      active = false;
      mounted.current = false;
      cancelBiometric(false);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", close);
    };
  }, [hasVault]);
  const pinPreferred = Boolean(pin?.enabled && !pin.locked && !useMasterPassword);
  const busy = phase === "authenticating" || phase === "loading";
  async function unlock(providedValue?: string) {
    if (phaseRef.current === "authenticating" || phaseRef.current === "loading") return;
    cancelBiometric();
    const version = generation.current;
    const value = providedValue ?? credential;
    setCredential(""); changePhase("authenticating");
    let completed = false;
    try {
      if (pinPreferred) await desktopRpc("pin.unlock", { pin: value });
      else await desktopRpc("vault.unlock", { masterPassword: value });
      if (!mounted.current || version !== generation.current) return;
      changePhase("loading"); completed = await onUnlockedRef.current();
      if (!completed && mounted.current) setMessage("验证已完成，但保险库状态发生变化，请重试。");
    } catch (error) {
      if (mounted.current && version === generation.current) {
        setMessage(error instanceof Error ? error.message : "解锁失败，请重试。");
        if (pinPreferred) void desktopRpc("pin.status").then((next) => { if (mounted.current) setPin(next as typeof pin); }).catch(() => undefined);
      }
    } finally { if (!completed && mounted.current && version === generation.current) changePhase("idle"); }
  }
  async function unlockWithBiometrics() {
    if (phaseRef.current !== "idle") return;
    autoAttempted.current = true;
    const current = new AbortController();
    controller.current = current;
    const version = ++generation.current;
    setCredential(""); setMessage(defaultMessage); changePhase("biometric");
    let completed = false;
    try {
      await authenticatePopup(current.signal);
      if (!mounted.current || current.signal.aborted || version !== generation.current) return;
      changePhase("loading"); completed = await onUnlockedRef.current();
      if (!completed && mounted.current) setMessage("验证已完成，但保险库状态发生变化，请重试。");
    } catch (error) {
      if (mounted.current && !current.signal.aborted && version === generation.current) setMessage(error instanceof Error ? error.message : "Touch ID 验证未完成，请重试或使用 PIN／主密码。");
    } finally {
      if (controller.current === current) controller.current = null;
      if (!completed && mounted.current && version === generation.current) changePhase("idle");
    }
  }
  const progressText = phase === "biometric" ? "正在等待 Touch ID…" : phase === "authenticating" ? "正在安全验证…" : phase === "loading" ? "验证成功，正在读取保险库…" : null;
  return (
    <main className="flex h-full w-full items-center p-3">
      <Card className="w-full"><CardContent className="flex flex-col gap-3">
        <span className="grid size-12 place-items-center rounded-xl bg-muted"><LockKeyholeIcon /></span>
        {notice?.(busy)}
        <div>
          <h1 className="text-lg font-semibold">{hasVault ? "解锁 VaultMesh 插件" : "创建 VaultMesh 保险库"}</h1>
          <p className="text-sm text-muted-foreground">{
            phase === "biometric" ? "请在系统弹窗中使用 Touch ID 验证。"
              : message !== defaultMessage ? message
              : pinPreferred ? `输入 6 位插件 PIN 后自动解锁，还可尝试 ${pin?.remainingAttempts ?? 0} 次。`
              : pin?.locked ? "插件 PIN 已锁定，请使用主密码解锁。" : message
          }</p>
        </div>
        {hasVault ? <>
          {pinPreferred ? (
            <InputOTP value={credential} maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoComplete="off"
              pushPasswordManagerStrategy="none" autoFocus disabled={busy} containerClassName="justify-center"
              aria-label="6 位插件 PIN" onChange={(value) => { autoAttempted.current = true; setCredential(value); }}
              onComplete={(value) => void unlock(value)}>
              <InputOTPGroup><InputOTPSlot index={0} mask /><InputOTPSlot index={1} mask /><InputOTPSlot index={2} mask /></InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup><InputOTPSlot index={3} mask /><InputOTPSlot index={4} mask /><InputOTPSlot index={5} mask /></InputOTPGroup>
            </InputOTP>
          ) : (
            <input className="h-10 rounded-md border border-input bg-background px-3 text-sm" type="password"
              inputMode="text" maxLength={1_024} value={credential} autoFocus disabled={busy}
              onChange={(event) => { autoAttempted.current = true; setCredential(event.target.value); }}
              onKeyDown={(event) => { if (event.key === "Enter" && credential.length >= 8 && !busy) void unlock(); }}
              placeholder="主密码（至少 8 位）" />
          )}
          <div className={`flex min-h-5 items-center justify-center gap-2 text-sm text-muted-foreground transition-opacity duration-150 ${progressText ? "opacity-100" : "opacity-0"}`} role="status" aria-live="polite">
            {progressText ? <><RefreshCwIcon className="animate-spin" size={16} aria-hidden="true" /><span>{progressText}</span></> : null}
          </div>
          {phase === "biometric" && !pinPreferred ? <Button variant="ghost" onClick={() => { cancelBiometric(); setCredential(""); setUseMasterPassword(true); }}>取消 Touch ID</Button> : null}
          {!pinPreferred ? <Button disabled={busy || credential.length < 8} onClick={() => void unlock()}>{phase === "authenticating" ? "正在安全验证…" : phase === "loading" ? "正在读取保险库…" : "使用主密码解锁插件"}</Button> : null}
          {pin?.enabled && !pin.locked ? <Button variant="secondary" disabled={phase === "loading" || phase === "authenticating"} onClick={() => { cancelBiometric(); setCredential(""); setUseMasterPassword(pinPreferred); }}>{pinPreferred ? "改用主密码" : "改用 PIN"}</Button> : null}
          {biometric?.available && biometric.enabled ? <Button variant="secondary" disabled={phase !== "idle"} onClick={() => void unlockWithBiometrics()}>{phase === "biometric" ? "正在等待系统验证…" : "使用 Touch ID 解锁插件"}</Button> : null}
        </> : null}
      </CardContent></Card>
    </main>
  );
}
