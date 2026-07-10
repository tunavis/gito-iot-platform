import { NextRequest, NextResponse } from 'next/server';

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://api:8000';

async function proxyToFastAPI(
  request: NextRequest,
  tenantId: string,
  path: string = ''
) {
  // Get tenant_id and auth from middleware headers
  const headerTenantId = request.headers.get('x-tenant-id');
  const token = request.headers.get('authorization');

  // Security check: ensure request tenant matches URL tenant
  if (headerTenantId !== tenantId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'TENANT_MISMATCH', message: 'Unauthorized' },
      },
      { status: 403 }
    );
  }

  const url = new URL(`${FASTAPI_URL}/api/v1/tenants/${tenantId}/devices${path}`);

  // Copy query params
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token || '',
      },
      body: request.method !== 'GET' ? await request.text() : undefined,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Request failed' },
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { tenant_id: string } }
) {
  return proxyToFastAPI(request, params.tenant_id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { tenant_id: string } }
) {
  return proxyToFastAPI(request, params.tenant_id);
}
