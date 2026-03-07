'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { Mail, Edit2, Trash2, UserPlus, Key, Search } from 'lucide-react';
import { UserRoleBadge, UserStatusBadge } from '@/components/ui/Badge';
import Avatar from '@/components/ui/Avatar';
import { btn, input } from '@/components/ui/buttonStyles';

interface User {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'SITE_ADMIN' | 'CLIENT' | 'VIEWER';
  status: 'active' | 'inactive' | 'suspended';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [changingPasswordUser, setChangingPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [filterRole, setFilterRole] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const loadUsers = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    let url = `/api/v1/tenants/${tenant}/users?page=1&per_page=100`;
    if (filterRole) url += `&role=${filterRole}`;
    if (filterStatus) url += `&status=${filterStatus}`;
    if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const json = await res.json();
      setUsers(json.data || []);
    }
    setLoading(false);
  }, [filterRole, filterStatus, searchTerm]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const deleteUser = async (id: string) => {
    const ok = await toast.confirm('Are you sure you want to suspend this user? They will no longer be able to access the system.', { title: 'Suspend User', variant: 'danger', confirmLabel: 'Suspend' });
    if (!ok) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      loadUsers(); // Reload to show updated status
    } else {
      const error = await res.json();
      toast.error('Failed to suspend user', error.detail);
    }
  };

  const changePassword = async () => {
    if (!changingPasswordUser || !newPassword) return;
    if (newPassword.length < 8) {
      toast.warning('Invalid password', 'Password must be at least 8 characters');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/users/${changingPasswordUser.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: newPassword })
    });

    if (res.ok) {
      toast.success('Password changed', 'Password changed successfully');
      setChangingPasswordUser(null);
      setNewPassword('');
    } else {
      const error = await res.json();
      toast.error('Failed to change password', error.detail);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <PageShell
      title="User Management"
      subtitle="Manage users, roles, and permissions"
      action={
        <button
          onClick={() => setShowNewForm(true)}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <UserPlus className="w-4 h-4" />
          Invite User
        </button>
      }
    >

        {/* Filters */}
        <div className="gito-card p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search by email or name…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`${input.base} pl-9`}
              />
            </div>
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className={input.select} style={{ width: 'auto' }}>
              <option value="">All Roles</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="TENANT_ADMIN">Tenant Admin</option>
              <option value="SITE_ADMIN">Site Admin</option>
              <option value="CLIENT">Client</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={input.select} style={{ width: 'auto' }}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>

        {showNewForm && (
          <UserForm
            onSuccess={() => {
              setShowNewForm(false);
              loadUsers();
            }}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        {editingUser && (
          <UserForm
            user={editingUser}
            onSuccess={() => {
              setEditingUser(null);
              loadUsers();
            }}
            onCancel={() => setEditingUser(null)}
          />
        )}

        <div className="gito-card overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
            <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
              <div className="col-span-3">User</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Last Login</div>
              <div className="col-span-1">Created</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-th-secondary">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-th-secondary">
                No users found. Click &quot;Invite User&quot; to add team members.
              </div>
            ) : (
              users.map(user => (
                <div key={user.id} className="px-6 py-4 hover:bg-panel transition-colors">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.full_name || user.email} size="md" />
                        <div>
                          <p className="text-sm font-semibold text-th-primary">
                            {user.full_name || 'Unnamed User'}
                          </p>
                          <p className="text-xs text-th-muted flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3" />
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <UserRoleBadge role={user.role} />
                    </div>
                    <div className="col-span-2">
                      <UserStatusBadge status={user.status} />
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-th-secondary">{formatDate(user.last_login_at)}</span>
                    </div>
                    <div className="col-span-1">
                      <span className="text-xs text-th-muted">{formatDate(user.created_at)}</span>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
                      <button
                        onClick={() => setEditingUser(user)}
                        className={btn.icon}
                        title="Edit user"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setChangingPasswordUser(user)}
                        className={btn.icon}
                        title="Change password"
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteUser(user.id)}
                        className={btn.iconDanger}
                        title="Suspend user"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      {/* Change Password Modal */}
      {changingPasswordUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="gito-card max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-th-primary mb-1">Change Password</h3>
            <p className="text-sm text-th-secondary mb-5">
              Set a new password for <span className="font-semibold text-th-primary">{changingPasswordUser.email}</span>
            </p>
            <div className="mb-5">
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-2">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className={input.base}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && changePassword()}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setChangingPasswordUser(null);
                  setNewPassword('');
                }}
                className={`flex-1 ${btn.secondary}`}
              >
                Cancel
              </button>
              <button
                onClick={changePassword}
                disabled={newPassword.length < 8}
                className={`flex-1 ${btn.primary} disabled:opacity-50`}
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

interface UserFormProps {
  user?: User;
  onSuccess: () => void;
  onCancel: () => void;
}

function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const [formData, setFormData] = useState({
    email: user?.email || '',
    full_name: user?.full_name || '',
    password: '',
    role: user?.role || 'VIEWER',
    status: user?.status || 'active'
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    try {
      let url: string;
      let method: string;
      let body: any;

      if (user) {
        // Update existing user
        url = `/api/v1/tenants/${tenant}/users/${user.id}`;
        method = 'PUT';
        body = {
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          status: formData.status
        };
      } else {
        // Create new user
        url = `/api/v1/tenants/${tenant}/users`;
        method = 'POST';
        body = {
          email: formData.email,
          full_name: formData.full_name,
          password: formData.password,
          role: formData.role,
          status: formData.status
        };
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        onSuccess();
      } else {
        const errorData = await res.json();
        setError(errorData.detail || 'Failed to save user');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="gito-card w-full max-w-md p-6">
        <h3 className="text-lg font-bold text-th-primary mb-1">
          {user ? 'Edit User' : 'Invite New User'}
        </h3>
        <p className="text-sm text-th-secondary mb-5">
          {user ? 'Update user details and permissions' : 'Add a new team member to your organization'}
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Email *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={input.base}
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Full Name *</label>
            <input
              type="text"
              required
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className={input.base}
              placeholder="John Doe"
            />
          </div>

          {!user && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Password *</label>
              <input
                type="password"
                required
                minLength={8}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={input.base}
                placeholder="Min 8 characters"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Role *</label>
            <select
              required
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
              className={input.select}
            >
              <option value="VIEWER">Viewer (Read-only)</option>
              <option value="CLIENT">Client (Limited access)</option>
              <option value="SITE_ADMIN">Site Admin (Site management)</option>
              <option value="TENANT_ADMIN">Tenant Admin (Full access)</option>
              <option value="SUPER_ADMIN">Super Admin (System-wide)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Status *</label>
            <select
              required
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              className={input.select}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className={`flex-1 ${btn.secondary}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 ${btn.primary} disabled:opacity-50`}
            >
              {submitting ? 'Saving...' : (user ? 'Update User' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
