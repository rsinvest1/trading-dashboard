import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, CalendarDays, ListOrdered, NotebookPen, Settings, TrendingUp, ListChecks
} from 'lucide-react';

const links = [
  { to: '/',           label: 'Dashboard',  Icon: LayoutDashboard },
  { to: '/playbook',   label: 'Playbook',   Icon: BookOpen },
  { to: '/strategies', label: 'Strategies', Icon: ListChecks },
  { to: '/calendar',   label: 'Calendar',   Icon: CalendarDays },
  { to: '/trades',     label: 'Trade Log',  Icon: ListOrdered },
  { to: '/journal',    label: 'Journal',    Icon: NotebookPen },
  { to: '/settings',   label: 'Settings',   Icon: Settings }
];

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-bg-border bg-bg-card flex flex-col">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-bg-border">
        <TrendingUp size={20} className="text-accent-green" />
        <span className="font-semibold tracking-tight">Trading Journal</span>
      </div>
      <nav className="flex-1 py-3">
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-bg-hover text-accent-green border-l-2 border-accent-green'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-l-2 border-transparent'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-3 border-t border-bg-border text-xs text-text-muted">
        v0.1 · localStorage
      </div>
    </aside>
  );
}
