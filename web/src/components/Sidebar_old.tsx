'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Image from 'next/image';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const navItems: NavItem[] = [
    { label: 'Overview', href: '/dashboard', icon: '📊' },
    { label: 'Devices', href: '/dashboard/devices', icon: '📱' },
    { label: 'Live Monitor', href: '/dashboard/monitor', icon: '📡' },
    { label: 'Analytics', href: '/dashboard/analytics', icon: '📈' },
    { label: 'Alerts', href: '/dashboard/alerts', icon: '🔔', badge: 0 },
    { label: 'Infrastructure', href: '/dashboard/infrastructure', icon: '🌐' },
    { label: 'Settings', href: '/dashboard/settings', icon: '⚙️' },
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      } z-50 flex flex-col shadow-lg`}
    >
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          {!collapsed ? (
            <div className="flex-1 flex justify-center pr-8">
              <Image
                src="/images/GitoLogo.png"
                alt="Gito IT Solutions"
                width={200}
                height={60}
                className="h-14 w-auto object-contain"
                priority
                unoptimized
              />
            </div>
          ) : (
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              G
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 font-medium">{item.label}</span>
                      {item.badge !== undefined && (
                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-red-500 text-white">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Info */}
      <div className="p-4 border-t border-gray-200">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold">
            A
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">Admin User</p>
              <p className="text-xs text-gray-500 truncate">admin@gito.demo</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

