'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  device_count: number;
  user_count: number;
  active_alarms: number;
}

interface TenantContextValue {
  /** The tenant ID to use in all API calls (may differ from JWT's tenant_id when switched) */
  activeTenantId: string | null;
  /** Display name of the active tenant */
  activeTenantName: string | null;
  /** True when viewing a child tenant (not the home management tenant) */
  isViewingChildTenant: boolean;
  /** Switch to viewing a specific child tenant */
  switchToTenant: (tenant: TenantInfo) => void;
  /** Return to the home (management) tenant */
  returnHome: () => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const TenantContext = createContext<TenantContextValue>({
  activeTenantId: null,
  activeTenantName: null,
  isViewingChildTenant: false,
  switchToTenant: () => {},
  returnHome: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function TenantProvider({ children }: { children: ReactNode }) {
  const [activeTenant, setActiveTenant] = useState<TenantInfo | null>(null);

  const switchToTenant = useCallback((tenant: TenantInfo) => {
    setActiveTenant(tenant);
  }, []);

  const returnHome = useCallback(() => {
    setActiveTenant(null);
  }, []);

  return (
    <TenantContext.Provider
      value={{
        activeTenantId: activeTenant?.id ?? null,
        activeTenantName: activeTenant?.name ?? null,
        isViewingChildTenant: activeTenant !== null,
        switchToTenant,
        returnHome,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTenant() {
  return useContext(TenantContext);
}

/**
 * Returns the effective tenant ID for API calls.
 * If a child tenant is active, returns its ID.
 * Otherwise falls back to the JWT tenant_id.
 *
 * Usage in any page:
 *   const tenantId = useEffectiveTenantId();
 *   fetch(`/api/v1/tenants/${tenantId}/devices`, ...)
 */
export function useEffectiveTenantId(): string | null {
  const { activeTenantId } = useTenant();

  if (activeTenantId) return activeTenantId;

  // Fall back to JWT tenant_id
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.tenant_id as string;
  } catch {
    return null;
  }
}
