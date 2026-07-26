'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import Modal from '@/components/ui/Modal';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { btn } from '@/components/ui/buttonStyles';
import { useToast } from '@/components/ToastProvider';
import { CreditCard, AlertTriangle, Clock, ArrowUpRight } from 'lucide-react';

interface Subscription {
  plan_code: string;
  plan_name?: string;
  status: string;
  provider?: string | null;
  billing_interval?: string | null;
  currency?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  grace_until?: string | null;
  cancel_at_period_end?: boolean;
}
interface UsageItem {
  metric: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
}
interface UsageResponse { plan_code: string; status: string; usage: UsageItem[]; }
interface PlanOption { code: string; name: string; prices: { interval: string; amount_cents: number | null }[]; }

const METRIC_LABELS: Record<string, string> = {
  'devices.max': 'Devices',
  'gateways.max': 'Gateways',
  'users.max': 'Users',
  'dashboards.max': 'Dashboards',
  'automations.max': 'Automation rules',
  'notifications.per_month': 'Notifications this month',
  'api.requests_per_day': 'API requests today',
};

const STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  active:     { variant: 'success', label: 'Active' },
  trialing:   { variant: 'info',    label: 'Trial' },
  past_due:   { variant: 'warning', label: 'Past due' },
  restricted: { variant: 'danger',  label: 'Restricted' },
  canceled:   { variant: 'neutral', label: 'Canceled' },
  none:       { variant: 'neutral', label: 'No subscription' },
};

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function auth() {
  if (typeof window === 'undefined') return null;  // SSR-safe: localStorage is client-only
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return { token, tenantId: payload.tenant_id, role: payload.role };
}

