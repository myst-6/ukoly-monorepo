interface User {
  id: number;
  username: string;
  salt: string;
  password_hash: string;
  created_at: string;
}

interface JWTPayload {
  userId: number;
  username: string;
  iat: number;
  exp: number;
}

interface AuthRequest {
  username: string;
  password: string;
}

interface AuthResponse {
  success: boolean;
  token?: string;
  user?: {
    id: number;
    username: string;
    isAdmin?: boolean;
  };
  error?: string;
}

// Utility functions for crypto operations (Cloudflare Workers compatible)
async function generateSalt(): Promise<string> {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + (30 * 24 * 60 * 60) // 30 days
  };

  const encoder = new TextEncoder();
  
  // Create header
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  return `${data}.${encodedSignature}`;
}

async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    
    // Verify signature
    const encoder = new TextEncoder();
    const data = `${encodedHeader}.${encodedPayload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = new Uint8Array(
      atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'))
        .split('').map(c => c.charCodeAt(0))
    );
    
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    if (!isValid) return null;
    
    // Decode payload
    const payload = JSON.parse(atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'))) as JWTPayload;
    
    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    
    return payload;
  } catch {
    return null;
  }
}

function validateUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z_\-0-9]{3,32}$/;
  return usernameRegex.test(username);
}

function validatePassword(password: string): boolean {
  return password.length >= 8 && password.length <= 32;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    };

    const jwtSecret = await env.JWT_SECRET.get();
    if (!jwtSecret) {
      return new Response(JSON.stringify({
        success: false,
        error: 'JWT secret not configured'
      }), { 
        status: 500,
        headers: headers
      });
    }

    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: headers,
      });
    }

    try {
      if (url.pathname === '/register' && request.method === 'POST') {
        return await this.handleRegister(request, env, headers);
      }

      if (url.pathname === '/login' && request.method === 'POST') {
        return await this.handleLogin(request, env, headers, jwtSecret);
      }

      if (url.pathname === '/verify' && request.method === 'POST') {
        return await this.handleVerify(request, env, headers, jwtSecret);
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'Not found'
      }), {
        status: 404,
        headers: headers,
      });
    } catch (error) {
      console.error('Auth worker error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: 'Internal server error'
      }), {
        status: 500,
        headers: headers,
      });
    }
  },

  async handleRegister(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
    const body = await request.json() as AuthRequest;
    
    if (!body.username || !body.password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Username and password are required'
      }), {
        status: 400,
        headers: headers,
      });
    }

    if (!validateUsername(body.username)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Username must be 3-32 characters and contain only letters, numbers, underscores, and hyphens'
      }), {
        status: 400,
        headers: headers,
      });
    }

    if (!validatePassword(body.password)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Password must be 8-32 characters long'
      }), {
        status: 400,
        headers: headers,
      });
    }

    // Check if user already exists
    const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
      .bind(body.username)
      .first();

    if (existingUser) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Username already exists'
      }), {
        status: 409,
        headers: headers,
      });
    }

    // Create new user
    const salt = await generateSalt();
    const passwordHash = await hashPassword(body.password, salt);

    const result = await env.DB.prepare(`
      INSERT INTO users (username, salt, password_hash)
      VALUES (?, ?, ?)
    `).bind(body.username, salt, passwordHash).run();

    if (!result.success) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create user'
      }), {
        status: 500,  
        headers: headers,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: result.meta.last_row_id,
        username: body.username
      }
    } satisfies AuthResponse), {
      status: 201,
      headers: headers,
    });
  },

  async handleLogin(request: Request, env: Env, headers: Record<string, string>, jwtSecret: string): Promise<Response> {
    const body = await request.json() as AuthRequest;
    
    if (!body.username || !body.password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Username and password are required'
      }), {
        status: 400,
        headers: headers,
      });
    }

    // Find user
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
      .bind(body.username)
      .first() as User | null;

    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid username or password'
      }), {
        status: 401,
        headers: headers,
      });
    }

    // Verify password
    const passwordHash = await hashPassword(body.password, user.salt);
    if (passwordHash !== user.password_hash) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid username or password'
      }), {
        status: 401,
        headers: headers,
      });
    }

    // Create JWT token
    const token = await createJWT({
      userId: user.id,
      username: user.username
    }, jwtSecret);

    // Check if user is admin
    const isAdmin = await env.ADMIN_KV.get(user.username) !== null;

    return new Response(JSON.stringify({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        isAdmin
      }
    } satisfies AuthResponse), {
      status: 200,
      headers: headers,
    });
  },

  async handleVerify(request: Request, env: Env, headers: Record<string, string>, jwtSecret: string): Promise<Response> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authorization header missing or invalid'
      }), {
        status: 401,
        headers: headers,
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const payload = await verifyJWT(token, jwtSecret);

    if (!payload) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid or expired token'
      }), {
        status: 401,
        headers: headers,
      });
    }

    // Check if user still exists
    const user = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
      .bind(payload.userId)
      .first() as Pick<User, 'id' | 'username'> | null;

    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'User not found'
      }), {
        status: 401,
        headers: headers,
      });
    }

    // Check if user is admin
    const isAdmin = await env.ADMIN_KV.get(user.username) !== null;
    console.log('isAdmin', isAdmin);

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        isAdmin
      }
    }), {
      status: 200,
      headers: headers,
    });
  },
}; 