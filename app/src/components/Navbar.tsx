import { Newspaper, FileText, History, Server, Radio, Settings, Building2, ScrollText, Layers, HardDrive, Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Role } from '@/services/hdApi';
import { tr } from '@/lib/i18n';

export type TabId = 'news' | 'my-stack' | 'technologies' | 'assets' | 'agents' | 'generate' | 'history' | 'channels' | 'settings' | 'admin' | 'logs';

interface TabConfig {
  id: TabId;
  label: string;
  icon: ReactNode;
  roles?: Role[];
}

const tabs: TabConfig[] = [
  { id: 'news', label: 'News Feed', icon: <Newspaper size={16} /> },
  { id: 'my-stack', label: 'My Stack', icon: <Server size={16} /> },
  { id: 'technologies', label: 'Technologies', icon: <Layers size={16} /> },
  { id: 'assets', label: 'Assets', icon: <HardDrive size={16} /> },
  { id: 'agents', label: 'Agents', icon: <Bot size={16} /> },
  { id: 'generate', label: 'Generate Post', icon: <FileText size={16} /> },
  { id: 'history', label: 'History', icon: <History size={16} /> },
  { id: 'channels', label: 'Channels', icon: <Radio size={16} />, roles: ['admin', 'superadmin'] },
  /* Company, AI and users only: members have nothing to see there. */
  { id: 'settings', label: 'Settings', icon: <Settings size={16} />, roles: ['admin', 'superadmin'] },
  { id: 'admin', label: 'Companies', icon: <Building2 size={16} />, roles: ['superadmin'] },
  { id: 'logs', label: 'Logs', icon: <ScrollText size={16} />, roles: ['superadmin'] },
];

export function tabsForRole(role: Role | undefined): TabId[] {
  return tabs.filter((t) => !t.roles || (role && t.roles.includes(role))).map((t) => t.id);
}

interface NavbarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  role?: Role;
}

export default function Navbar({ activeTab, onTabChange, role }: NavbarProps) {
  const visible = tabs.filter((t) => !t.roles || (role && t.roles.includes(role)));
  return (
    <nav className="flex items-center h-14 min-w-0 overflow-x-auto bg-bg-primary shrink" aria-label={tr("Main")}>
      <div className="flex items-center gap-0.5">
        {visible.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              title={tr(tab.label)}
              className={`
                relative flex items-center gap-2 px-2.5 xl:px-3 py-2 text-[15px] font-semibold font-rajdhani tracking-wide whitespace-nowrap
                transition-colors duration-200 ease-out cursor-pointer
                ${isActive ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'}
              `}
            >
              {tab.icon}
              {/* Ten tabs don't fit with labels on a laptop screen: below ~1760 px
                  only the active tab shows its label (the rest: icon + tooltip). */}
              <span className={isActive ? 'hidden xl:inline' : 'hidden min-[1760px]:inline'}>{tr(tab.label)}</span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
