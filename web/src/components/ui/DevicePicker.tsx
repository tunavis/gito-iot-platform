'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import type { Device } from '@/lib/deviceSchema';

/**
 * Server-backed device picker.
 *
 * A native <select> over a device list does not survive a real fleet: the list
 * endpoint caps `per_page` at 100, so on thousands of devices everything past
 * the first page is not merely slow to render — it is unreachable. This queries
 * `?search=` as you type instead, so the set on screen is always small and the
 * whole fleet is reachable.
 *
 * The parent owns the selection (`value` + `selectedLabel`) because the chosen
 * device is usually *not* in the current result set — you search "pump", pick
 * one, then search something else. `onChange` hands back the full Device so the
 * caller can cache it and resolve its device_type_id for a metric schema.
 */

const PER_PAGE = 20;
const DEBOUNCE_MS = 250;

export interface DevicePickerProps {
  tenant: string;
  /** Selected device id; '' means the empty option is chosen. */
  value: string;
  /** Null when the empty option is picked. */
  onChange: (device: Device | null) => void;
  /** Text for the "no specific device" option, e.g. 'All devices'. */
  emptyLabel: string;
  /** Display name for `value`. Needed because the selection is rarely in the results. */
  selectedLabel?: string;
  /** Visible label, associated with the input for screen readers. */
  label?: string;
  id?: string;
  className?: string;
}

interface DeviceRow extends Device {
  serial_number?: string | null;
  dev_eui?: string | null;
}

export default function DevicePicker({
  tenant,
  value,
  onChange,
  emptyLabel,
  selectedLabel,
  label,
  id,
  className = '',
}: DevicePickerProps) {
  const reactId = useId();
  const inputId = id ?? `device-picker-${reactId}`;
  const listboxId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0); // index into `options`
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Responses can land out of order — a fast "pu" after a slow "p" would other-
  // wise be overwritten by the stale "p" results. Only the newest wins.
  const requestSeq = useRef(0);

  const displayLabel = value ? (selectedLabel ?? value.slice(0, 8)) : emptyLabel;

  const search = useCallback(
    async (term: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const params = new URLSearchParams({ page: '1', per_page: String(PER_PAGE) });
        if (term.trim()) params.set('search', term.trim());

        const res = await fetch(`/api/v1/tenants/${tenant}/devices?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (seq !== requestSeq.current) return; // a newer query already answered
        if (!res.ok) {
          setRows([]);
          setError('Could not load devices');
          return;
        }
        const body = await res.json();
        if (seq !== requestSeq.current) return;
        setRows(Array.isArray(body?.data) ? body.data : []);
        setTotal(Number(body?.meta?.total ?? 0));
      } catch {
        if (seq === requestSeq.current) setError('Could not load devices');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [tenant],
  );

  // Debounced fetch while open. The leading fetch on open uses the same path
  // with an empty term, so the first page is whatever the server considers most
  // recent — a sane default before the user types anything.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(query), query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [open, query, search]);

  // Close on outside click. Pointerdown rather than click so the listbox does
  // not close before an option's click handler runs.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  type Option = { key: string; label: string; hint?: string; device: Device | null };
  const options = useMemo<Option[]>(
    () => [
      { key: '__empty__', label: emptyLabel, device: null },
      ...rows.map((d) => ({
        key: d.id,
        label: d.name,
        hint: d.serial_number || d.dev_eui || undefined,
        device: d as Device,
      })),
    ],
    [rows, emptyLabel],
  );

  const commit = (opt: Option) => {
    onChange(opt.device);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setOpen(true);
      setActive(0);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[active];
      if (opt) commit(opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  const hiddenCount = Math.max(0, total - rows.length);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label && (
        <label htmlFor={inputId} className="block text-sm text-th-primary mb-1">
          {label}
        </label>
      )}

      {open ? (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-th-muted pointer-events-none" />
          <input
            id={inputId}
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={options[active] ? `${inputId}-opt-${options[active].key}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search by name, serial or dev EUI…"
            className="w-full pl-8 pr-8 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-primary-500"
          />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-th-muted animate-spin" />
          )}
        </div>
      ) : (
        <button
          id={inputId}
          type="button"
          role="combobox"
          aria-expanded="false"
          aria-controls={listboxId}
          onClick={() => {
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left border border-[var(--color-input-border)] rounded-lg hover:bg-page"
        >
          <span className={`flex-1 truncate ${value ? '' : 'text-th-secondary'}`}>{displayLabel}</span>
          {value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear device"
              title="Clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="flex-shrink-0 text-th-muted hover:text-th-primary"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-th-muted" />
        </button>
      )}

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          // Wider than the trigger on purpose: device names in a fleet differ
          // only in their last few characters ("Flow Meter 856D" vs "8599"), so
          // a list that truncates to "Flow Meter 8…" cannot be chosen from.
          className="absolute z-30 mt-1 w-full min-w-[22rem] max-h-72 overflow-y-auto rounded-lg border border-th-default bg-surface shadow-lg py-1"
        >
          {options.map((opt, i) => {
            const selected = opt.device ? opt.device.id === value : value === '';
            return (
              <li
                key={opt.key}
                id={`${inputId}-opt-${opt.key}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(opt)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                  i === active ? 'bg-page' : ''
                }`}
              >
                <Check className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? '' : 'invisible'}`} />
                <span className="flex-1 truncate">{opt.label}</span>
                {opt.hint && (
                  <span className="text-[11px] text-th-muted truncate max-w-[40%]">{opt.hint}</span>
                )}
              </li>
            );
          })}

          {!loading && rows.length === 0 && query.trim() && !error && (
            <li className="px-3 py-2 text-sm text-th-secondary">No devices match “{query.trim()}”</li>
          )}
          {error && <li className="px-3 py-2 text-sm text-red-600">{error}</li>}
          {hiddenCount > 0 && (
            // Never silently truncate: say how many were left out and how to reach them.
            <li className="px-3 py-2 text-[11px] text-th-muted border-t border-th-default">
              {hiddenCount.toLocaleString()} more match — keep typing to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
