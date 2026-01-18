'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

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
  const [sites, setSites] = useState<Site[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');

  useEffect(() => {
    loadData();
  }, [selectedOrg]);

  const loadData = async () => {
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
  };

  const deleteSite = async (id: string) => {
    if (!confirm('Are you sure you want to delete this site? This will affect all associated devices.')) return;
    
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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sites</h1>
          <p className="text-sm text-gray-600">Manage physical locations and hierarchies</p>
        </div>
        <button 
          onClick={() => setShowNewForm(true)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + New Site
        </button>
      </div>

      <div className="bg-white rounded border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Filter by Organization</label>
            <select 
              value={selectedOrg} 
              onChange={e => setSelectedOrg(e.target.value)} 
              className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white"
            >
              <option value="all">All Organizations</option>
              {organizations.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
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

      <div className="bg-white rounded border border-gray-200">
        <div className="border-b border-gray-200 px-6 py-3">
          <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Organization</div>
            <div className="col-span-2">Parent Site</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-2">Address</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">Loading...</div>
          ) : sites.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">
              No sites found. Click &quot;New Site&quot; to create one.
            </div>
          ) : (
            sites.map(site => (
              <div key={site.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-gray-900">{site.name}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{site.timezone}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-700">{getOrgName(site.organization_id)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-600">
                      {site.parent_site_id ? getParentSiteName(site.parent_site_id) : '—'}
                    </span>
                  </div>
                  <div className="col-span-1">
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                      {site.site_type || 'Default'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-600">{site.address || '—'}</span>
                  </div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <button 
                      onClick={() => setEditingSite(site)}
                      className="px-3 py-1 text-xs font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => deleteSite(site.id)}
                      className="px-3 py-1 text-xs font-medium rounded bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </main>
    </div>
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
    <div className="bg-white border border-gray-200 rounded p-6 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {site ? 'Edit Site' : 'Create New Site'}
      </h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Organization *</label>
            <select
              required
              value={formData.organization_id}
              onChange={e => setFormData(prev => ({ ...prev, organization_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
            >
              <option value="">Select organization...</option>
              {organizations.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Parent Site</label>
            <select
              value={formData.parent_site_id}
              onChange={e => setFormData(prev => ({ ...prev, parent_site_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
            >
              <option value="">None (Top Level)</option>
              {sites.filter(s => s.id !== site?.id).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Site Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="Building A"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Site Type</label>
            <input
              type="text"
              value={formData.site_type}
              onChange={e => setFormData(prev => ({ ...prev, site_type: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="warehouse, office, factory..."
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="123 Main St, City, Country"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Latitude</label>
            <input
              type="number"
              step="any"
              value={formData.coordinates_lat}
              onChange={e => setFormData(prev => ({ ...prev, coordinates_lat: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="51.5074"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Longitude</label>
            <input
              type="number"
              step="any"
              value={formData.coordinates_lng}
              onChange={e => setFormData(prev => ({ ...prev, coordinates_lng: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="-0.1278"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Timezone</label>
            <input
              type="text"
              value={formData.timezone}
              onChange={e => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="UTC, America/New_York..."
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button 
            type="submit"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {site ? 'Update' : 'Create'} Site
          </button>
        </div>
      </form>
    </div>
  );
}
