import { useAuth } from '@/lib/auth';
import StackManager from './StackManager';
import AssetManager from './AssetManager';
import { PageHeader } from './ui';
import { tr } from '@/lib/i18n';

/* The company's technology stack and its assets, each on its own tab (they
   grow long once populated). Members see both read-only. */

function useCanEdit(): boolean {
  const { me } = useAuth();
  return me?.user.role === 'admin' || me?.user.role === 'superadmin';
}

export function TechnologiesTab({ onChanged }: { onChanged?: () => void }) {
  const { me } = useAuth();
  return (
    <div className="max-w-6xl mx-auto pb-12">
      <PageHeader
        title={`${me?.activeTenant?.name ?? tr('Company')} · ${tr('Technologies')}`}
        subtitle={tr('The software and services the company runs. News is matched against this list on My Stack and in the channel digests.')}
      />
      <StackManager canEdit={useCanEdit()} onChanged={onChanged} />
    </div>
  );
}

export function AssetsTab({ onChanged }: { onChanged?: () => void }) {
  const { me } = useAuth();
  return (
    <div className="max-w-6xl mx-auto pb-12">
      <PageHeader
        title={`${me?.activeTenant?.name ?? tr('Company')} · ${tr('Assets')}`}
        subtitle={tr('Servers, devices, apps and services, with the technologies each one runs, so news can say which assets it affects.')}
      />
      <AssetManager canEdit={useCanEdit()} onChanged={onChanged} />
    </div>
  );
}
