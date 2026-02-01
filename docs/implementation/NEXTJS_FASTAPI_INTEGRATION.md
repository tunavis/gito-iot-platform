# Gito IoT Platform - Next.js + FastAPI Integration Guide

This guide shows how to wire Next.js frontend with FastAPI backend for a bulletproof multi-tenant IoT platform.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  Browser / Mobile Client                     │
└────────────────────┬────────────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │   Next.js 14+ App   │ (Port 3000)
          │ ├─ /app/* (Routes)  │
          │ ├─ /api/* (Proxy)   │ ◄─── Middleware (tenant, auth)
          │ └─ WebSocket stream │
          └──────────┬──────────┘
                     │ (localhost:8000 in dev)
                     │ (api service in Docker)
          ┌──────────▼──────────┐
          │  FastAPI Backend    │ (Port 8000)
          │ ├─ /api/v1/* (REST) │
          │ ├─ /ws/* (WebSocket)│
          │ └─ JWT validation   │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │   PostgreSQL        │
          │ + TimescaleDB + RLS │
          └─────────────────────┘
```

**Key principle**: Next.js API routes are a **gateway/proxy** layer, not the backend. They:
1. Validate JWT tokens (from cookies)
2. Inject tenant_id into headers
3. Forward requests to FastAPI
4. Handle streaming/WebSocket upgrades
5. Manage error responses for frontend

---

## 2. Project Structure

```
web/
├── .env.local                    # Local dev secrets (gitignored)
├── .env.example                  # Template
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
│
├── src/
│   ├── middleware.ts             # ◄─── CRITICAL: Tenant validation
│   │
│   ├── app/
│   │   ├── layout.tsx            # Root layout + theme
│   │   ├── page.tsx              # Dashboard home
│   │   ├── error.tsx             # Global error handling
│   │   ├── loading.tsx           # Global loading skeleton
│   │   │
│   │   ├── auth/
│   │   │   ├── login/page.tsx
│   │   │   ├── logout/page.tsx
│   │   │   └── callback/page.tsx # OAuth redirect (if needed)
│   │   │
│   │   ├── dashboard/
│   │   │   ├── page.tsx          # Main dashboard
│   │   │   ├── layout.tsx        # Protected layout
│   │   │   ├── devices/
│   │   │   │   ├── page.tsx      # Device list (server-side fetch)
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── page.tsx  # Device details
│   │   │   │   │   └── edit/page.tsx
│   │   │   │   └── new/page.tsx  # Create device
│   │   │   ├── alerts/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── telemetry/
│   │   │   │   └── page.tsx      # Historical data + charts
│   │   │   └── settings/
│   │   │       └── page.tsx      # Tenant settings
│   │   │
│   │   └── api/                  # ◄─── API ROUTES (proxy to FastAPI)
│   │       ├── auth/
│   │       │   ├── login/route.ts
│   │       │   ├── logout/route.ts
│   │       │   └── refresh/route.ts
│   │       │
│   │       ├── tenants/
│   │       │   └── [tenant_id]/
│   │       │       ├── devices/
│   │       │       │   ├── route.ts      # GET/POST /api/tenants/{id}/devices
│   │       │       │   └── [device_id]/
│   │       │       │       └── route.ts  # GET/PUT/DELETE device
│   │       │       ├── alerts/route.ts
│   │       │       ├── telemetry/route.ts
│   │       │       └── users/route.ts
│   │       │
│   │       └── ws/
│   │           └── devices/route.ts      # WebSocket stream
│   │
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── ThemeProvider.tsx
│   │   │
│   │   ├── devices/
│   │   │   ├── DeviceGrid.tsx           # Client component
│   │   │   ├── DeviceCard.tsx
│   │   │   ├── DeviceForm.tsx           # Create/Edit
│   │   │   └── DeviceStatus.tsx         # Real-time status badge
│   │   │
│   │   ├── dashboard/
│   │   │   ├── MetricsCard.tsx
│   │   │   ├── DeviceHealthChart.tsx
│   │   │   └── AlertsFeed.tsx           # Real-time alerts
│   │   │
│   │   ├── ui/                          # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── modal.tsx
│   │   │   └── ...
│   │   │
│   │   └── alerts/
│   │       ├── AlertRule.tsx
│   │       └── AlertHistory.tsx
│   │
│   ├── hooks/
│   │   ├── useAuth.ts              # Auth state + logout
│   │   ├── useDevices.ts           # Fetch devices + cache
│   │   ├── useTelemetry.ts         # Real-time telemetry stream
│   │   ├── useWebSocket.ts         # Generic WebSocket hook
│   │   └── useTenant.ts            # Get current tenant from auth
│   │
│   ├── lib/
│   │   ├── api.ts                  # API client (calls /api/*)
│   │   ├── auth.ts                 # JWT decode, token management
│   │   ├── websocket.ts            # WebSocket utilities
│   │   └── constants.ts            # API URLs, timeouts, etc.
│   │
│   ├── types/
│   │   ├── index.ts                # Global types
│   │   ├── device.ts
│   │   ├── telemetry.ts
│   │   ├── alert.ts
│   │   └── auth.ts
│   │
│   └── styles/
│       ├── globals.css
│       ├── gito-theme.css          # Gito brand colors
│       └── animations.css          # Loading, transitions
│
└── public/
    ├── logo.svg                    # Gito logo
    ├── favicon.ico
    └── icons/                      # Device type icons
```

---

## 3. Authentication & Middleware (CRITICAL)

### 3.1 Next.js Middleware (Tenant Validation)

**`src/middleware.ts`** (Runs on every request):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET_KEY || 'fallback-key-dev-only'
);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for public routes
  if (pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  if (pathname === '/' || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Protected routes: validate JWT from cookie
  const token = request.cookies.get('auth_token')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  try {
    // Verify JWT signature
    const verified = await jwtVerify(token, JWT_SECRET);
    const payload = verified.payload as any;

    // Extract tenant_id and user info
    const tenantId = payload.tenant_id;
    const userId = payload.sub;
    const userRole = payload.role;

    if (!tenantId) {
      throw new Error('Missing tenant_id in JWT');
    }

    // Inject into request headers for API routes to use
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-tenant-id', tenantId);
    requestHeaders.set('x-user-id', userId);
    requestHeaders.set('x-user-role', userRole);
    requestHeaders.set('authorization', `Bearer ${token}`);

    // Forward request with new headers
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error('Middleware auth failed:', error);
    // Clear invalid cookie and redirect to login
    const response = NextResponse.redirect(new URL('/auth/login', request.url));
    response.cookies.delete('auth_token');
    return response;
  }
}

export const config = {
  // Apply middleware to protected routes
  matcher: [
    '/dashboard/:path*',
    '/api/tenants/:path*',
    '/api/ws/:path*',
  ],
};
```

### 3.2 Auth Utilities

**`src/lib/auth.ts`**:

```typescript
import { jwtDecode } from 'jwt-decode';

export interface JWTPayload {
  sub: string;            // user_id
  tenant_id: string;      // tenant_id
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'SITE_ADMIN' | 'CLIENT' | 'VIEWER';
  exp: number;
  iat: number;
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwtDecode<JWTPayload>(token);
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded) return true;
  return decoded.exp * 1000 < Date.now();
}

export function getTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  
  const cookies = document.cookie
    .split(';')
    .find(c => c.trim().startsWith('auth_token='));
  
  return cookies ? cookies.split('=')[1] : null;
}

export async function logout(): Promise<void> {
  // Call logout API route
  await fetch('/api/auth/logout', { method: 'POST' });
  
  // Clear cookie
  document.cookie = 'auth_token=; max-age=0; path=/';
  
  // Redirect to login
  window.location.href = '/auth/login';
}

export async function refreshToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    if (response.ok) {
      const data = await response.json();
      return data.access_token;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }
  return null;
}
```

### 3.3 Auth Hook

**`src/hooks/useAuth.ts`**:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import { JWTPayload, decodeToken, isTokenExpired, logout, refreshToken } from '@/lib/auth';

export function useAuth() {
  const [auth, setAuth] = useState<{ token: string; payload: JWTPayload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        
        if (!token) {
          setLoading(false);
          return;
        }

        // Check if token is expired
        if (isTokenExpired(token)) {
          const newToken = await refreshToken();
          if (newToken) {
            localStorage.setItem('auth_token', newToken);
            const payload = decodeToken(newToken);
            if (payload) {
              setAuth({ token: newToken, payload });
            }
          } else {
            await logout();
          }
        } else {
          const payload = decodeToken(token);
          if (payload) {
            setAuth({ token, payload });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Auth error');
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
  }, []);

  return {
    auth,
    tenantId: auth?.payload.tenant_id,
    userId: auth?.payload.sub,
    userRole: auth?.payload.role,
    loading,
    error,
    logout: handleLogout,
    isAuthenticated: !!auth,
  };
}
```

---

## 4. API Routes (Proxy Layer)

### 4.1 Generic API Request Handler

**`src/lib/api.ts`** (Client-side API client):

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const API_TIMEOUT = 30000; // 30 seconds

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    page: number;
    per_page: number;
    total: number;
  };
}

class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${endpoint}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok) {
      throw new ApiError(
        data.error?.code || 'UNKNOWN_ERROR',
        response.status,
        data.error?.message || 'Request failed'
      );
    }

    if (!data.success) {
      throw new ApiError(
        data.error?.code || 'UNKNOWN_ERROR',
        response.status,
        data.error?.message || 'Request failed'
      );
    }

    return data.data!;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getDevices(
  tenantId: string,
  page: number = 1,
  perPage: number = 50
) {
  return apiRequest(`/api/tenants/${tenantId}/devices?page=${page}&per_page=${perPage}`);
}

export async function getDevice(tenantId: string, deviceId: string) {
  return apiRequest(`/api/tenants/${tenantId}/devices/${deviceId}`);
}

export async function createDevice(tenantId: string, data: any) {
  return apiRequest(`/api/tenants/${tenantId}/devices`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDevice(tenantId: string, deviceId: string, data: any) {
  return apiRequest(`/api/tenants/${tenantId}/devices/${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDevice(tenantId: string, deviceId: string) {
  return apiRequest(`/api/tenants/${tenantId}/devices/${deviceId}`, {
    method: 'DELETE',
  });
}

export async function getTelemetry(
  tenantId: string,
  deviceId: string,
  hours: number = 24
) {
  return apiRequest(
    `/api/tenants/${tenantId}/devices/${deviceId}/telemetry?hours=${hours}`
  );
}

export { ApiError };
```

### 4.2 Login API Route

**`src/app/api/auth/login/route.ts`** (Proxy + JWT cookie handling):

```typescript
import { NextRequest, NextResponse } from 'next/server';

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Forward to FastAPI
    const response = await fetch(`${FASTAPI_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    // Set JWT as secure HTTP-only cookie
    const result = NextResponse.json(data);
    
    result.cookies.set('auth_token', data.access_token, {
      httpOnly: true,        // No JS access (security)
      secure: process.env.NODE_ENV === 'production', // HTTPS only
      sameSite: 'lax',       // CSRF protection
      maxAge: 24 * 60 * 60,  // 24 hours
      path: '/',
    });

    return result;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'LOGIN_FAILED', message: 'Login failed' } },
      { status: 500 }
    );
  }
}
```

### 4.3 Device API Route (Generic Proxy)

**`src/app/api/tenants/[tenant_id]/devices/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';

async function proxyToFastAPI(
  request: NextRequest,
  tenantId: string,
  path: string
) {
  // Get tenant_id from middleware (injected into headers)
  const headerTenantId = request.headers.get('x-tenant-id');
  const token = request.headers.get('authorization');

  // Security check: ensure request tenant matches URL tenant
  if (headerTenantId !== tenantId) {
    return NextResponse.json(
      { success: false, error: { code: 'TENANT_MISMATCH', message: 'Unauthorized' } },
      { status: 403 }
    );
  }

  const url = new URL(`${FASTAPI_URL}/api/v1/tenants/${tenantId}${path}`);
  
  // Copy query params
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token || '',
      },
      body: request.method !== 'GET' ? await request.text() : undefined,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'PROXY_ERROR', message: 'Request failed' } },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { tenant_id: string } }
) {
  return proxyToFastAPI(request, params.tenant_id, '/devices');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { tenant_id: string } }
) {
  return proxyToFastAPI(request, params.tenant_id, '/devices');
}
```

### 4.4 WebSocket Stream API Route

**`src/app/api/ws/devices/route.ts`** (Real-time telemetry):

```typescript
import { NextRequest } from 'next/server';

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const tenantId = request.headers.get('x-tenant-id');
  const token = request.headers.get('authorization');

  if (!tenantId) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Create ReadableStream for Server-Sent Events (SSE)
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Connect to FastAPI WebSocket
        const ws = new WebSocket(
          `ws://${FASTAPI_URL.replace('http://', '')}/api/v1/ws/devices/${tenantId}`,
          {
            headers: {
              Authorization: token || '',
            },
          }
        );

        ws.onmessage = (event) => {
          // Forward WebSocket messages as SSE events
          controller.enqueue(`data: ${event.data}\n\n`);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          controller.close();
        };

        ws.onclose = () => {
          controller.close();
        };
      } catch (error) {
        console.error('WebSocket setup error:', error);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

---

## 5. Components & Hooks

### 5.1 Device List (Server Component + Client Components)

**`src/app/dashboard/devices/page.tsx`** (Server-side fetch):

```typescript
import { getDevices } from '@/lib/api';
import DeviceGrid from '@/components/devices/DeviceGrid';

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = parseInt(searchParams.page || '1');

  // Server-side fetch (faster initial load)
  const devices = await getDevices(tenantId, page, 50);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Devices</h1>
        <a href="/dashboard/devices/new" className="btn btn-primary">
          + New Device
        </a>
      </div>

      {/* Client component for interactivity */}
      <DeviceGrid initialDevices={devices} page={page} />
    </div>
  );
}
```

### 5.2 Device Grid (Client Component with Real-Time Updates)

**`src/components/devices/DeviceGrid.tsx`**:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import DeviceCard from './DeviceCard';

interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'idle' | 'error';
  last_seen: string;
  device_type: string;
  metadata: Record<string, any>;
}

export default function DeviceGrid({ initialDevices }: { initialDevices: Device[] }) {
  const [devices, setDevices] = useState(initialDevices);
  const { data: liveUpdate } = useWebSocket('/api/ws/devices');

  // Update device status from WebSocket stream
  useEffect(() => {
    if (!liveUpdate) return;

    const update = JSON.parse(liveUpdate);
    setDevices(prev =>
      prev.map(device =>
        device.id === update.device_id
          ? { ...device, ...update }
          : device
      )
    );
  }, [liveUpdate]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {devices.map(device => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  );
}
```