export default function BillingPage() {
  const toast = useToast();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [planModal, setPlanModal] = useState(false);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    const a = auth();
    if (!a) return;
    setIsAdmin(['TENANT_ADMIN', 'SUPER_ADMIN'].includes(a.role));
    setLoading(true);
    try {
      const [subRes, usageRes] = await Promise.all([
        fetch(`/api/v1/tenants/${a.tenantId}/subscription`, { headers: { Authorization: `Bearer ${a.token}` } }),
        fetch(`/api/v1/tenants/${a.tenantId}/usage`, { headers: { Authorization: `Bearer ${a.token}` } }),
      ]);
      if (subRes.ok) setSub(await subRes.json());
      if (usageRes.ok) setUsage(await usageRes.json());
    } catch {
      toast.error('Failed to load billing', 'Could not reach the billing service.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Returning from the hosted checkout: activation happens via webhook, which can
  // lag a moment, so acknowledge and refresh rather than promising it's already live.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('checkout') === 'done') {
      toast.success('Payment received', 'Your plan will activate once the payment is confirmed.');
      window.history.replaceState({}, '', '/dashboard/billing');
      const t = setTimeout(() => load(), 4000);  // give the webhook a beat, then refresh
      return () => clearTimeout(t);
    }
  }, [load, toast]);

  async function openPlanModal() {
    setPlanModal(true);
    if (planOptions.length === 0) {
      const r = await fetch('/api/v1/plans');
      if (r.ok) setPlanOptions((await r.json()).plans || []);
    }
  }

  async function post(path: string, body?: object) {
    const a = auth();
    if (!a) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/tenants/${a.tenantId}/subscription${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = typeof json.detail === 'object' ? json.detail?.message : json.detail;
        throw new Error(detail || `Request failed (${r.status})`);
      }
      toast.success('Subscription updated');
      setPlanModal(false);
      await load();
    } catch (e) {
      toast.error('Could not update subscription', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Paid plans go through the card gateway: get a hosted-checkout URL and redirect.
  // The subscription only activates once the provider webhook confirms payment.
  async function checkout(plan_code: string) {
    const a = auth();
    if (!a) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/tenants/${a.tenantId}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ plan_code, billing_interval: 'month' }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = typeof json.detail === 'object' ? json.detail?.message : json.detail;
        throw new Error(detail || `Checkout failed (${r.status})`);
      }
      if (!json.redirect_url) throw new Error('No checkout URL returned');
      window.location.href = json.redirect_url;  // → provider hosted payment page
    } catch (e) {
      toast.error('Could not start checkout', e instanceof Error ? e.message : String(e));
      setBusy(false);  // on success we navigate away, so only reset on failure
    }
  }

  const badge = sub ? (STATUS_BADGE[sub.status] ?? { variant: 'neutral' as BadgeVariant, label: sub.status }) : null;
  const trialDays = daysUntil(sub?.trial_ends_at);
  const graceDays = daysUntil(sub?.grace_until);
  const overLimit = (usage?.usage || []).filter((u) => !u.unlimited && u.limit !== null && u.used >= u.limit);

  return (
    <PageShell title="Billing & Subscription" subtitle="Your plan, usage and payment status" icon={<CreditCard className="w-5 h-5" />}>
      {loading ? (
        <p className="text-th-muted">Loading…</p>
      ) : (
        <div className="max-w-4xl space-y-6">

          {/* ── Status banners ─────────────────────────────────────────── */}
          {sub?.status === 'trialing' && trialDays !== null && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                 style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)' }}>
              <Clock className="w-4 h-4 flex-shrink-0" style={{ color: '#2563eb' }} />
              <span className="text-sm text-th-primary">
                Your trial ends in <strong>{trialDays} day{trialDays === 1 ? '' : 's'}</strong>. Choose a plan to keep full access.
              </span>
              {isAdmin && <button onClick={openPlanModal} className="ml-auto text-sm font-semibold text-primary-600 hover:text-primary-700">Choose plan →</button>}
            </div>
          )}
          {(sub?.status === 'past_due' || sub?.status === 'restricted') && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                 style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#dc2626' }} />
              <span className="text-sm text-th-primary">
                {sub.status === 'restricted'
                  ? 'Your subscription has lapsed — the workspace is read-only. Reactivate to restore full access.'
                  : <>Payment is overdue{graceDays !== null && graceDays > 0 ? <> — {graceDays} day{graceDays === 1 ? '' : 's'} of grace left</> : ''}. Update your plan to avoid restriction.</>}
              </span>
              {isAdmin && <button onClick={openPlanModal} className="ml-auto text-sm font-semibold text-red-600 hover:text-red-700">Fix now →</button>}
            </div>
          )}
          {sub?.cancel_at_period_end && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                 style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#d97706' }} />
              <span className="text-sm text-th-primary">
                Scheduled to cancel at the end of the current period.
              </span>
              {isAdmin && <button onClick={() => post('/resume')} disabled={busy} className="ml-auto text-sm font-semibold text-primary-600 hover:text-primary-700">Resume</button>}
            </div>
          )}
          {overLimit.length > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                 style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
              <span className="text-sm text-th-primary">
                Over your plan limits on{' '}
                <strong>{overLimit.map((u) => `${METRIC_LABELS[u.metric] || u.metric} (${u.used}/${u.limit})`).join(', ')}</strong>.
                {' '}New items in {overLimit.length === 1 ? 'this area' : 'these areas'} cannot be added until you upgrade or reduce usage.
              </span>
              {isAdmin && <button onClick={openPlanModal} className="ml-auto flex-shrink-0 text-sm font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap">Upgrade →</button>}
            </div>
          )}

          {/* ── Current plan ───────────────────────────────────────────── */}
          <div className="gito-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-th-muted mb-1">Current plan</p>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-th-primary">{sub?.plan_name || sub?.plan_code || 'Free'}</h2>
                  {badge && <Badge variant={badge.variant} label={badge.label} dot={sub?.status === 'active' || sub?.status === 'restricted'} />}
                </div>
                <p className="text-sm text-th-muted mt-2">
                  {sub?.billing_interval ? `Billed ${sub.billing_interval}ly` : 'No active billing'}
                  {sub?.current_period_end && <> · renews {new Date(sub.current_period_end).toLocaleDateString('en-ZA')}</>}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button onClick={openPlanModal} className={btn.primary}>
                    Change plan
                  </button>
                  {sub && ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end && (
                    <button onClick={() => post('/cancel')} disabled={busy} className={btn.secondary}>Cancel</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Usage ──────────────────────────────────────────────────── */}
          <div className="gito-card p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-th-primary">Usage</h3>
              <Link href="/pricing" className="text-sm text-primary-600 hover:text-primary-700 font-semibold inline-flex items-center gap-1">
                Compare plans <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="space-y-4">
              {usage?.usage.map((u) => {
                const label = METRIC_LABELS[u.metric] || u.metric;
                const pct = u.unlimited || !u.limit ? 0 : Math.min(100, (u.used / u.limit) * 100);
                const over = !u.unlimited && u.limit !== null && u.used >= u.limit;
                const near = !u.unlimited && u.limit !== null && pct >= 80;
                const barColor = over ? '#dc2626' : near ? '#d97706' : '#2563eb';
                return (
                  <div key={u.metric}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-th-secondary font-medium">{label}</span>
                      <span className="font-mono text-th-primary">
                        {u.used.toLocaleString('en-ZA')}
                        <span className="text-th-muted"> / {u.unlimited ? '∞' : u.limit?.toLocaleString('en-ZA')}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-panel)' }}>
                      <div className="h-full rounded-full transition-all"
                           style={{ width: u.unlimited ? '100%' : `${pct}%`, background: u.unlimited ? 'rgba(100,116,139,0.35)' : barColor }} />
                    </div>
                  </div>
                );
              })}
              {(!usage || usage.usage.length === 0) && <p className="text-sm text-th-muted">No metered usage to show.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Change-plan modal ────────────────────────────────────────── */}
      <Modal open={planModal} onClose={() => setPlanModal(false)} title="Change plan">
        <div className="space-y-2">
          {planOptions.map((p) => {
            const monthly = p.prices.find((x) => x.interval === 'month')?.amount_cents;
            const isCurrent = p.code === sub?.plan_code;
            return (
              <button
                key={p.code}
                disabled={busy || isCurrent}
                onClick={() => (monthly && monthly > 0 ? checkout(p.code) : post('/change', { plan_code: p.code }))}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-th-default hover:bg-panel disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
              >
                <span className="font-semibold text-th-primary">{p.name}</span>
                <span className="text-sm text-th-muted font-mono">
                  {isCurrent ? 'Current' : monthly === null ? 'Custom' : monthly === 0 ? 'Free' : `R${(monthly! / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}/mo`}
                </span>
              </button>
            );
          })}
          {planOptions.length === 0 && <p className="text-sm text-th-muted">Loading plans…</p>}
        </div>
      </Modal>
    </PageShell>
  );
}
