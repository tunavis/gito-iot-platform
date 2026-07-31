'use client';

import { useCallback, useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { Badge } from '@/components/ui/Badge';
import { btn } from '@/components/ui/buttonStyles';
import { Bot, CheckCircle2, Clock, MapPin, ShieldCheck, XCircle } from 'lucide-react';
import { currentUserMayActuateDevice, getAuthClaims } from '@/lib/auth';

interface PendingApproval {
  id: string;
  device_id: string;
  device_name: string;
  site_id: string | null;
  site_name: string | null;
  command_name: string;
  parameters: Record<string, unknown>;
  request_reason: string | null;
  requested_by: string | null;
  requested_by_email: string | null;
  created_at: string;
  expires_at: string;
}

/** "in 3h 20m" / "in 4m" — how long before this request lapses.
 *  Coarse on purpose: the operator needs to know whether to act now or after
 *  lunch, and a ticking second counter would only make the page feel urgent. */
function timeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

export default function ApprovalsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const claims = typeof window !== 'undefined' ? getAuthClaims() : null;
  const mayDecide = currentUserMayActuateDevice();

  const load = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || !claims) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tenants/${claims.tenantId}/command-approvals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setRows(json.data || []);
      } else {
        toast.error('Could not load approvals', `The server returned ${res.status}.`);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claims?.tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Approve or reject one request.
   *
   * The row is removed optimistically and put back if the call fails. That
   * matters more here than on a normal list: a 409 means somebody else already
   * decided this, and leaving the row gone would tell this operator their
   * decision took when it did not. */
  const decide = async (row: PendingApproval, action: 'approve' | 'reject') => {
    const token = localStorage.getItem('auth_token');
    if (!token || !claims) return;

    setDeciding(row.id);
    const previous = rows;
    setRows((current) => current.filter((r) => r.id !== row.id));

    try {
      const res = await fetch(
        `/api/v1/tenants/${claims.tenantId}/devices/${row.device_id}/commands/${row.id}/${action}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        setRows(previous);
        const detail = (await res.json().catch(() => null))?.detail;
        if (res.status === 409) {
          toast.error('Already decided', detail || 'Someone else has already actioned this request.');
          load();
        } else if (res.status === 403) {
          toast.error('Not permitted', detail || 'Your role may not decide device commands.');
        } else {
          toast.error('Could not complete', detail || `The server returned ${res.status}.`);
        }
        return;
      }

      const command = await res.json();
      if (action === 'approve') {
        const selfApproved = command.self_approved
          ? ' You approved your own request.'
          : '';
        toast.success(
          'Command approved',
          `${row.command_name} was sent to ${row.device_name}.${selfApproved}`,
        );
      } else {
        toast.success('Request rejected', `${row.command_name} was not sent to ${row.device_name}.`);
      }
    } catch {
      setRows(previous);
      toast.error('Could not complete', 'The request did not reach the server.');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <PageShell
      title="Command Approvals"
      subtitle="Device commands an agent has requested, awaiting a human decision"
    >
      {loading ? (
        <div className="gito-card p-8 text-center text-th-muted">Loading…</div>
      ) : rows.length === 0 ? (
        // Nothing waiting is the normal state, not a failure — say so, rather
        // than showing an empty table that reads as something being broken.
        <div className="gito-card p-10 text-center">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-th-muted" />
          <p className="font-medium">Nothing waiting for approval</p>
          <p className="text-sm text-th-muted mt-1">
            When an agent requests a device command, it appears here until someone
            approves or rejects it. Nothing is sent to a device in the meantime.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.id} className="gito-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning" label={row.command_name} />
                    <span className="font-medium">{row.device_name}</span>
                    {row.site_name && (
                      <span className="text-sm text-th-muted inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {row.site_name}
                      </span>
                    )}
                  </div>

                  {/* The reason is the whole point of the screen: without it an
                      operator is approving an instruction rather than judging a
                      request, so it gets the prominence, not the metadata. */}
                  <p className="mt-3 text-sm">
                    <Bot className="w-4 h-4 inline-block mr-1.5 -mt-0.5 text-th-muted" />
                    {row.request_reason || (
                      <span className="text-th-muted italic">No reason was given.</span>
                    )}
                  </p>

                  {Object.keys(row.parameters || {}).length > 0 && (
                    <pre className="mt-3 text-xs bg-panel rounded p-2 overflow-x-auto">
                      {JSON.stringify(row.parameters, null, 2)}
                    </pre>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-th-muted">
                    <span>
                      Requested by {row.requested_by_email || 'an unknown user'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {timeRemaining(row.expires_at)}
                    </span>
                    {row.requested_by && claims?.userId === row.requested_by && (
                      // Named before the decision, not after: approving your own
                      // agent's request is allowed, and the person doing it
                      // should see that is what is happening.
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        This is your own request
                      </span>
                    )}
                  </div>
                </div>

                {mayDecide ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => decide(row, 'reject')}
                      disabled={deciding === row.id}
                      className={`${btn.secondary} flex items-center gap-2`}
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>
                    <button
                      onClick={() => decide(row, 'approve')}
                      disabled={deciding === row.id}
                      className={`${btn.primary} flex items-center gap-2`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve &amp; send
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-th-muted max-w-[16rem]">
                    Your role can see requests but not decide them.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
