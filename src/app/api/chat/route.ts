import { NextRequest, NextResponse } from 'next/server';
import { conversationService } from '@/services/conversation-service';
import { ticketService } from '@/services/ticket-service';
import { processEmployeeMessage } from '@/mastra/orchestrator';

export async function GET(req: NextRequest) {
  try {
    const employeeId = req.nextUrl.searchParams.get('employeeId') || 'emp-ana';
    const employee = conversationService.getEmployeeById(employeeId);
    if (!employee) {
      return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
    }

    const { conversation, messages } =
      conversationService.getOrCreateEmployeeConversation(employee.id);

    // Busca chamados do funcionário para exibir no Perfil sem depender de falha simulada
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

    const employeeId = body.employeeId || 'emp-ana';

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

    const turnResult = await processEmployeeMessage({
      conversationId: body.conversationId || currentConv.id,
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao processar mensagem.' },
      { status: 500 }
    );
  }
}
