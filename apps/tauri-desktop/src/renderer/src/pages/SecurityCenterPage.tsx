import { DesktopStartupCard } from '@/components/DesktopStartupCard';
import { DesktopBrowserIntegrationCard } from '@/components/DesktopBrowserIntegrationCard';
import { SecurityCenterMaintenanceCards } from './SecurityCenterMaintenanceCards';
import { SecurityCenterProtectionCards } from './SecurityCenterProtectionCards';
import { useSecurityCenterModel } from './security-center-model';

export function SecurityCenterPage() {
  const model = useSecurityCenterModel();
  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-8">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <DesktopStartupCard />
        <DesktopBrowserIntegrationCard />
        <SecurityCenterProtectionCards model={model} />
        <SecurityCenterMaintenanceCards model={model} />
      </div>
    </section>
  );
}