### 5.3 WebSocket Hook (Real-Time Updates)

**`src/hooks/useWebSocket.ts`**:

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';

export function useWebSocket(url: string) {
  const [data, setData] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    try {
      // Use Server-Sent Events (simpler than WebSocket in Next.js)
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        setData(event.data);
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        setError('Connection lost');
        eventSource.close();
      };

      eventSourceRef.current = eventSource;

      return () => {
        eventSource.close();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    }
  }, [url]);

  return { data, isConnected, error };
}
```

### 5.4 Device Hook (Data Management)

**`src/hooks/useDevices.ts`**:

```typescript
'use client';

import { useCallback, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from './useAuth';

export function useDevices() {
  const { tenantId } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = useCallback(async (page = 1) => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const data = await api.getDevices(tenantId, page);
      setDevices(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const createDevice = useCallback(
    async (data: any) => {
      if (!tenantId) return;
      return api.createDevice(tenantId, data);
    },
    [tenantId]
  );

  const deleteDevice = useCallback(
    async (deviceId: string) => {
      if (!tenantId) return;
      return api.deleteDevice(tenantId, deviceId);
    },
    [tenantId]
  );

  return {
    devices,
    loading,
    error,
    fetchDevices,
    createDevice,
    deleteDevice,
  };
}
```

---

## 6. Environment Variables

**`.env.example`**:

```bash
# Next.js Frontend
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NODE_ENV=development

# FastAPI Backend (internal, server-side only)
FASTAPI_URL=http://localhost:8000

# JWT Secret (for verifying tokens in middleware)
JWT_SECRET_KEY=your-super-secret-key-min-32-chars-here

# Optional: OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**`.env.local`** (Development only, gitignored):

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api
FASTAPI_URL=http://api:8000
JWT_SECRET_KEY=dev-key-only-not-secure
```

---

## 7. Docker Integration

**`web/Dockerfile`**:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["npm", "start"]
```

**`docker-compose.yml`** (Updated):

```yaml
web:
  build:
    context: ./web
    dockerfile: Dockerfile
  environment:
    FASTAPI_URL: http://api:8000      # Internal: api service
    NEXT_PUBLIC_API_URL: /api          # Frontend: relative path
    JWT_SECRET_KEY: ${JWT_SECRET_KEY}
  ports:
    - "3000:3000"
  depends_on:
    api:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000"]
    interval: 10s
    timeout: 5s
    retries: 3
```

---

## 8. Gito Theme & Styling

**`src/styles/gito-theme.css`**:

```css
/* Gito color palette from logo */
:root {
  --color-primary: #0066CC;      /* Dark blue */
  --color-accent: #00A8E8;       /* Light blue */
  --color-dark: #001F3F;         /* Navy */
  --color-light: #E8F4F8;        /* Light blue bg */
  --color-gray-50: #F9FAFB;
  --color-gray-900: #111827;

  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;

  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

body {
  font-family: var(--font-family);
  background-color: var(--color-gray-50);
  color: var(--color-gray-900);
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-weight: 500;
  transition: all 0.2s;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background-color: var(--color-primary);
  color: white;
}

.btn-primary:hover {
  background-color: var(--color-dark);
  box-shadow: var(--shadow-lg);
}

.btn-accent {
  background-color: var(--color-accent);
  color: white;
}

.card {
  background: white;
  border-radius: 0.5rem;
  padding: 1.5rem;
  box-shadow: var(--shadow-md);
  border: 1px solid #E5E7EB;
}

.card-hover {
  transition: all 0.3s;
}

.card-hover:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}

/* Device status indicators */
.status-online {
  color: var(--color-success);
}

.status-offline {
  color: var(--color-error);
}

.status-idle {
  color: var(--color-warning);
}
```

**`tailwind.config.ts`** (Gito theme integration):

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0066CC',
        accent: '#00A8E8',
        'gito-dark': '#001F3F',
        'gito-light': '#E8F4F8',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
```

---

## 9. Security Checklist

- ✅ JWT tokens in HTTP-only cookies (can't be accessed by JS)
- ✅ Middleware validates tenant_id on every request
- ✅ Tenant_id verified in API routes before proxying
- ✅ CORS disabled (same origin only)
- ✅ rate-limiting delegated to FastAPI
- ✅ No secrets in client code
- ✅ HTTPS required in production
- ✅ SameSite=Lax cookie CSRF protection

---

## 10. Data Flow Example: Create Device

```
Browser
  │
  ├─ POST /dashboard/devices/new → DeviceForm.tsx (client component)
  │
  ├─ onClick: createDevice(data)
  │   └─ calls api.createDevice()
  │       └─ POST /api/tenants/{tenant_id}/devices
  │
  ├─ Next.js API Route (/api/tenants/.../devices)
  │   ├─ Extract tenant_id from middleware headers
  │   ├─ Verify JWT token
  │   ├─ Validate tenant_id matches URL
  │   └─ Proxy → FastAPI
  │
  ├─ FastAPI Backend (/api/v1/tenants/{tenant_id}/devices)
  │   ├─ Validate JWT again
  │   ├─ Check RLS policy (PostgreSQL)
  │   ├─ Create device in DB
  │   └─ Return response
  │
  ├─ Next.js API Route
  │   └─ Return response to client
  │
  └─ DeviceForm.tsx
      ├─ Show success toast
      ├─ Redirect to device list
      └─ DeviceGrid receives WebSocket update
          └─ Real-time device appears in list
```

---

## 11. Performance Tips

### Server-Side Rendering Benefits:
```typescript
// Fast initial load (rendered HTML sent to browser)
export default async function Page() {
  const devices = await getDevices(tenantId);
  return <DeviceGrid devices={devices} />; // HTML + JS sent together
}
```

### Real-Time Updates (Client-Side):
```typescript
// After initial load, only updates stream over WebSocket/SSE
<DeviceGrid initialDevices={devices} />
  ↓
useWebSocket('/api/ws/devices')
  ↓
setState(update) → re-render only changed device
```

### Caching Strategy:
- **Devices list**: Cache 30 seconds (not changing frequently)
- **Telemetry**: Cache 5 seconds (updating constantly)
- **Alerts**: No cache (real-time critical)

---

## Summary: Next.js as Perfect Gateway

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Browser | React 18 + TypeScript | Interactive UI |
| SSR | Next.js Server Components | Fast initial page load |
| Gateway | Next.js API Routes | Tenant validation + proxy |
| Auth | JWT (cookies) + Middleware | Security boundary |
| Backend | FastAPI | Business logic + RLS |
| Database | PostgreSQL + RLS | Multi-tenant isolation |

**Key principle**: Next.js handles **presentation + security**. FastAPI handles **business logic + data**.

This is the **Vercel/Stripe/Figma architecture**: lightweight frontend layer proxying to robust backend.
