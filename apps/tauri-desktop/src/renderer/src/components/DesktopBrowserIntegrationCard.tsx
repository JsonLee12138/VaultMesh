import { useEffect, useState } from 'react';
import { CableIcon, RotateCwIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DesktopBrowserIntegrationStatus } from '../../../shared/contracts';

const errorMessages: Record<NonNullable<DesktopBrowserIntegrationStatus['errorCode']>, string> = {
  'pairing-unavailable': '无法读取或创建浏览器配对凭据。',
  'broker-unavailable': '浏览器 RPC Broker 无法启动。',
  'listener-unavailable': 'Windows 浏览器通信管道无法启动。',
  'listener-stopped': 'Windows 浏览器通信管道已经停止。',
  'host-missing': '安装包中缺少 Browser Native Host。',
  'registration-unavailable': '无法注册 Chrome/Edge Browser Native Host。',
  'identity-invalid': '扩展 ID 构建配置无效。',
};

export function DesktopBrowserIntegrationCard() {
  const [status, setStatus] = useState<DesktopBrowserIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.vaultMesh.desktop.browserIntegrationStatus()
      .then(setStatus)
      .catch((reason) => {
        toast.error(reason instanceof Error ? reason.message : '无法读取浏览器集成状态。');
      });
  }, []);

  if (status && !status.supported) return null;

  const retry = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.vaultMesh.desktop.retryBrowserIntegration();
      setStatus(next);
      if (next.ready) toast.success('Chrome/Edge 插件连接服务已就绪。');
      else toast.error(next.errorCode ? errorMessages[next.errorCode] : '浏览器集成仍不可用。');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '浏览器集成重试失败。');
    } finally {
      setBusy(false);
    }
  };

  const summary = status?.ready
    ? 'Chrome/Edge 插件连接服务已就绪。'
    : status?.errorCode
      ? errorMessages[status.errorCode]
      : '正在检查 Windows 浏览器连接服务…';

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CableIcon />浏览器连接</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status?.supported ? (
          <div className="space-y-1 text-muted-foreground">
            <p>通信管道：{status.brokerReady ? '正常' : '不可用'}</p>
            <p>Chrome/Edge Host：{status.hostRegistered ? '已注册' : '未注册'}</p>
            <p className="break-all">扩展 ID：{status.extensionId || '配置无效'}</p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={busy || status === null}
          onClick={() => void retry()}
        >
          <RotateCwIcon className={busy ? 'animate-spin' : undefined} />
          重新检查并修复
        </Button>
      </CardContent>
    </Card>
  );
}
