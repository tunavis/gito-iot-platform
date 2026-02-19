'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import { useToast } from '@/components/ToastProvider';

interface DeviceGroup {
  id: string;
  tenant_id: string;
  organization_id: string;
  site_id: string;
  name: string;
  description: string | null;
  group_type: string | null;
  membership_rule: Record<string, any>;
  attributes: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface Organization {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  organization_id: string;
}

export default function DeviceGroupsPage() {
  const toast = useToast();
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DeviceGroup | null>(null);
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
    const siteRes = await fetch(`/api/v1/tenants/${tenant}/sites?page=1&per_page=100`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (siteRes.ok) {
      const siteJson = await siteRes.json();
      setSites(siteJson.data || []);
    }

    // Load device groups
    const url = selectedOrg === 'all'
      ? `/api/v1/tenants/${tenant}/device-groups?page=1&per_page=100`
      : `/api/v1/tenants/${tenant}/device-groups?organization_id=${selectedOrg}&page=1&per_page=100`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.ok) {
      const json = await res.json();
      setGroups(json.data || []);
    }
    setLoading(false);
  }, [selectedOrg]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteGroup = async (id: string) => {
    const ok = await toast.confirm('Are you sure you want to delete this device group?', { title: 'Delete Group', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const res = await fetch(`/api/v1/tenants/${tenant}/device-groups/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.ok) {
      setGroups(prev => prev.filter(g => g.id !== id));
    }
  };

  const getOrgName = (orgId: string | null) => {
    if (!orgId) return '—';
    const org = organizations.find(o => o.id === orgId);
    return org ? org.name : orgId;
  };

  const getSiteName = (siteId: string | null) => {
    if (!siteId) return '—';
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : siteId;
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Device Groups</h1>
          <p className="text-sm text-gray-600">Organize devices for bulk operations and management</p>
        </div>
        <button 
          onClick={() => setShowNewForm(true)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + New Device Group
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
        <DeviceGroupForm
          organizations={organizations}
          sites={sites}
          onSuccess={() => {
            setShowNewForm(false);
            loadData();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {editingGroup && (
        <DeviceGroupForm
          group={editingGroup}
          organizations={organizations}
          sites={sites}
          onSuccess={() => {
            setEditingGroup(null);
            loadData();
          }}
          onCancel={() => setEditingGroup(null)}
        />
      )}

      <div className="bg-white rounded border border-gray-200">
        <div className="border-b border-gray-200 px-6 py-3">
          <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Organization</div>
            <div className="col-span-2">Site</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-2">Description</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">Loading...</div>
          ) : groups.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">
              No device groups found. Click &quot;New Device Group&quot; to create one.
            </div>
          ) : (
            groups.map(group => (
              <div key={group.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-700">{getOrgName(group.organization_id)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-600">{getSiteName(group.site_id)}</span>
                  </div>
                  <div className="col-span-1">
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                      {group.group_type || 'Default'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-600">{group.description || '—'}</span>
                  </div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <button 
                      onClick={() => setEditingGroup(group)}
                      className="px-3 py-1 text-xs font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => deleteGroup(group.id)}
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

function DeviceGroupForm({
  group,
  organizations,
  sites,
  onSuccess,
  onCancel
}: {
  group?: DeviceGroup;
  organizations: Organization[];
  sites: Site[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || '',
    organization_id: group?.organization_id || '',
    site_id: group?.site_id || '',
    group_type: group?.group_type || ''
  });

  // Cascade: org → filter sites
  const filteredSites = formData.organization_id
    ? sites.filter(s => s.organization_id === formData.organization_id)
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.organization_id || !formData.site_id) {
      toast.warning('Validation', 'Organization and Site are required.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const payload = {
      name: formData.name,
      description: formData.description || null,
      organization_id: formData.organization_id,
      site_id: formData.site_id,
      group_type: formData.group_type || null
    };
    
    const url = group 
      ? `/api/v1/tenants/${tenant}/device-groups/${group.id}`
      : `/api/v1/tenants/${tenant}/device-groups`;
    
    const method = group ? 'PUT' : 'POST';
    
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
        {group ? 'Edit Device Group' : 'Create New Device Group'}
      </h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Group Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="Production Sensors"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Group Type</label>
            <input
              type="text"
              value={formData.group_type}
              onChange={e => setFormData(prev => ({ ...prev, group_type: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="static, dynamic, test..."
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              rows={2}
              placeholder="Optional description..."
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Organization <span className="text-red-500">*</span></label>
            <select
              value={formData.organization_id}
              onChange={e => setFormData(prev => ({ ...prev, organization_id: e.target.value, site_id: '' }))}
              className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
              required
            >
              <option value="">Select organization...</option>
              {organizations.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Site <span className="text-red-500">*</span></label>
            <select
              value={formData.site_id}
              onChange={e => setFormData(prev => ({ ...prev, site_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
              disabled={!formData.organization_id}
              required
            >
              <option value="">{formData.organization_id ? 'Select site...' : 'Select organization first'}</option>
              {filteredSites.map(site => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
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
            {group ? 'Update' : 'Create'} Device Group
          </button>
        </div>
      </form>
    </div>
  );
}
