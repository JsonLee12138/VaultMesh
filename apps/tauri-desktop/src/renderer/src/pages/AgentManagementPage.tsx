import { SecurityCenterProtectionCards } from './SecurityCenterProtectionCards';
import { useSecurityCenterModel } from './security-center-model';

export function AgentManagementPage() {
  const model = useSecurityCenterModel();

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-8">
      <SecurityCenterProtectionCards model={model} agentPage />
    </section>
  );
}
