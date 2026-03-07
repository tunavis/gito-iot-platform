'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { Pencil, Trash2, MapPin } from 'lucide-react';
import { btn, input } from '@/components/ui/buttonStyles';

interface Site {
  id: string;
  tenant_id: string;
  organization_id: string;
  parent_site_id: string | null;
  name: string;
  site_type: string | null;
  address: string | null;
  coordinates: { lat: number; lng: number } | null;
  timezone: string;
  attributes: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface Organization {
  id: string;
  name: string;
}

export default function SitesPage() {
  const toast = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');

  const loadData = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    // Load organizations
    const orgRes = await fetch(`/api/v1/tenants/${tenant}/organizations?page=1&per_page=100`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (orgRes.ok) {
      const orgJson = await orgRes.json();
      setOrganizations(orgJson.data || []);
    }

    // Load sites
    const url = selectedOrg === 'all'
      ? `/api/v1/tenants/${tenant}/sites?page=1&per_page=100`
      : `/api/v1/tenants/${tenant}/sites?organization_id=${selectedOrg}&page=1&per_page=100`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.ok) {
      const json = await res.json();
      setSites(json.data || []);
    }
    setLoading(false);
  }, [selectedOrg]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteSite = async (id: string) => {
    const ok = await toast.confirm('Are you sure you want to delete this site? This will affect all associated devices.', { title: 'Delete Site', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const res = await fetch(`/api/v1/tenants/${tenant}/sites/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.ok) {
      setSites(prev => prev.filter(s => s.id !== id));
    }
  };

  const getOrgName = (orgId: string) => {
    const org = organizations.find(o => o.id === orgId);
    return org ? org.name : orgId;
  };

  const getParentSiteName = (siteId: string | null) => {
    if (!siteId) return null;
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : siteId;
  };

  return (
    <PageShell
      title="Sites"
      subtitle="Manage physical locations and hierarchies"
      action={
        <button onClick={() => setShowNewForm(true)} className={`${btn.primary} flex items-center gap-2`}>
          <MapPin className="w-4 h-4" />New Site
        </button>
      }
    >

      <div className="gito-card p-4 mb-4">
        <div className="flex items-center gap-4">
          <select value={selectedOrg} onChange={e => setSelectedOrg(e.target.value)} className={input.select} style={{ width: 'auto' }}>
            <option value="all">All Organizations</option>
            {organizations.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
      </div>

      {showNewForm && (
        <SiteForm
          organizations={organizations}
          sites={sites}
          onSuccess={() => {
            setShowNewForm(false);
            loadData();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {editingSite && (
        <SiteForm
          site={editingSite}
          organizations={organizations}
          sites={sites}
          onSuccess={() => {
            setEditingSite(null);
            loadData();
          }}
          onCancel={() => setEditingSite(null)}
        />
      )}

      <div className="gito-card overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
          <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Organization</div>
            <div className="col-span-2">Parent Site</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-2">Address</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-th-secondary">Loading...</div>
          ) : sites.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-th-secondary">
              No sites found. Click &quot;New Site&quot; to create one.
            </div>
          ) : (
            sites.map(site => (
              <div key={site.id} className="px-6 py-4 hover:bg-panel transition-colors">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-th-primary">{site.name}</p>
                    <p className="text-xs text-th-muted mt-0.5">{site.timezone}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-th-primary">{getOrgName(site.organization_id)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-th-muted">
                      {site.parent_site_id ? getParentSiteName(site.parent_site_id) : '—'}
                    </span>
                  </div>
                  <div className="col-span-1">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(37,99,235,0.08)', color: 'var(--color-primary-600)', border: '1px solid rgba(37,99,235,0.15)' }}>
                      {site.site_type || 'Default'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-th-muted">{site.address || '—'}</span>
                  </div>
                  <div className="col-span-2 flex gap-1 justify-end">
                    <button onClick={() => setEditingSite(site)} className={btn.icon} title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteSite(site.id)} className={btn.iconDanger} title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}

function SiteForm({ 
  site,
  organizations,
  sites,
  onSuccess, 
  onCancel 
}: { 
  site?: Site;
  organizations: Organization[];
  sites: Site[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    organization_id: site?.organization_id || '',
    parent_site_id: site?.parent_site_id || '',
    name: site?.name || '',
    site_type: site?.site_type || '',
    address: site?.address || '',
    timezone: site?.timezone || 'UTC',
    coordinates_lat: site?.coordinates?.lat || '',
    coordinates_lng: site?.coordinates?.lng || ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const payload: any = {
      organization_id: formData.organization_id,
      parent_site_id: formData.parent_site_id || null,
      name: formData.name,
      site_type: formData.site_type || null,
      address: formData.address || null,
      timezone: formData.timezone
    };

    if (formData.coordinates_lat && formData.coordinates_lng) {
      payload.coordinates = {
        lat: parseFloat(formData.coordinates_lat as any),
        lng: parseFloat(formData.coordinates_lng as any)
      };
    }
    
    const url = site 
      ? `/api/v1/tenants/${tenant}/sites/${site.id}`
      : `/api/v1/tenants/${tenant}/sites`;
    
    const method = site ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      onSuccess();
    }
  };

  return (
    <div className="gito-card p-6 mb-4">
      <h3 className="text-lg font-bold text-th-primary mb-1">{site ? 'Edit Site' : 'Create New Site'}</h3>
      <p className="text-sm text-th-secondary mb-5">{site ? 'Update site details' : 'Add a new physical location'}</p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Organization *</label>
            <select required value={formData.organization_id} onChange={e => setFormData(prev => ({ ...prev, organization_id: e.target.value, parent_site_id: '' }))} className={input.select}>
              <option value="">Select organization...</option>
              {organizations.map(org => (<option key={org.id} value={org.id}>{org.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Parent Site</label>
            <select value={formData.parent_site_id} onChange={e => setFormData(prev => ({ ...prev, parent_site_id: e.target.value }))} className={`${input.select} disabled:opacity-50`} disabled={!formData.organization_id}>
              <option value="">None (Top Level)</option>
              {sites.filter(s => s.id !== site?.id && s.organization_id === formData.organization_id).map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Site Name *</label>
            <input type="text" required value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} className={input.base} placeholder="Building A" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Site Type</label>
            <input type="text" value={formData.site_type} onChange={e => setFormData(prev => ({ ...prev, site_type: e.target.value }))} className={input.base} placeholder="warehouse, office, factory..." />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Address</label>
            <input type="text" value={formData.address} onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))} className={input.base} placeholder="123 Main St, City, Country" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Latitude</label>
            <input type="number" step="any" value={formData.coordinates_lat} onChange={e => setFormData(prev => ({ ...prev, coordinates_lat: e.target.value }))} className={input.base} placeholder="51.5074" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Longitude</label>
            <input type="number" step="any" value={formData.coordinates_lng} onChange={e => setFormData(prev => ({ ...prev, coordinates_lng: e.target.value }))} className={input.base} placeholder="-0.1278" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Timezone</label>
            <input type="text" value={formData.timezone} onChange={e => setFormData(prev => ({ ...prev, timezone: e.target.value }))} className={input.base} placeholder="UTC, America/New_York..." />
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>{site ? 'Update' : 'Create'} Site</button>
        </div>
      </form>
    </div>
  );
}
