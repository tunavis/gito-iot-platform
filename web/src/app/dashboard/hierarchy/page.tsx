'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import IconTile from '@/components/ui/IconTile';
import { healthColor } from '@/components/ui/HealthIndicators';
import type {
  DeviceGroupNode,
  OrgNode,
  SelectedNode,
  SiteNode,
} from '@/components/flow/hierarchyGraph';
import { Building2, MapPin, Layers, Cpu, Bell, Wifi, Search, GitBranch } from 'lucide-react';

// @xyflow/react is ~50KB gzipped — keep it out of the shared chunk.
const HierarchyCanvas = dynamic(() => import('@/components/flow/HierarchyCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div
        className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{ borderColor: 'var(--color-border)', borderTopColor: '#3b82f6' }}
      />
    </div>
  ),
});

// ── Detail panel ───────────────────────────────────────────────────────────────

function DetailPanel({ node }: { node: SelectedNode | null }) {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--color-text-muted)' }}>
        <IconTile color="#64748b" icon={<GitBranch className="w-5 h-5" />} />
        <p className="text-sm">Select a node to see details</p>
      </div>
    );
  }

  // The value truncates rather than widening the card. It has to carry
  // `min-w-0` and be a flex child for that to work — `truncate` on a nested
  // inline <span> does nothing, which is what pushed long addresses out of the
  // panel and gave it a horizontal scrollbar.
  const StatRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span
        className="text-sm font-medium min-w-0 truncate text-right"
        style={{ color: 'var(--color-text-primary)' }}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  );

  if (node.type === 'org') {
    const { data: org } = node;
    const healthColor_ = healthColor(org.active_alarms, org.online_count, org.device_count);
    return (
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <IconTile color="#64748b" icon={<Building2 className="w-5 h-5" />} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{org.name}</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{
                background: org.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.12)',
                color: org.status === 'active' ? '#22c55e' : 'var(--color-text-muted)',
              }}>
              {org.status}
            </span>
          </div>
        </div>

        <div className="gito-card p-4 space-y-1">
          <StatRow label="Health" value={
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: healthColor_ }} />
              {org.active_alarms > 0 ? `${org.active_alarms} active alarm${org.active_alarms > 1 ? 's' : ''}` : 'Healthy'}
            </span>
          } />
          <StatRow label="Devices" value={`${org.online_count} online / ${org.device_count} total`} />
          <StatRow label="Sites" value={org.sites.length} />
          {org.billing_contact && <StatRow label="Billing Contact" value={org.billing_contact} />}
        </div>

        <Link
          href="/dashboard/organizations"
          className="text-xs"
          style={{ color: 'var(--color-sidebar-active-text)' }}
        >
          Manage organization →
        </Link>
      </div>
    );
  }

  if (node.type === 'site') {
    const { data: site } = node;
    return (
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <IconTile color="#64748b" icon={<MapPin className="w-5 h-5" />} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{site.name}</h2>
            {site.site_type && (
              <span className="text-[11px] capitalize" style={{ color: 'var(--color-text-muted)' }}>{site.site_type}</span>
            )}
          </div>
        </div>

        <div className="gito-card p-4 space-y-1">
          <StatRow label="Devices" value={`${site.online_count} online / ${site.device_count} total`} />
          <StatRow label="Device Groups" value={site.device_groups.length} />
          <StatRow label="Active Alarms" value={
            site.active_alarms > 0
              ? <span style={{ color: '#ef4444' }}>{site.active_alarms}</span>
              : <span style={{ color: '#22c55e' }}>None</span>
          } />
          {site.address && <StatRow label="Address" value={site.address} />}
          {site.coordinates && (
            <StatRow label="Coordinates" value={`${site.coordinates.lat.toFixed(4)}, ${site.coordinates.lng.toFixed(4)}`} />
          )}
        </div>

        <Link href="/dashboard/sites" className="text-xs" style={{ color: 'var(--color-sidebar-active-text)' }}>
          Manage sites →
        </Link>
      </div>
    );
  }

  if (node.type === 'group') {
    const { data: group } = node;
    const pct = group.device_count > 0 ? Math.round((group.online_count / group.device_count) * 100) : 0;
    return (
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <IconTile color="#64748b" icon={<Layers className="w-5 h-5" />} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{group.name}</h2>
            {group.group_type && (
              <span className="text-[11px] capitalize" style={{ color: 'var(--color-text-muted)' }}>{group.group_type}</span>
            )}
          </div>
        </div>

        <div className="gito-card p-4 space-y-1">
          <StatRow label="Devices" value={`${group.online_count} online / ${group.device_count} total`} />
          <StatRow label="Online %" value={
            <span style={{ color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444', fontFamily: 'var(--font-mono)' }}>
              {pct}%
            </span>
          } />
          <StatRow label="Active Alarms" value={
            group.active_alarms > 0
              ? <span style={{ color: '#ef4444' }}>{group.active_alarms}</span>
              : <span style={{ color: '#22c55e' }}>None</span>
          } />
        </div>

        <Link href="/dashboard/device-groups" className="text-xs" style={{ color: 'var(--color-sidebar-active-text)' }}>
          Manage device groups →
        </Link>
      </div>
    );
  }

  return null;
}

// ── Summary stats ──────────────────────────────────────────────────────────────

function SummaryBar({ orgs }: { orgs: OrgNode[] }) {
  const totalDevices  = orgs.reduce((s, o) => s + o.device_count,  0);
  const totalOnline   = orgs.reduce((s, o) => s + o.online_count,  0);
  const totalAlarms   = orgs.reduce((s, o) => s + o.active_alarms, 0);
  const totalOrgs     = orgs.length;

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {[
        { label: 'Clients',      value: totalOrgs,    icon: <Building2 className="w-4 h-4" />,      color: '#3b82f6' },
        { label: 'Devices',      value: totalDevices, icon: <Cpu className="w-4 h-4" />,             color: '#8b5cf6' },
        { label: 'Online',       value: totalOnline,  icon: <Wifi className="w-4 h-4" />,            color: '#22c55e' },
        { label: 'Active Alarms',value: totalAlarms,  icon: <Bell className="w-4 h-4" />,            color: totalAlarms > 0 ? '#ef4444' : '#22c55e' },
      ].map(({ label, value, icon, color }) => (
        <div key={label} className="gito-card p-4 flex items-center gap-3">
          <IconTile color={color} icon={icon} size="sm" />
          <div>
            <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</p>
            <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HierarchyPage() {
  const [orgs, setOrgs]       = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<SelectedNode | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    fetch(`/api/v1/tenants/${tenant}/hierarchy`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { setOrgs(data.organizations ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Filter by search term. The canvas is built from this, so dropping a node
  // drops its edges structurally — nothing can point at something undrawn.
  const filteredOrgs = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return orgs;

    function filterGroups(gs: DeviceGroupNode[]): DeviceGroupNode[] {
      return gs.filter(g => g.name.toLowerCase().includes(q));
    }
    function filterSites(ss: SiteNode[]): SiteNode[] {
      return ss
        .map(s => ({
          ...s,
          device_groups: filterGroups(s.device_groups),
          children: filterSites(s.children),
        }))
        .filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.device_groups.length > 0 ||
          s.children.length > 0
        );
    }
    return orgs
      .map(o => ({ ...o, sites: filterSites(o.sites) }))
      .filter(o => o.name.toLowerCase().includes(q) || o.sites.length > 0);
  }, [orgs, search]);

  return (
    <PageShell title="Asset Tree" subtitle="Client and deployment hierarchy overview">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--color-border)', borderTopColor: '#3b82f6' }} />
        </div>
      ) : (
        <>
          <SummaryBar orgs={orgs} />

          <div className="flex gap-4" style={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>
            {/* ── Left: canvas ──────────────────────────────────────────── */}
            <div className="gito-card flex flex-col flex-1 overflow-hidden">
              {/* Search */}
              <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="relative" style={{ maxWidth: 320 }}>
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                    style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full text-sm rounded-lg py-1.5 pl-8 pr-3 outline-none"
                    style={{
                      background: 'var(--color-page)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </div>
              </div>

              {/* Graph — min-h-0 gives the canvas a real height inside the flex column.
                  React Flow measures the DOM; a zero-height parent renders blank. */}
              <div className="flex-1 min-h-0">
                {filteredOrgs.length === 0 ? (
                  <div className="text-center py-8">
                    <IconTile color="#64748b" icon={<Building2 className="w-4 h-4" />} size="sm" className="mx-auto mb-2" />
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {search ? 'No matches found' : 'No clients configured'}
                    </p>
                    {!search && (
                      <Link href="/dashboard/organizations" className="text-xs mt-1 block"
                        style={{ color: 'var(--color-sidebar-active-text)' }}>
                        Add an organisation →
                      </Link>
                    )}
                  </div>
                ) : (
                  <HierarchyCanvas orgs={filteredOrgs} selected={selected} onSelect={setSelected} />
                )}
              </div>
            </div>

            {/* ── Right: detail ─────────────────────────────────────────── */}
            <div className="gito-card overflow-y-auto overflow-x-hidden flex-shrink-0" style={{ width: 320 }}>
              <DetailPanel node={selected} />
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
