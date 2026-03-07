'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { Pencil, Trash2, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { btn, input } from '@/components/ui/buttonStyles';

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

  return (
    <PageShell
      title="Organizations"
      subtitle="Manage sub-customers and organizational units"
      action={
        <button
          onClick={() => setShowNewForm(true)}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <Building2 className="w-4 h-4" />
          New Organization
        </button>
      }
    >

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

      <div className="gito-card overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
          <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Slug</div>
            <div className="col-span-3">Billing Contact</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1">Created</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-th-secondary">Loading...</div>
          ) : organizations.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-th-secondary">
              No organizations found. Click &quot;New Organization&quot; to create one.
            </div>
          ) : (
            organizations.map(org => (
              <div key={org.id} className="px-6 py-4 hover:bg-panel transition-colors">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-th-primary">{org.name}</p>
                    {org.description && (
                      <p className="text-xs text-th-muted mt-0.5">{org.description}</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs font-mono text-th-secondary">{org.slug}</span>
                  </div>
                  <div className="col-span-3">
                    <span className="text-sm text-th-secondary">{org.billing_contact || '—'}</span>
                  </div>
                  <div className="col-span-1">
                    <Badge
                      variant={org.status === 'active' ? 'success' : org.status === 'suspended' ? 'danger' : 'neutral'}
                      label={org.status}
                      size="sm"
                    />
                  </div>
                  <div className="col-span-1">
                    <span className="text-xs text-th-muted">{new Date(org.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="col-span-2 flex gap-1 justify-end">
                    <button onClick={() => setEditingOrg(org)} className={btn.icon} title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteOrganization(org.id)} className={btn.iconDanger} title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
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
    <div className="gito-card p-6 mb-4">
      <h3 className="text-lg font-bold text-th-primary mb-1">
        {organization ? 'Edit Organization' : 'Create New Organization'}
      </h3>
      <p className="text-sm text-th-secondary mb-5">
        {organization ? 'Update organization details' : 'Add a new organizational unit'}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Organization Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className={input.base}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Slug *</label>
            <input
              type="text"
              required
              disabled={!!organization}
              value={formData.slug}
              onChange={e => setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
              className={`${input.base} disabled:opacity-50`}
              placeholder="acme-corp"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className={`${input.base} resize-none`}
              rows={2}
              placeholder="Optional description..."
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Billing Contact</label>
            <input
              type="email"
              value={formData.billing_contact}
              onChange={e => setFormData(prev => ({ ...prev, billing_contact: e.target.value }))}
              className={input.base}
              placeholder="billing@acme.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">ChirpStack App ID</label>
            <input
              type="text"
              value={formData.chirpstack_app_id}
              onChange={e => setFormData(prev => ({ ...prev, chirpstack_app_id: e.target.value }))}
              className={input.base}
              placeholder="Optional"
            />
          </div>
          {organization && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={formData.status}
                onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as any }))}
                className={input.select}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>{organization ? 'Update' : 'Create'} Organization</button>
        </div>
      </form>
    </div>
  );
}
