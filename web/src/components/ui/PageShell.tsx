'use client';

import Sidebar from '@/components/Sidebar';
import TenantContextBanner from '@/components/TenantContextBanner';

interface PageShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export default function PageShell({ title, subtitle, icon, action, children }: PageShellProps) {
  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        {/* Tenant context banner (visible when management user is viewing a child tenant) */}
        <TenantContextBanner />
        {/* Frosted glass header */}
        <header className="gito-page-header flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {icon && (
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'rgba(37,99,235,0.1)',
                  border: '1px solid rgba(37,99,235,0.2)',
                  color: '#3b82f6',
                }}
              >
                {icon}
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold text-th-primary tracking-tight leading-tight">{title}</h1>
              {subtitle && (
                <p className="text-xs text-th-muted mt-0.5 font-medium">{subtitle}</p>
              )}
            </div>
          </div>
          {action && (
            <div className="flex items-center gap-2.5">{action}</div>
          )}
        </header>

        {/* Page content */}
        <div className="flex-1 p-6">
          {children}
        </div>
      </main>
    </div>
  );
}