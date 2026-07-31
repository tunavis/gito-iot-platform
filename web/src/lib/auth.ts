/**
 * Who the signed-in user is, and what they are allowed to do.
 *
 * Before this file there was no role gating anywhere in the frontend — every
 * component that needed the token decoded it inline, and nothing consulted the
 * role at all. That was survivable while the API let any authenticated tenant
 * user do anything; it stopped being survivable when issuing a device command
 * became role-restricted, because the alternative is rendering a button that
 * always returns 403.
 *
 * **This is not a security boundary.** The API decides; `require_command_role`
 * in `app/dependencies.py` is the real check and it holds whatever the browser
 * believes. What this does is stop the UI offering an action it knows will be
 * refused — a control that always fails is worse than an absent one, because the
 * user cannot tell the difference between "not allowed" and "broken".
 */

/** Roles permitted to actuate a device: issue, approve, or reject a command.
 *  Mirrors `COMMAND_ROLES` in `api/app/dependencies.py`. If that list changes,
 *  this one has to change with it — the API stays correct either way, but the
 *  UI would start hiding a control the user is in fact allowed to use. */
const COMMAND_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'SITE_ADMIN'];

export interface AuthClaims {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

/** Decode the stored JWT's claims, or null when there is no usable token.
 *
 * Base64url, not base64: the payload segment uses `-` and `_`, and `atob`
 * rejects them. The rest of the app already does this replace inline; it lives
 * here now so the next caller does not have to know.
 */
export function getAuthClaims(): AuthClaims | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('auth_token');
  if (!token) return null;

  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      userId: payload.sub || '',
      tenantId: payload.tenant_id || '',
      role: payload.role || '',
      email: payload.email || '',
    };
  } catch {
    // A malformed token is treated as no token. Throwing here would break every
    // page that asks who the user is, to report something they cannot fix.
    return null;
  }
}

/** Whether this user may issue, approve, or reject a device command. */
export function mayActuateDevice(role?: string | null): boolean {
  return COMMAND_ROLES.includes((role || '').toUpperCase());
}

/** Convenience for components that only need the answer, not the claims. */
export function currentUserMayActuateDevice(): boolean {
  return mayActuateDevice(getAuthClaims()?.role);
}
