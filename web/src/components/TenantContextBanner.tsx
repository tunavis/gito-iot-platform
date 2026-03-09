'use client';

import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useTenant } from './TenantContext';

/**
 * Persistent amber banner shown when a management tenant user is viewing
 * a child tenant's data. Cannot be dismissed — forces awareness.
 *
 * Placed in dashboard layout so it appears above every page.
 */
export default function TenantContextBanner() {
  const { isViewingChildTenant, activeTenantName, returnHome } = useTenant();

  if (!isViewingChildTenant) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-sm shrink-0">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>
          You are viewing <strong className="text-amber-300">{activeTenantName}</strong>
          {' '}— all data and actions apply to this tenant
        </span>
      </div>
      <button
        onClick={returnHome}
        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-medium transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Return to Gito
      </button>
    </div>
  );
}
