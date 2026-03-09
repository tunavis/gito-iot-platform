'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { ArrowLeft, Edit, Save, Cpu, X } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';
import { categoryIcons, DEFAULT_FORM } from '../_constants';
import type { DeviceType, DeviceTypeForm, DiscoveredMetric, DataModelField } from '../_types';
import DeviceTypeView from './_components/DeviceTypeView';
import DeviceTypeEdit from './_components/DeviceTypeEdit';

export default function DeviceTypeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const toast = useToast();
  const isNew = params.id === 'new';

  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view');
  const [deviceType, setDeviceType] = useState<DeviceType | null>(null);
  const [form, setForm] = useState<DeviceTypeForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Discovered metrics state
  const [discoveredMetrics, setDiscoveredMetrics] = useState<DiscoveredMetric[]>([]);
  const [discoveredTotal, setDiscoveredTotal] = useState(0);
  const [discoveredLoading, setDiscoveredLoading] = useState(false);

  const getAuthInfo = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/auth/login');
      return null;
    }
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { token, tenant: payload.tenant_id };
  }, [router]);

  // Load device type
  const loadDeviceType = useCallback(async () => {
    const auth = getAuthInfo();
    if (!auth) return;

    try {
      setLoading(true);
      const response = await fetch(
        `/api/v1/tenants/${auth.tenant}/device-types/${params.id}`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (!response.ok) throw new Error('Failed to load device type');

      const result = await response.json();
      const dt = result.data ?? result;

      setDeviceType(dt);
      populateForm(dt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [params.id, getAuthInfo]);

  const populateForm = (dt: DeviceType) => {
    setForm({
      name: dt.name || '',
      description: dt.description || '',
      manufacturer: dt.manufacturer || '',
      model: dt.model || '',
      category: dt.category || 'sensor',
      icon: dt.icon || 'thermometer',
      color: dt.color || '#10b981',
      data_model: (dt.data_model || []).map((f: DataModelField) => ({
        name: f.name || '',
        type: f.type || 'float',
        unit: f.unit || '',
        description: f.description || '',
        min_value: (f as any).min ?? f.min_value,
        max_value: (f as any).max ?? f.max_value,
        required: f.required || false,
      })),
      capabilities: dt.capabilities || [],
      default_settings: dt.default_settings || DEFAULT_FORM.default_settings,
      connectivity: dt.connectivity || DEFAULT_FORM.connectivity,
      is_active: dt.is_active ?? true,
    });
  };

  // Load discovered metrics
  const loadDiscoveredMetrics = useCallback(async () => {
    if (isNew) return;
    const auth = getAuthInfo();
    if (!auth) return;

    setDiscoveredLoading(true);
    try {
      const res = await fetch(
        `/api/v1/tenants/${auth.tenant}/device-types/${params.id}/discovered-metrics?days=7`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (res.ok) {
        const json = await res.json();
        const data = json.data ?? json;
        setDiscoveredMetrics(data.metrics || []);
        setDiscoveredTotal(data.total_devices || 0);
      }
    } catch {
      // Non-critical
    } finally {
      setDiscoveredLoading(false);
    }
  }, [params.id, isNew, getAuthInfo]);

  useEffect(() => {
    if (!isNew) {
      loadDeviceType();
      loadDiscoveredMetrics();
    }
  }, [isNew, loadDeviceType, loadDiscoveredMetrics]);

  // Save handler
  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }

    const auth = getAuthInfo();
    if (!auth) return;

    try {
      setSaving(true);
      setError(null);

      const url = isNew
        ? `/api/v1/tenants/${auth.tenant}/device-types`
        : `/api/v1/tenants/${auth.tenant}/device-types/${params.id}`;

      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to save device type');
      }

      if (isNew) {
        toast.success('Created', 'Device type created successfully');
        router.push('/dashboard/device-types');
      } else {
        toast.success('Saved', 'Device type updated successfully');
        await loadDeviceType();
        setMode('view');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    if (deviceType) populateForm(deviceType);
    setError(null);
    setMode('edit');
  };

  const handleCancelEdit = () => {
    setError(null);
    if (isNew) {
      router.back();
    } else {
      setMode('view');
    }
  };

  // Loading state
  if (loading) {
    return (
      <PageShell title="Loading..." subtitle="Loading device type details">
        <div className="flex items-center justify-center py-20">
          <div className="text-th-secondary text-sm">Loading device type...</div>
        </div>
      </PageShell>
    );
  }

  // Page title and actions based on mode
  const pageTitle = mode === 'view' && deviceType
    ? deviceType.name
    : isNew
      ? 'Create Device Type'
      : 'Edit Device Type';

  const pageSubtitle = mode === 'view' && deviceType
    ? [deviceType.manufacturer, deviceType.model].filter(Boolean).join(' · ') || 'Device type details'
    : 'Define a template for devices with data model and capabilities';

  const pageIcon = mode === 'view' && deviceType
    ? (
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: `${deviceType.color}20`, color: deviceType.color }}
      >
        {categoryIcons[deviceType.category] || <Cpu className="w-4 h-4" />}
      </div>
    )
    : undefined;

  const pageAction = mode === 'view' ? (
    <div className="flex items-center gap-2">
      <button onClick={() => router.push('/dashboard/device-types')} className={`${btn.ghost} flex items-center gap-2`}>
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      <button onClick={handleEdit} className={`${btn.primary} flex items-center gap-2`}>
        <Edit className="w-4 h-4" />
        Edit
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <button onClick={handleCancelEdit} className={`${btn.secondary} flex items-center gap-2`}>
        <X className="w-4 h-4" />
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={saving}
        className={`${btn.primary} flex items-center gap-2`}
      >
        <Save className="w-4 h-4" />
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );

  return (
    <PageShell
      title={pageTitle}
      subtitle={pageSubtitle}
      icon={pageIcon}
      action={pageAction}
    >
      {mode === 'view' && deviceType ? (
        <DeviceTypeView
          deviceType={deviceType}
          discoveredMetrics={discoveredMetrics}
          discoveredTotal={discoveredTotal}
          discoveredLoading={discoveredLoading}
          onRefreshDiscovered={loadDiscoveredMetrics}
        />
      ) : (
        <DeviceTypeEdit
          form={form}
          setForm={setForm}
          error={error}
          isEditMode={!isNew}
          discoveredMetrics={discoveredMetrics}
          discoveredTotal={discoveredTotal}
          discoveredLoading={discoveredLoading}
          onRefreshDiscovered={loadDiscoveredMetrics}
        />
      )}
    </PageShell>
  );
}
