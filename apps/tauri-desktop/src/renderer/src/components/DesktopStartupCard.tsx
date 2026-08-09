import { useEffect, useState } from 'react';
import { PowerIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import type { DesktopStartupSettings } from '../../../shared/contracts';

export function DesktopStartupCard() {
  const [settings, setSettings] = useState<DesktopStartupSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async (): Promise<void> => {
    setSettings(await window.vaultMesh.desktop.startupSettings());
  };

  useEffect(() => {
    void reload().catch((reason) => {
      toast.error(reason instanceof Error ? reason.message : '无法读取登录时启动设置。');
    });
  }, []);

  const update = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    try {
      const updated = await window.vaultMesh.desktop.updateStartupSettings({ enabled });
      setSettings(updated);
      toast.success(enabled ? '已启用登录时启动。' : '已关闭登录时启动。');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '登录时启动设置更新失败。');
      try {
        await reload();
      } catch {
        // Keep the last confirmed state when the OS cannot be queried either.
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PowerIcon />系统启动</CardTitle>
        <CardDescription>让 VaultMesh 在你登录电脑后保持可用。</CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="desktop-start-on-login">登录时启动 VaultMesh</FieldLabel>
            <FieldDescription>启动后保持锁定并静默进入系统托盘，不会弹出主窗口。</FieldDescription>
          </FieldContent>
          <Switch
            id="desktop-start-on-login"
            checked={settings?.enabled ?? false}
            disabled={busy || settings === null}
            onCheckedChange={(enabled) => void update(enabled)}
          />
        </Field>
      </CardContent>
    </Card>
  );
}
