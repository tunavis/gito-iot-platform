'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import { Mail, Edit2, Trash2, UserPlus, Key } from 'lucide-react';

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
    if (!confirm('Are you sure you want to suspend this user? They will no longer be able to access the system.')) return;

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
      alert(error.detail || 'Failed to suspend user');
    }
  };

  const changePassword = async () => {
    if (!changingPasswordUser || !newPassword) return;
    if (newPassword.length < 8) {
      alert('Password must be at least 8 characters');
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
      alert('Password changed successfully');
      setChangingPasswordUser(null);
      setNewPassword('');
    } else {
      const error = await res.json();
      alert(error.detail || 'Failed to change password');
    }
  };

  const roleColor = (role: string) => {
    const colors: Record<string, string> = {
      SUPER_ADMIN: 'bg-purple-100 text-purple-700',
      TENANT_ADMIN: 'bg-blue-100 text-blue-700',
      SITE_ADMIN: 'bg-cyan-100 text-cyan-700',
      CLIENT: 'bg-green-100 text-green-700',
      VIEWER: 'bg-gray-100 text-gray-600'
    };
    return colors[role] || 'bg-gray-100 text-gray-600';
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-yellow-100 text-yellow-700',
      suspended: 'bg-red-100 text-red-700'
    };
    return colors[status] || 'bg-gray-100 text-gray-600';
  };

  const roleBadge = (role: string) => {
    const icons: Record<string, string> = {
      SUPER_ADMIN: '👑',
      TENANT_ADMIN: '🔑',
      SITE_ADMIN: '🏢',
      CLIENT: '👤',
      VIEWER: '👁️'
    };
    return icons[role] || '👤';
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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
              <p className="text-gray-600 mt-2">Manage users, roles, and permissions</p>
            </div>
            <button
              onClick={() => setShowNewForm(true)}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm"
            >
              <UserPlus className="w-5 h-5" />
              Invite User
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 mb-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Search</label>
              <input
                type="text"
                placeholder="Search by email or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">All Roles</option>
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="TENANT_ADMIN">Tenant Admin</option>
                <option value="SITE_ADMIN">Site Admin</option>
                <option value="CLIENT">Client</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
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

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
            <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
              <div className="col-span-3">User</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Last Login</div>
              <div className="col-span-1">Created</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-gray-600">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-gray-600">
                No users found. Click &quot;Invite User&quot; to add team members.
              </div>
            ) : (
              users.map(user => (
                <div key={user.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-semibold">
                          {user.full_name ? user.full_name[0].toUpperCase() : user.email[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {user.full_name || 'Unnamed User'}
                          </p>
                          <p className="text-xs text-gray-600 flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3" />
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 w-fit ${roleColor(user.role)}`}>
                        <span>{roleBadge(user.role)}</span>
                        <span>{user.role.replace('_', ' ')}</span>
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${statusColor(user.status)}`}>
                        {user.status}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-gray-600">{formatDate(user.last_login_at)}</span>
                    </div>
                    <div className="col-span-1">
                      <span className="text-xs text-gray-600">{formatDate(user.created_at)}</span>
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        title="Edit user"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setChangingPasswordUser(user)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Change password"
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteUser(user.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
      </main>

      {/* Change Password Modal */}
      {changingPasswordUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Change Password</h3>
            <p className="text-sm text-gray-600 mb-4">
              Change password for <span className="font-semibold">{changingPasswordUser.email}</span>
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={changePassword}
                disabled={newPassword.length < 8}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {user ? 'Edit User' : 'Invite New User'}
        </h3>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="John Doe"
            />
          </div>

          {!user && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
              <input
                type="password"
                required
                minLength={8}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Min 8 characters"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select
              required
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="VIEWER">Viewer (Read-only)</option>
              <option value="CLIENT">Client (Limited access)</option>
              <option value="SITE_ADMIN">Site Admin (Site management)</option>
              <option value="TENANT_ADMIN">Tenant Admin (Full access)</option>
              <option value="SUPER_ADMIN">Super Admin (System-wide)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
            <select
              required
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving...' : (user ? 'Update User' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
