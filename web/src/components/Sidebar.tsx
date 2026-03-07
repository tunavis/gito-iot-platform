'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Home,
  Smartphone,
  BarChart3,
  FolderTree,
  LayoutGrid,
  Settings,
  ChevronRight,
  Activity,
} from 'lucide-react';
import ThemeToggle from '@/components/ui/ThemeToggle';

interface JwtUser {
  name: string;
  email: string;
  tenant_name?: string;
  role?: string;
}

function useCurrentUser(): JwtUser | null {
  const [user, setUser] = useState<JwtUser | null>(null);
  useEffect(() => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      setUser({
        name:        payload.name        || payload.full_name || payload.username || 'User',
        email:       payload.email       || '',
        tenant_name: payload.tenant_name || payload.organization || '',
        role:        payload.role        || '',
      });
    } catch {
      // token missing or malformed
    }
  }, []);
  return user;
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}
interface NavItem { label: string; href: string; }
type NavEntry = NavGroup | (NavItem & { icon: React.ReactNode; single: true });

function isSingle(e: NavEntry): e is NavItem & { icon: React.ReactNode; single: true } {
  return 'single' in e && (e as any).single === true;
}

export default function Sidebar() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Devices', 'Groups']));

  const toggleGroup = (label: string) => {
    const next = new Set(openGroups);
    next.has(label) ? next.delete(label) : next.add(label);
    setOpenGroups(next);
  };

  const navEntries: NavEntry[] = [
    { label: 'Home',         href: '/dashboard',           icon: <Home className="w-4 h-4" />,      single: true },
    { label: 'Analytics',    href: '/dashboard/analytics', icon: <BarChart3 className="w-4 h-4" />, single: true },
    {
      label: 'Devices',
      icon: <Smartphone className="w-4 h-4" />,
      items: [
        { label: 'All Devices',  href: '/dashboard/devices' },
        { label: 'Registration', href: '/dashboard/devices/new' },
        { label: 'Map',          href: '/dashboard/devices/map' },
        { label: 'Simulators',   href: '/dashboard/devices/simulators' },
      ],
    },
    {
      label: 'Groups',
      icon: <FolderTree className="w-4 h-4" />,
      items: [
        { label: 'Organizations', href: '/dashboard/organizations' },
        { label: 'Sites',         href: '/dashboard/sites' },
        { label: 'Device Groups', href: '/dashboard/device-groups' },
      ],
    },
    { label: 'Device Types', href: '/dashboard/device-types', icon: <LayoutGrid className="w-4 h-4" />, single: true },
    {
      label: 'Management',
      icon: <Settings className="w-4 h-4" />,
      items: [
        { label: 'Alarms',        href: '/dashboard/alarms' },
        { label: 'Alert Rules',   href: '/dashboard/alert-rules' },
        { label: 'Alert Routing', href: '/dashboard/notification-rules' },
        { label: 'Notifications', href: '/dashboard/notifications' },
        { label: 'Users',         href: '/dashboard/users' },
        { label: 'Audit Logs',    href: '/dashboard/audit-logs' },
        { label: 'Events',        href: '/dashboard/events' },
        { label: 'Settings',      href: '/dashboard/settings' },
      ],
    },
  ];

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-64 flex flex-col overflow-hidden z-50"
      style={{ background: 'var(--color-sidebar-bg)' }}
    >
      {/* Top accent gradient line */}
      <div
        className="h-[2px] w-full flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #2563eb 0%, #22d3ee 60%, transparent 100%)' }}
      />

      {/* Logo */}
      <div
        className="px-4 py-3.5 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-sidebar-border)' }}
      >
        <Image
          src="/images/GitoLogo.png"
          alt="Gito IoT Platform"
          width={110}
          height={33}
          style={{ maxHeight: '34px', width: 'auto', height: 'auto' }}
          className="brightness-0 invert opacity-90"
          priority
          unoptimized
        />
        <div
          className="pl-3"
          style={{ borderLeft: '1px solid var(--color-sidebar-border)' }}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] leading-tight" style={{ color: 'var(--color-sidebar-muted)' }}>IoT</p>
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] leading-tight" style={{ color: 'var(--color-sidebar-muted)' }}>Platform</p>
        </div>
        <div className="ml-auto">
          <div className="w-2 h-2 rounded-full bg-emerald-400 hmi-pulse shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <p
          className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--color-sidebar-muted)', opacity: 0.45 }}
        >
          Navigation
        </p>

        <ul className="space-y-0.5">
          {navEntries.map((entry) => {
            if (isSingle(entry)) {
              const isActive = pathname === entry.href;
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150"
                    style={{
                      color: isActive ? '#93c5fd' : 'var(--color-sidebar-muted)',
                      background: isActive ? 'rgba(37,99,235,0.12)' : 'transparent',
                      fontWeight: isActive ? 600 : 400,
                      boxShadow: isActive ? 'inset 3px 0 0 #3b82f6' : 'none',
                    }}
                  >
                    <span style={{ color: isActive ? '#60a5fa' : 'var(--color-sidebar-muted)' }}>
                      {entry.icon}
                    </span>
                    {entry.label}
                  </Link>
                </li>
              );
            }

            const group = entry as NavGroup;
            const isOpen = openGroups.has(group.label);
            const hasActiveChild = group.items.some(
              (c) => pathname === c.href || pathname?.startsWith(c.href + '/')
            );

            return (
              <li key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150"
                  style={{
                    color: hasActiveChild ? '#93c5fd' : 'var(--color-sidebar-muted)',
                    background: hasActiveChild ? 'rgba(37,99,235,0.1)' : 'transparent',
                    fontWeight: hasActiveChild ? 600 : 400,
                    boxShadow: hasActiveChild ? 'inset 3px 0 0 #3b82f6' : 'none',
                  }}
                >
                  <span style={{ color: hasActiveChild ? '#60a5fa' : 'var(--color-sidebar-muted)' }}>
                    {group.icon}
                  </span>
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronRight
                    className="w-3.5 h-3.5 transition-transform duration-200"
                    style={{
                      color: 'var(--color-sidebar-muted)',
                      opacity: 0.5,
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                    }}
                  />
                </button>

                {isOpen && (
                  <ul
                    className="mt-0.5 ml-3.5 pl-3 space-y-0.5"
                    style={{ borderLeft: '1px solid var(--color-sidebar-border)' }}
                  >
                    {group.items.map((sub) => {
                      const isActive = pathname === sub.href || pathname?.startsWith(sub.href + '/');
                      return (
                        <li key={sub.href}>
                          <Link
                            href={sub.href}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-all duration-150"
                            style={{
                              color: isActive ? '#93c5fd' : 'var(--color-sidebar-muted)',
                              background: isActive ? 'rgba(37,99,235,0.1)' : 'transparent',
                              fontWeight: isActive ? 500 : 400,
                            }}
                          >
                            {isActive && (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: '#3b82f6' }}
                              />
                            )}
                            {sub.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        {/* System status */}
        <div
          className="mt-4 pt-3"
          style={{ borderTop: '1px solid var(--color-sidebar-border)' }}
        >
          <p
            className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{ color: 'var(--color-sidebar-muted)', opacity: 0.45 }}
          >
            System
          </p>
          <div
            className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]"
            style={{ color: 'var(--color-sidebar-muted)' }}
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>All systems operational</span>
          </div>
        </div>
      </nav>

      {/* User footer */}
      <div
        className="px-3 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid var(--color-sidebar-border)' }}
      >
        <div className="flex items-center gap-2.5 mb-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}
          >
            {user ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '??'}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--color-sidebar-text)' }}
            >
              {user?.name ?? '—'}
            </p>
            <p
              className="text-[11px] truncate"
              style={{ color: 'var(--color-sidebar-muted)' }}
            >
              {user?.tenant_name || user?.email || ''}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <ThemeToggle />
          {user?.role && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
              style={{
                color: '#60a5fa',
                background: 'rgba(37,99,235,0.12)',
                border: '1px solid rgba(59,130,246,0.2)',
                letterSpacing: '0.05em',
              }}
            >
              {user.role}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}