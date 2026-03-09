'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import {
  Building2, MapPin, Layers, Cpu, ChevronRight, ChevronDown,
  Bell, Wifi, Search, GitBranch, AlertTriangle, CheckCircle2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeviceGroupNode {
  id: string;
  name: string;
  group_type: string | null;
  device_count: number;
  online_count: number;
  active_alarms: number;
}

interface SiteNode {
  id: string;
  name: string;
  site_type: string | null;
  address: string | null;
  coordinates: { lat: number; lng: number } | null;
  device_count: number;
  online_count: number;
  active_alarms: number;
  device_groups: DeviceGroupNode[];
  children: SiteNode[];
}

interface OrgNode {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'suspended';
  billing_contact: string | null;
  device_count: number;
  online_count: number;
  active_alarms: number;
  sites: SiteNode[];
}

type SelectedNode =
  | { type: 'org';   data: OrgNode }
  | { type: 'site';  data: SiteNode }
  | { type: 'group'; data: DeviceGroupNode };

// ── Health helpers ─────────────────────────────────────────────────────────────

function healthColor(alarms: number, online: number, total: number): string {
  if (alarms > 0)                         return '#ef4444';   // red
  if (total > 0 && online / total < 0.8)  return '#f59e0b';   // amber
  return '#22c55e';                                            // green
}

function HealthDot({ alarms, online, total }: { alarms: number; online: number; total: number }) {
  const color = healthColor(alarms, online, total);
  return (
    <span
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: color, boxShadow: `0 0 5px ${color}60` }}
    />
  );
}

function AlarmBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
      style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
    >
      {count}
    </span>
  );
}

// ── Tree node components ───────────────────────────────────────────────────────

function GroupNode({
  group, selected, onSelect,
}: {
  group: DeviceGroupNode;
  selected: SelectedNode | null;
  onSelect: (n: SelectedNode) => void;
}) {
  const isSelected = selected?.type === 'group' && selected.data.id === group.id;
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[12px] transition-colors"
      style={{
        background: isSelected ? 'var(--color-sidebar-active)' : 'transparent',
        color: isSelected ? 'var(--color-sidebar-active-text)' : 'var(--color-text-secondary)',
      }}
      onClick={() => onSelect({ type: 'group', data: group })}
    >
      <HealthDot alarms={group.active_alarms} online={group.online_count} total={group.device_count} />
      <Layers className="w-3 h-3 flex-shrink-0 opacity-60" />
      <span className="flex-1 truncate">{group.name}</span>
      <span className="text-[10px] opacity-50 flex-shrink-0">{group.online_count}/{group.device_count}</span>
      <AlarmBadge count={group.active_alarms} />
    </div>
  );
}

