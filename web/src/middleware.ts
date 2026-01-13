import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET_KEY || 'dev-secret-key-min-32-chars-xxx-dev-only'
);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for public routes
  if (pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  if (pathname === '/' || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Protected routes: validate JWT from cookie or localStorage
  let token: string | null = null;

  // Try to get token from cookie first (more secure)
  const cookieToken = request.cookies.get('auth_token')?.value;
  if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    // Redirect to login if no token
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
  matcher: ['/dashboard/:path*', '/api/tenants/:path*'],
};
