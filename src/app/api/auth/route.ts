import { NextRequest, NextResponse } from 'next/server';
import { conversationService } from '@/services/conversation-service';
import { ticketService } from '@/services/ticket-service';
import {
  attachSessionCookie,
  clearSessionCookie,
  extractSessionTokenFromRequest,
  sessionService,
} from '@/services/session-service';
import { getServerModelConfig } from '@/mastra/model-provider';

export async function GET(req: NextRequest) {
  const employees = conversationService.listEmployees();
  const analysts = conversationService.listAnalysts();
  const modelConfig = getServerModelConfig();
  const legacyMode = ticketService.getLegacyInstabilityMode();

  const token = extractSessionTokenFromRequest(req);
  const currentSession = sessionService.getSessionByToken(token);

  return NextResponse.json({
    employees,
    analysts,
    modelConfig,
    legacyMode,
    activeSession: currentSession
      ? {
          role: currentSession.role,
          employee: currentSession.employee ?? null,
          analyst: currentSession.analyst ?? null,
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = (body.email ?? '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: 'Informe seu e-mail corporativo (@nexo.com.br).' },
        { status: 400 }
      );
    }

    const previousToken = extractSessionTokenFromRequest(req);
    if (previousToken) {
      sessionService.revokeSession(previousToken);
    }

    const employee = conversationService.getEmployeeByEmail(email);
    if (employee) {
      const session = sessionService.createSession({
        userId: employee.id,
        role: 'employee',
        userEmail: employee.email,
        userName: employee.name,
      });

      const res = NextResponse.json({
        role: 'employee',
        employee,
      });
      attachSessionCookie(res, session.token);
      return res;
    }

    const analyst = conversationService.getAnalystByEmailOrId(email);
    if (analyst) {
      const session = sessionService.createSession({
        userId: analyst.id,
        role: 'analyst',
        userEmail: analyst.email,
        userName: analyst.name,
      });

      const res = NextResponse.json({
        role: 'analyst',
        analyst,
      });
      attachSessionCookie(res, session.token);
      return res;
    }

    return NextResponse.json(
      {
        error:
          'E-mail corporativo não encontrado nos colaboradores de exemplo da Nexo. Selecione um colaborador abaixo ou use ana.souza@nexo.com.br.',
      },
      { status: 404 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno na autenticação.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const token = extractSessionTokenFromRequest(req);
  if (token) {
    sessionService.revokeSession(token);
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
