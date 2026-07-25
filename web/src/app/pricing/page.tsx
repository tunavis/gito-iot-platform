'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Minus, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface FeatureCell {
  value: unknown;
  name: string;
  kind: 'boolean' | 'limit' | 'enum';
  unit: string | null;
}
interface Plan {
  code: string;
  name: string;
  description: string | null;
  trial_days: number;
  prices: { currency: string; interval: string; amount_cents: number | null }[];
  features: Record<string, FeatureCell>;
}

// Order + friendly labels for the comparison table (drives row order too).
const FEATURE_ROWS: { key: string; label: string }[] = [
  { key: 'devices.max', label: 'Devices' },
  { key: 'gateways.max', label: 'Gateways' },
  { key: 'users.max', label: 'Users' },
  { key: 'dashboards.max', label: 'Dashboards' },
  { key: 'automations.max', label: 'Automation rules' },
  { key: 'retention.days', label: 'Data retention' },
  { key: 'storage.gb', label: 'Storage' },
  { key: 'notifications.per_month', label: 'Notifications / mo' },
  { key: 'api.requests_per_day', label: 'API requests / day' },
  { key: 'analytics.advanced', label: 'Advanced analytics' },
  { key: 'reporting.enabled', label: 'Reporting' },
  { key: 'export.enabled', label: 'Data export' },
  { key: 'ai.enabled', label: 'AI features' },
  { key: 'support.level', label: 'Support' },
];

const HIGHLIGHT_KEYS = ['devices.max', 'users.max', 'retention.days', 'analytics.advanced', 'export.enabled', 'ai.enabled'];

function monthlyCents(plan: Plan): number | null {
  const p = plan.prices.find((x) => x.interval === 'month');
  return p ? p.amount_cents : null;
}

function formatPrice(cents: number | null): { big: string; small: string } {
  if (cents === null) return { big: 'Custom', small: 'contact sales' };
  if (cents === 0) return { big: 'Free', small: 'forever' };
  return { big: `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`, small: '/ month' };
}

function renderValue(cell: FeatureCell | undefined) {
  if (!cell) return <Minus className="w-4 h-4 text-th-muted mx-auto" />;
  if (cell.kind === 'boolean') {
    return cell.value
      ? <Check className="w-4 h-4 mx-auto" style={{ color: '#16a34a' }} />
      : <Minus className="w-4 h-4 text-th-muted mx-auto" />;
  }
  if (cell.kind === 'enum') {
    return <span className="capitalize">{String(cell.value)}</span>;
  }
  // limit: null = unlimited
  if (cell.value === null) return <span className="font-semibold">Unlimited</span>;
  const n = Number(cell.value).toLocaleString('en-ZA');
  return <span>{cell.unit ? `${n} ${cell.unit}` : n}</span>;
}

export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/plans')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setPlans(d.plans || []))
      .catch(() => setError('Could not load plans.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-page">
      {/* Header */}
      <header className="border-b border-th-subtle">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)', color: '#3b82f6' }}>
              <Zap className="w-4 h-4" />
            </div>
            <span className="font-bold text-th-primary">Gito</span>
          </Link>
          <Link href="/auth/login" className="text-sm font-semibold text-primary-600 hover:text-primary-700">
            Sign in →
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-14">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-th-primary tracking-tight text-balance">
            Simple, transparent pricing
          </h1>
          <p className="text-th-secondary mt-3 max-w-xl mx-auto">
            Start free, scale as your fleet grows. Every plan includes real-time monitoring,
            alerts and multi-tenant device management. Prices in ZAR, excl. VAT.
          </p>
        </div>

        {loading && <p className="text-center text-th-muted">Loading plans…</p>}
        {error && <p className="text-center text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            {/* Plan cards */}
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4 mb-16">
              {plans.map((plan) => {
                const price = formatPrice(monthlyCents(plan));
                const featured = plan.code === 'professional';
                return (
                  <div
                    key={plan.code}
                    className="gito-card p-6 flex flex-col relative"
                    style={featured ? { borderColor: 'rgba(37,99,235,0.5)', boxShadow: '0 0 0 1px rgba(37,99,235,0.3)' } : undefined}
                  >
                    {featured && (
                      <div className="absolute -top-3 left-6">
                        <Badge variant="info" label="Most popular" />
                      </div>
                    )}
                    <h3 className="text-lg font-bold text-th-primary">{plan.name}</h3>
                    <p className="text-xs text-th-muted mt-1 min-h-[2.5rem]">{plan.description}</p>

                    <div className="flex items-baseline gap-1 mt-4 mb-1">
                      <span className="text-3xl font-bold text-th-primary font-mono">{price.big}</span>
                      <span className="text-sm text-th-muted">{price.small}</span>
                    </div>
                    {plan.trial_days > 0 && (
                      <p className="text-xs font-medium mb-4" style={{ color: '#16a34a' }}>
                        {plan.trial_days}-day free trial
                      </p>
                    )}
                    {plan.trial_days === 0 && <div className="mb-4 h-4" />}

                    {monthlyCents(plan) === null ? (
                      <a href="mailto:sales@gito.co.za"
                         className="block text-center px-4 py-2 rounded-lg font-semibold text-sm border border-th-default text-th-primary hover:bg-panel transition-colors">
                        Contact sales
                      </a>
                    ) : (
                      <Link href="/auth/login"
                            className={`block text-center px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                              featured
                                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                                : 'border border-th-default text-th-primary hover:bg-panel'
                            }`}>
                        {monthlyCents(plan) === 0 ? 'Get started' : 'Start free trial'}
                      </Link>
                    )}

                    <ul className="mt-6 space-y-2.5">
                      {HIGHLIGHT_KEYS.map((k) => {
                        const cell = plan.features[k];
                        if (!cell) return null;
                        const row = FEATURE_ROWS.find((r) => r.key === k);
                        // Drop the trailing label only when the value already carries the
                        // same unit (e.g. "5 devices" not "5 devices devices"). Keep it for
                        // "Unlimited" so it reads "Unlimited devices", not a bare "Unlimited".
                        const dupe = cell.value !== null && cell.unit && row?.label.toLowerCase() === cell.unit.toLowerCase();
                        return (
                          <li key={k} className="flex items-center gap-2 text-sm text-th-secondary">
                            <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#16a34a' }} />
                            <span>
                              {cell.kind === 'boolean'
                                ? (cell.value ? row?.label : <span className="text-th-muted line-through">{row?.label}</span>)
                                : <>{renderValue(cell)}{!dupe && <> <span className="text-th-muted">{row?.label.toLowerCase()}</span></>}</>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>

            {/* Comparison table */}
            <div className="gito-card overflow-hidden">
              <div className="px-6 py-4 border-b border-th-subtle">
                <h2 className="font-bold text-th-primary">Compare all features</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-th-subtle">
                      <th className="text-left font-semibold text-th-muted px-6 py-3">Feature</th>
                      {plans.map((p) => (
                        <th key={p.code} className="text-center font-semibold text-th-primary px-4 py-3 min-w-[110px]">{p.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FEATURE_ROWS.map((row) => (
                      <tr key={row.key} className="border-b border-th-subtle last:border-0">
                        <td className="px-6 py-3 text-th-secondary font-medium">{row.label}</td>
                        {plans.map((p) => (
                          <td key={p.code} className="px-4 py-3 text-center text-th-secondary">
                            {renderValue(p.features[row.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
