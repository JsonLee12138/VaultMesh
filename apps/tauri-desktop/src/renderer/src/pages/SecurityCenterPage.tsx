import { DesktopStartupCard } from '@/components/DesktopStartupCard';
import { DesktopBrowserIntegrationCard } from '@/components/DesktopBrowserIntegrationCard';
import { SecurityCenterMaintenanceCards } from './SecurityCenterMaintenanceCards';
import { SecurityCenterProtectionCards } from './SecurityCenterProtectionCards';
import { useSecurityCenterModel } from './security-center-model';
import { ArrowRightIcon, RadioTowerIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export function SecurityCenterPage() {
  const model = useSecurityCenterModel();
  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-8">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <DesktopStartupCard />
        <DesktopBrowserIntegrationCard />
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><RadioTowerIcon />附近设备</CardTitle>
            <CardDescription>仅在你手动开启时发现同一局域网中的 VaultMesh，并通过两端短码确认建立信任。</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <p className="text-sm text-muted-foreground">配对不解锁保险库，也不启用同步、分享、秘密传输或远程操作。</p>
          </CardContent>
          <CardFooter>
            <Button className="w-full" variant="outline" asChild>
              <a href="#/nearby">管理附近设备<ArrowRightIcon data-icon="inline-end" /></a>
            </Button>
          </CardFooter>
        </Card>
        <SecurityCenterProtectionCards model={model} />
        <SecurityCenterMaintenanceCards model={model} />
      </div>
    </section>
  );
}
