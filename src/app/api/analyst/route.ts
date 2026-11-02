import { NextRequest, NextResponse } from 'next/server';
import { conversationService } from '@/services/conversation-service';
import { ticketService } from '@/services/ticket-service';
import {
  extractSessionTokenFromRequest,
  ForbiddenRoleError,
  sessionService,
  UnauthorizedSessionError,
} from '@/services/session-service';

export async function GET(req: NextRequest) {
  try {
    const token = extractSessionTokenFromRequest(req);
    const claimedAnalystId = req.nextUrl.searchParams.get('analystId');
    const session = sessionService.requireAnalystSession(token, claimedAnalystId);
    const analystId = session.analyst.id;

    const selectedConvId = req.nextUrl.searchParams.get('conversationId');

    const { conversations, counts } = conversationService.listConversationsForConsole(analystId);
    const activeConv =
      conversations.find((c) => c.id === selectedConvId) ?? conversations[0] ?? null;

    const messages = activeConv ? conversationService.getMessages(activeConv.id) : [];
    const employeeTickets = activeConv
      ? ticketService.listTicketsForAnalystConsole(activeConv.employeeId)
      : [];

    return NextResponse.json({
      conversations,
      counts,
      activeConversation: activeConv,
      messages,
      employeeTickets,
    });
  } catch (err) {
    if (err instanceof UnauthorizedSessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao carregar console do analista.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: 'takeover' | 'message' | 'return-to-agent' | 'close';
      conversationId: string;
      analystId?: string;
      content?: string;
    };

    const token = extractSessionTokenFromRequest(req);
    const session = sessionService.requireAnalystSession(token, body.analystId);
    const analystId = session.analyst.id;
    const analystName = session.analyst.name;

    if (body.action === 'takeover') {
      conversationService.analystTakeover(body.conversationId, analystId);
    } else if (body.action === 'message') {
      if (!body.content?.trim()) {
        return NextResponse.json({ error: 'Digite uma mensagem.' }, { status: 400 });
      }
      conversationService.sendAnalystMessage(body.conversationId, analystId, body.content);
    } else if (body.action === 'return-to-agent') {
      conversationService.returnConversationToAgent(body.conversationId, analystName);
    } else if (body.action === 'close') {
      conversationService.closeConversation(body.conversationId, analystName);
    }

    const { conversations, counts } = conversationService.listConversationsForConsole(analystId);
    const activeConv =
      conversations.find((c) => c.id === body.conversationId) ?? conversations[0] ?? null;
    const messages = activeConv ? conversationService.getMessages(activeConv.id) : [];
    const employeeTickets = activeConv
      ? ticketService.listTicketsForAnalystConsole(activeConv.employeeId)
      : [];

    return NextResponse.json({
      conversations,
      counts,
      activeConversation: activeConv,
      messages,
      employeeTickets,
    });
  } catch (err) {
    if (err instanceof UnauthorizedSessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro na ação do analista.' },
      { status: 500 }
    );
  }
}
