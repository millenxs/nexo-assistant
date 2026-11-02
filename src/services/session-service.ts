import crypto from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { Analyst, Employee } from '@/domain/types';
import { getDb } from './db';
import { conversationService } from './conversation-service';

export const SESSION_COOKIE_NAME = 'nexo_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

export type SessionRole = 'employee' | 'analyst';

export interface ServerSession {
  token: string;
  userId: string;
  role: SessionRole;
  userEmail: string;
  userName: string;
  createdAt: string;
  expiresAt: string;
  employee?: Employee;
  analyst?: Analyst;
}

interface SessionRow {
  token: string;
  user_id: string;
  role: SessionRole;
  user_email: string;
  user_name: string;
  created_at: string;
  expires_at: string;
}

interface SignedPayload {
  sid: string;
  userId: string;
  role: SessionRole;
  userEmail: string;
  userName: string;
  iat: string;
  exp: string;
}

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'nexo-assist-server-session-secret-2026-key';
}

function signPayload(payload: SignedPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedToken(token: string): SignedPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SignedPayload;
    if (new Date(parsed.exp).getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class UnauthorizedSessionError extends Error {
  constructor(message = 'Sessão inválida ou expirada. Faça login novamente.') {
    super(message);
    this.name = 'UnauthorizedSessionError';
  }
}

export class ForbiddenRoleError extends Error {
  constructor(message = 'Acesso negado para o perfil autenticado na sessão.') {
    super(message);
    this.name = 'ForbiddenRoleError';
  }
}

export class SessionService {
  createSession(input: {
    userId: string;
    role: SessionRole;
    userEmail: string;
    userName: string;
  }): ServerSession {
    const db = getDb();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL_MS);
    const sid = crypto.randomBytes(16).toString('hex');

    const token = signPayload({
      sid,
      userId: input.userId,
      role: input.role,
      userEmail: input.userEmail,
      userName: input.userName,
      iat: now.toISOString(),
      exp: expires.toISOString(),
    });

    db.prepare(
      `INSERT OR REPLACE INTO sessions (token, user_id, role, user_email, user_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      token,
      input.userId,
      input.role,
      input.userEmail,
      input.userName,
      now.toISOString(),
      expires.toISOString()
    );

    return this.getSessionByToken(token)!;
  }

  getSessionByToken(token?: string | null): ServerSession | null {
    if (!token || !token.trim()) return null;
    const trimmed = token.trim();

    // 1. Verifica assinatura HMAC-SHA256 do servidor (impede falsificação pelo cliente)
    const verified = verifySignedToken(trimmed);
    if (!verified) return null;

    const db = getDb();

    // 2. Verifica se o token foi revogado explicitamente via logout
    const revoked = db
      .prepare('SELECT token FROM revoked_sessions WHERE token = ?')
      .get(trimmed) as { token: string } | undefined;
    if (revoked) return null;

    // 3. Busca ou reidrata o registro na tabela sessions do SQLite local
    let row = db
      .prepare('SELECT * FROM sessions WHERE token = ?')
      .get(trimmed) as unknown as SessionRow | undefined;

    if (!row) {
      db.prepare(
        `INSERT OR REPLACE INTO sessions (token, user_id, role, user_email, user_name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        trimmed,
        verified.userId,
        verified.role,
        verified.userEmail,
        verified.userName,
        verified.iat,
        verified.exp
      );
      row = {
        token: trimmed,
        user_id: verified.userId,
        role: verified.role,
        user_email: verified.userEmail,
        user_name: verified.userName,
        created_at: verified.iat,
        expires_at: verified.exp,
      };
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(row.token);
      return null;
    }

    const employee =
      row.role === 'employee'
        ? conversationService.getEmployeeById(row.user_id) ?? undefined
        : undefined;
    const analyst =
      row.role === 'analyst'
        ? conversationService.getAnalystByEmailOrId(row.user_id) ?? undefined
        : undefined;

    if (row.role === 'employee' && !employee) return null;
    if (row.role === 'analyst' && !analyst) return null;

    return {
      token: row.token,
      userId: row.user_id,
      role: row.role,
      userEmail: row.user_email,
      userName: row.user_name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      employee,
      analyst,
    };
  }

  revokeSession(token?: string | null): void {
    if (!token) return;
    const trimmed = token.trim();
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(trimmed);
    db.prepare(
      'INSERT OR REPLACE INTO revoked_sessions (token, revoked_at) VALUES (?, ?)'
    ).run(trimmed, new Date().toISOString());
  }

  requireEmployeeSession(
    token?: string | null,
    claimedEmployeeId?: string | null
  ): ServerSession & { employee: Employee } {
    const session = this.getSessionByToken(token);
    if (!session) {
      throw new UnauthorizedSessionError();
    }
    if (session.role !== 'employee' || !session.employee) {
      throw new ForbiddenRoleError(
        'Esta rota exige uma sessão autenticada de funcionário.'
      );
    }
    if (claimedEmployeeId && claimedEmployeeId !== session.userId) {
      throw new ForbiddenRoleError(
        'Identidade divergente da sessão autenticada: não é permitido operar em nome de outro funcionário.'
      );
    }
    return session as ServerSession & { employee: Employee };
  }

  requireAnalystSession(
    token?: string | null,
    claimedAnalystId?: string | null
  ): ServerSession & { analyst: Analyst } {
    const session = this.getSessionByToken(token);
    if (!session) {
      throw new UnauthorizedSessionError();
    }
    if (session.role !== 'analyst' || !session.analyst) {
      throw new ForbiddenRoleError(
        'Acesso restrito ao Console do Analista (Suporte N1/N2).'
      );
    }
    if (claimedAnalystId && claimedAnalystId !== session.userId) {
      throw new ForbiddenRoleError(
        'Identidade divergente da sessão autenticada: não é permitido operar em nome de outro analista.'
      );
    }
    return session as ServerSession & { analyst: Analyst };
  }
}

export const sessionService = new SessionService();

export function extractSessionTokenFromRequest(req: NextRequest): string | null {
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export function attachSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
