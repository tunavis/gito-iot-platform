'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Image from 'next/image';

interface NavGroup {
  label: string;
  icon: JSX.Element;
  items: NavItem[];
  defaultOpen?: boolean;
}

interface NavItem {
  label: string;
  href: string;
  icon?: JSX.Element;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Devices', 'Overviews']));

  const toggleGroup = (label: string) => {
    const newOpen = new Set(openGroups);
    if (newOpen.has(label)) {
      newOpen.delete(label);
    } else {
      newOpen.add(label);
    }
    setOpenGroups(newOpen);
  };

  const navGroups: (NavGroup | NavItem)[] = [
    {
      label: 'Home',
      href: '/dashboard',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    },
    {
      label: 'Devices',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
      items: [
        { label: 'Registration', href: '/dashboard/devices/new' },
        { label: 'All devices', href: '/dashboard/devices' },
        { label: 'Map', href: '/dashboard/devices/map' },
        { label: 'Simulators', href: '/dashboard/devices/simulators' }
      ]
    },
    {
      label: 'Analytics',
      href: '/dashboard/analytics',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
    },
    {
      label: 'Groups',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>,
      items: [
        { label: 'Organizations', href: '/dashboard/organizations' },
        { label: 'Sites', href: '/dashboard/sites' },
        { label: 'Device Groups', href: '/dashboard/device-groups' }
      ]
    },
    {
      label: 'Device types',
      href: '/dashboard/device-types',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
    },
    {
      label: 'Management',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
      items: [
        { label: 'Users', href: '/dashboard/users' },
        { label: 'Audit Logs', href: '/dashboard/audit-logs' },
        { label: 'Alarms', href: '/dashboard/alarms' },
        { label: 'Alert Rules', href: '/dashboard/alert-rules' },
        { label: 'Alert Routing', href: '/dashboard/notification-rules' },
        { label: 'Notifications', href: '/dashboard/notifications' },
        { label: 'Events', href: '/dashboard/events' },
        { label: 'Settings', href: '/dashboard/settings' }
      ]
    }
  ];

  const isNavGroup = (item: NavGroup | NavItem): item is NavGroup => {
    return 'items' in item;
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-gray-100 border-r border-gray-300 z-50 flex flex-col overflow-hidden">
      {/* Logo */}
      <div className="px-4 py-4 bg-white border-b border-gray-300">
        <div className="flex items-center gap-3">
          <Image
            src="/images/GitoLogo.png"
            alt="Gito IoT Platform"
            width={120}
            height={36}
            style={{ maxHeight: '40px', width: 'auto', height: 'auto' }}
            priority
            unoptimized
          />
          <div className="border-l border-gray-300 h-10"></div>
          <div>
            <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide leading-tight">Device</p>
            <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide leading-tight">Management</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="space-y-0.5">
          {navGroups.map((item) => {
            if (isNavGroup(item)) {
              const isOpen = openGroups.has(item.label);
              const hasActiveChild = item.items.some(child => 
                pathname === child.href || pathname?.startsWith(child.href + '/')
              );
              
              return (
                <li key={item.label}>
                  <button
                    onClick={() => toggleGroup(item.label)}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                      hasActiveChild 
                        ? 'bg-gray-200 text-gray-900 font-medium' 
                        : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <span className="text-gray-600">{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    <svg 
                      className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  
                  {isOpen && item.items.length > 0 && (
                    <ul className="bg-white border-t border-b border-gray-200">
                      {item.items.map((subItem) => {
                        const isActive = pathname === subItem.href || pathname?.startsWith(subItem.href + '/');
                        return (
                          <li key={subItem.href}>
                            <Link
                              href={subItem.href}
                              className={`flex items-center gap-2 px-4 py-2 pl-12 text-sm transition-colors ${
                                isActive
                                  ? 'bg-blue-50 text-blue-700 font-medium border-l-3 border-blue-600'
                                  : 'text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {subItem.icon && <span className="text-gray-500">{subItem.icon}</span>}
                              <span>{subItem.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            } else {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-gray-200 text-gray-900 font-medium'
                        : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <span className="text-gray-600">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            }
          })}
        </ul>
      </nav>

      {/* User Profile & Footer */}
      <div className="px-4 py-3 bg-white border-t border-gray-300">
        {/* User Info */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center">
            <span className="text-sm font-bold text-blue-700">AD</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">Admin User</p>
            <p className="text-xs text-gray-500">admin@gito.demo</p>
          </div>
          <button className="text-gray-500 hover:text-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
        </div>
        
        {/* Footer */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <span>powered by</span>
            <span className="font-semibold text-gray-700 uppercase tracking-wider">GITO IoT</span>
          </div>
          <div className="flex items-center justify-center gap-1 mt-1">
            {[...Array(7)].map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === 3 ? 'bg-blue-600' : 'bg-gray-400'}`}></div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
