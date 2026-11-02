import { NextRequest, NextResponse } from 'next/server';
import { conversationService } from '@/services/conversation-service';
import { ticketService } from '@/services/ticket-service';
import {
  extractSessionTokenFromRequest,
  ForbiddenRoleError,
  sessionService,
  UnauthorizedSessionError,
} from '@/services/session-service';
import { processEmployeeMessage } from '@/mastra/orchestrator';

export async function GET(req: NextRequest) {
  try {
    const token = extractSessionTokenFromRequest(req);
    const claimedEmployeeId = req.nextUrl.searchParams.get('employeeId');
    const session = sessionService.requireEmployeeSession(token, claimedEmployeeId);
    const employee = session.employee;

    const { conversation, messages } =
      conversationService.getOrCreateEmployeeConversation(employee.id);

    const tickets = ticketService.listTicketsForAnalystConsole(employee.id);
    const legacyMode = ticketService.getLegacyInstabilityMode();

    return NextResponse.json({
      employee,
      conversation,
      messages,
      tickets,
      legacyMode,
    });
  } catch (err) {
    if (err instanceof UnauthorizedSessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao carregar conversa.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: 'send' | 'new-session';
      employeeId?: string;
      conversationId?: string;
      message?: string;
      preset?: 'empty' | 'vpn-draft';
    };

    const token = extractSessionTokenFromRequest(req);
    const session = sessionService.requireEmployeeSession(token, body.employeeId);
    const employeeId = session.employee.id;

    if (body.action === 'new-session') {
      const { conversation, messages } = conversationService.startFreshConversation(
        employeeId,
        body.preset ?? 'empty'
      );
      const tickets = ticketService.listTicketsForAnalystConsole(employeeId);
      return NextResponse.json({
        conversation,
        messages,
        tickets,
      });
    }

    const messageText = (body.message ?? '').trim();
    if (!messageText) {
      return NextResponse.json({ error: 'Mensagem vazia.' }, { status: 400 });
    }

    const { conversation: currentConv } =
      conversationService.getOrCreateEmployeeConversation(employeeId);

    // Impede que o cliente manipule conversationId de outro colaborador
    if (body.conversationId && body.conversationId !== currentConv.id) {
      return NextResponse.json(
        { error: 'Conversa não pertence ao funcionário autenticado na sessão.' },
        { status: 403 }
      );
    }

    const turnResult = await processEmployeeMessage({
      conversationId: currentConv.id,
      employeeId,
      userMessage: messageText,
    });

    const messages = conversationService.getMessages(turnResult.conversation.id);
    const tickets = ticketService.listTicketsForAnalystConsole(employeeId);

    return NextResponse.json({
      conversation: turnResult.conversation,
      messages,
      tickets,
      agentPaused: turnResult.agentPaused,
      limitReached: turnResult.limitReached,
      error: turnResult.error,
    });
  } catch (err) {
    if (err instanceof UnauthorizedSessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao processar mensagem.' },
      { status: 500 }
    );
  }
}