function SiteNodeTree({
  site, depth, selected, onSelect,
}: {
  site: SiteNode;
  depth: number;
  selected: SelectedNode | null;
  onSelect: (n: SelectedNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isSelected = selected?.type === 'site' && selected.data.id === site.id;
  const hasChildren = site.children.length > 0 || site.device_groups.length > 0;

  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[12px] transition-colors"
        style={{
          background: isSelected ? 'var(--color-sidebar-active)' : 'transparent',
          color: isSelected ? 'var(--color-sidebar-active-text)' : 'var(--color-text-secondary)',
        }}
        onClick={() => { onSelect({ type: 'site', data: site }); if (hasChildren) setOpen(o => !o); }}
      >
        <HealthDot alarms={site.active_alarms} online={site.online_count} total={site.device_count} />
        {hasChildren
          ? open
            ? <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-50" />
            : <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-50" />
          : <span className="w-3 h-3 flex-shrink-0" />
        }
        <MapPin className="w-3 h-3 flex-shrink-0 opacity-60" />
        <span className="flex-1 truncate">{site.name}</span>
        <span className="text-[10px] opacity-50 flex-shrink-0">{site.online_count}/{site.device_count}</span>
        <AlarmBadge count={site.active_alarms} />
      </div>

      {open && hasChildren && (
        <div className="ml-3 pl-2.5" style={{ borderLeft: '1px solid var(--color-border)' }}>
          {site.device_groups.map(g => (
            <GroupNode key={g.id} group={g} selected={selected} onSelect={onSelect} />
          ))}
          {site.children.map(child => (
            <SiteNodeTree key={child.id} site={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgNodeTree({
  org, selected, onSelect,
}: {
  org: OrgNode;
  selected: SelectedNode | null;
  onSelect: (n: SelectedNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const isSelected = selected?.type === 'org' && selected.data.id === org.id;

  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer text-[13px] font-medium transition-colors"
        style={{
          background: isSelected ? 'var(--color-sidebar-active)' : 'var(--color-panel)',
          color: isSelected ? 'var(--color-sidebar-active-text)' : 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
        }}
        onClick={() => { onSelect({ type: 'org', data: org }); setOpen(o => !o); }}
      >
        <HealthDot alarms={org.active_alarms} online={org.online_count} total={org.device_count} />
        {open
          ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
          : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
        }
        <Building2 className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
        <span className="flex-1 truncate">{org.name}</span>
        <span className="text-[11px] opacity-50 flex-shrink-0 font-normal">{org.online_count}/{org.device_count}</span>
        <AlarmBadge count={org.active_alarms} />
      </div>

      {open && org.sites.length > 0 && (
        <div className="mt-1 ml-2 pl-3" style={{ borderLeft: '1px solid var(--color-border)' }}>
          {org.sites.map(site => (
            <SiteNodeTree key={site.id} site={site} depth={0} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}

      {open && org.sites.length === 0 && (
        <p className="ml-5 mt-1 text-[11px] italic" style={{ color: 'var(--color-text-muted)' }}>No sites configured</p>
      )}
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function DetailPanel({ node }: { node: SelectedNode | null }) {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--color-text-muted)' }}>
        <GitBranch className="w-10 h-10 opacity-20" />
        <p className="text-sm">Select a node to see details</p>
      </div>
    );
  }

  const StatRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
    </div>
  );

  if (node.type === 'org') {
    const { data: org } = node;
    const healthColor_ = healthColor(org.active_alarms, org.online_count, org.device_count);
    return (
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <Building2 className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />
          </div>
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <MapPin className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />
          </div>
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
          {site.address && <StatRow label="Address" value={<span className="text-right max-w-[180px] truncate">{site.address}</span>} />}
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <Layers className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />
          </div>
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
  const healthyOrgs   = orgs.filter(o => o.active_alarms === 0).length;

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {[
        { label: 'Clients',      value: totalOrgs,    icon: <Building2 className="w-4 h-4" />,      color: '#3b82f6' },
        { label: 'Devices',      value: totalDevices, icon: <Cpu className="w-4 h-4" />,             color: '#8b5cf6' },
        { label: 'Online',       value: totalOnline,  icon: <Wifi className="w-4 h-4" />,            color: '#22c55e' },
        { label: 'Active Alarms',value: totalAlarms,  icon: <Bell className="w-4 h-4" />,            color: totalAlarms > 0 ? '#ef4444' : '#22c55e' },
      ].map(({ label, value, icon, color }) => (
        <div key={label} className="gito-card p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${color}18`, color }}>
            {icon}
          </div>
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

  // Filter tree by search term (name match anywhere in tree)
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
            {/* ── Left: tree ────────────────────────────────────────────── */}
            <div className="gito-card flex flex-col flex-shrink-0 overflow-hidden" style={{ width: 300 }}>
              {/* Search */}
              <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="relative">
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

              {/* Tree */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {filteredOrgs.length === 0 ? (
                  <div className="text-center py-8">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
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
                  filteredOrgs.map(org => (
                    <OrgNodeTree key={org.id} org={org} selected={selected} onSelect={setSelected} />
                  ))
                )}
              </div>
            </div>

            {/* ── Right: detail ─────────────────────────────────────────── */}
            <div className="gito-card flex-1 overflow-y-auto">
              <DetailPanel node={selected} />
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
