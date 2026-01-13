import { NextRequest, NextResponse } from 'next/server';

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://api:8000';

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

    result.cookies.set('auth_token', data.data.access_token, {
      httpOnly: true, // No JS access (security)
      secure: process.env.NODE_ENV === 'production', // HTTPS only
      sameSite: 'lax', // CSRF protection
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    });

    return result;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'LOGIN_FAILED', message: 'Login failed' },
      },
      { status: 500 }
    );
  }
}
