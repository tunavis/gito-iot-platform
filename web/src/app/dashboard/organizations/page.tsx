'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { useToast } from '@/components/ToastProvider';

interface Organization {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  billing_contact: string | null;
  chirpstack_app_id: string | null;
  status: 'active' | 'inactive' | 'suspended';
  attributes: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export default function OrganizationsPage() {
  const toast = useToast();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const res = await fetch(`/api/v1/tenants/${tenant}/organizations?page=1&per_page=100`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.ok) {
      const json = await res.json();
      setOrganizations(json.data || []);
    }
    setLoading(false);
  };

  const deleteOrganization = async (id: string) => {
    const ok = await toast.confirm('Are you sure you want to delete this organization? This will affect all associated sites and devices.', { title: 'Delete Organization', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const res = await fetch(`/api/v1/tenants/${tenant}/organizations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.ok) {
      setOrganizations(prev => prev.filter(o => o.id !== id));
    }
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-gray-100 text-gray-600',
      suspended: 'bg-red-100 text-red-700'
    };
    return colors[status] || 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Organizations</h1>
          <p className="text-sm text-gray-600">Manage sub-customers and organizational units</p>
        </div>
        <button 
          onClick={() => setShowNewForm(true)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + New Organization
        </button>
      </div>

      {showNewForm && (
        <OrganizationForm
          onSuccess={() => {
            setShowNewForm(false);
            loadOrganizations();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {editingOrg && (
        <OrganizationForm
          organization={editingOrg}
          onSuccess={() => {
            setEditingOrg(null);
            loadOrganizations();
          }}
          onCancel={() => setEditingOrg(null)}
        />
      )}

      <div className="bg-white rounded border border-gray-200">
        <div className="border-b border-gray-200 px-6 py-3">
          <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Slug</div>
            <div className="col-span-3">Billing Contact</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1">Created</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">Loading...</div>
          ) : organizations.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">
              No organizations found. Click &quot;New Organization&quot; to create one.
            </div>
          ) : (
            organizations.map(org => (
              <div key={org.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-gray-900">{org.name}</p>
                    {org.description && (
                      <p className="text-xs text-gray-600 mt-0.5">{org.description}</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-mono text-gray-700">{org.slug}</span>
                  </div>
                  <div className="col-span-3">
                    <span className="text-sm text-gray-600">{org.billing_contact || '—'}</span>
                  </div>
                  <div className="col-span-1">
                    <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${statusColor(org.status)}`}>
                      {org.status}
                    </span>
                  </div>
                  <div className="col-span-1">
                    <span className="text-xs text-gray-600">{new Date(org.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <button 
                      onClick={() => setEditingOrg(org)}
                      className="px-3 py-1 text-xs font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => deleteOrganization(org.id)}
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

function OrganizationForm({ 
  organization, 
  onSuccess, 
  onCancel 
}: { 
  organization?: Organization;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: organization?.name || '',
    slug: organization?.slug || '',
    description: organization?.description || '',
    billing_contact: organization?.billing_contact || '',
    chirpstack_app_id: organization?.chirpstack_app_id || '',
    status: organization?.status || 'active'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const url = organization 
      ? `/api/v1/tenants/${tenant}/organizations/${organization.id}`
      : `/api/v1/tenants/${tenant}/organizations`;
    
    const method = organization ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(formData)
    });
    
    if (res.ok) {
      onSuccess();
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {organization ? 'Edit Organization' : 'Create New Organization'}
      </h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Organization Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Slug *</label>
            <input
              type="text"
              required
              disabled={!!organization}
              value={formData.slug}
              onChange={e => setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
              className="w-full px-3 py-2 border border-gray-300 rounded disabled:bg-gray-100"
              placeholder="acme-corp"
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
            <label className="block text-sm text-gray-600 mb-1">Billing Contact</label>
            <input
              type="email"
              value={formData.billing_contact}
              onChange={e => setFormData(prev => ({ ...prev, billing_contact: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="billing@acme.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">ChirpStack App ID</label>
            <input
              type="text"
              value={formData.chirpstack_app_id}
              onChange={e => setFormData(prev => ({ ...prev, chirpstack_app_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="Optional"
            />
          </div>
          {organization && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          )}
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
            {organization ? 'Update' : 'Create'} Organization
          </button>
        </div>
      </form>
    </div>
  );
}
