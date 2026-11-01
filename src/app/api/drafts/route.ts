import { NextRequest, NextResponse } from 'next/server';
import {
  AffectedScope,
  TicketCategory,
  TicketPriority,
  TicketType,
} from '@/domain/types';
import {
  LegacySystemUnavailableError,
  PrivacyViolationError,
  ticketService,
} from '@/services/ticket-service';
import { conversationService } from '@/services/conversation-service';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: 'confirm' | 'edit' | 'cancel';
      draftId: string;
      employeeId: string;
      conversationId: string;
      updates?: {
        type?: TicketType;
        title?: string;
        description?: string;
        category?: TicketCategory;
        priority?: TicketPriority;
        affectedScope?: AffectedScope;
      };
    };

    if (!body.draftId || !body.employeeId) {
      return NextResponse.json(
        { error: 'Parâmetros obrigatórios ausentes (draftId, employeeId).' },
        { status: 400 }
      );
    }

    if (body.action === 'confirm') {
      const { ticket, draft, retriedLegacyError } = await ticketService.confirmDraft(
        body.draftId,
        body.employeeId
      );

      conversationService.updatePendingContext(body.conversationId, null, ticket.number);

      const actionVerb =
        draft.operation === 'CREATE'
          ? 'criado'
          : draft.operation === 'REOPEN'
            ? 'reaberto'
            : 'atualizado';

      // Caso seja Prioridade Crítica, já transfere para analista humano segundo o Anexo A
      if (ticket.priority === 'Crítica') {
        conversationService.appendMessage({
          conversationId: body.conversationId,
          senderType: 'agent',
          senderName: 'Nexo Assist',
          senderRole: 'IA',
          content: `Pronto: o chamado **${ticket.number}** foi ${actionVerb} com prioridade **Crítica** (plantão 24h · prazo de 1 hora). Como é um caso crítico, já acionei um analista do Suporte N2 com o resumo do caso.`,
          ticketCard: ticket,
          decisionTrace: {
            id: `dec-conf-crit-${Date.now()}`,
            steps: [
              `confirmou o rascunho ${draft.code}`,
              `criou o ${ticket.number}`,
              'transferiu para Suporte N2 (Crítico)',
            ],
            intent: 'CONFIRM_DRAFT',
            scope: 'TI',
            actionTaken: `Criou chamado crítico ${ticket.number} e transferiu automaticamente para Suporte N2`,
            confidence: 99,
            confidenceLevel: 'Alta',
            classification: {
              type: ticket.type,
              category: ticket.category,
              priority: ticket.priority,
              affectedScope: ticket.affectedScope,
            },
            rulesApplied: [
              'Anexo A (Abertura): Chamado criado após confirmação do funcionário.',
              'Anexo A (Transferência em casos críticos): Casos de Prioridade Crítica são transferidos imediatamente ao analista com resumo.',
            ],
            reasoning:
              'Após a confirmação do chamado de Prioridade Crítica, o agente escalonou automaticamente para o Suporte N2.',
            toolCalls: [
              {
                toolId: 'confirm-ticket-draft',
                label: `criou o ${ticket.number}`,
                input: { draftCode: draft.code },
                outputSummary: `${ticket.number} criado`,
                durationMs: 18,
                retriedLegacyError,
              },
            ],
            engine: 'mastra-deterministic-hybrid',
          },
        });

        conversationService.transferToAnalyst({
          conversationId: body.conversationId,
          handoffSummary: {
            reason: 'CRITICAL_PRIORITY',
            reasonLabel: `Prioridade Crítica · ${ticket.number}`,
            targetTier: 'Suporte N2',
            confidence: 99,
            relatedTicketNumber: ticket.number,
            summary: `Chamado crítico ${ticket.number} ("${ticket.title}") confirmado por ${ticket.requesterName}. Impacto: ${ticket.affectedScope}.`,
            transferredAt: new Date().toISOString(),
            pausedUntilLabel: 'Agent pausado · plantão 24h (1h)',
          },
        });
      } else {
        conversationService.appendMessage({
          conversationId: body.conversationId,
          senderType: 'agent',
          senderName: 'Nexo Assist',
          senderRole: 'IA',
          content: `Pronto: o chamado **${ticket.number}** foi ${actionVerb} com prioridade **${ticket.priority.toLowerCase()}**. Um analista acompanha seu caso dentro do prazo de SLA.`,
          ticketCard: ticket,
          decisionTrace: {
            id: `dec-conf-${Date.now()}`,
            steps: [
              `confirmou o rascunho ${draft.code}`,
              `${draft.operation === 'CREATE' ? 'criou' : draft.operation === 'REOPEN' ? 'reabriu' : 'atualizou'} o ${ticket.number}`,
            ],
            intent: 'CONFIRM_DRAFT',
            scope: 'TI',
            actionTaken: `Gravou o chamado ${ticket.number} (${draft.operation}) no serviço de chamados após confirmação`,
            confidence: 99,
            confidenceLevel: 'Alta',
            classification: {
              type: ticket.type,
              category: ticket.category,
              priority: ticket.priority,
              affectedScope: ticket.affectedScope,
            },
            rulesApplied: [
              'Anexo A (Abertura): O agent mostra um rascunho e só cria ou atualiza o chamado depois da confirmação do funcionário.',
            ],
            reasoning: `O funcionário confirmou o rascunho ${draft.code}. O serviço validou os campos obrigatórios e persistiu o chamado ${ticket.number}.`,
            toolCalls: [
              {
                toolId: 'confirm-ticket-draft',
                label: `confirmou o rascunho ${draft.code}`,
                input: { draftCode: draft.code, operation: draft.operation },
                outputSummary: `${ticket.number} (${ticket.status})`,
                durationMs: 16,
                retriedLegacyError,
              },
            ],
            engine: 'mastra-deterministic-hybrid',
          },
        });
      }
    } else if (body.action === 'edit' && body.updates) {
      ticketService.updateDraft(body.draftId, body.employeeId, body.updates);
    } else if (body.action === 'cancel') {
      const cancelled = ticketService.cancelDraft(body.draftId, body.employeeId);
      conversationService.appendMessage({
        conversationId: body.conversationId,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content: `O rascunho **${cancelled.code}** foi cancelado e nenhum chamado foi aberto. Se quiser descrever outro problema ou ajustar os dados, estou à disposição.`,
      });
    }

    const conversation = conversationService.getConversationById(body.conversationId);
    const messages = conversationService.getMessages(body.conversationId);
    const tickets = ticketService.listTicketsForAnalystConsole(body.employeeId);

    return NextResponse.json({
      conversation,
      messages,
      tickets,
    });
  } catch (err) {
    if (err instanceof PrivacyViolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof LegacySystemUnavailableError) {
      return NextResponse.json({ error: err.message, legacyUnavailable: true }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao processar rascunho.' },
      { status: 500 }
    );
  }
}
