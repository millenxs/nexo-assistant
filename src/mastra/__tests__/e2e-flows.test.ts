import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbWithSeeds } from '@/services/db';
import { conversationService } from '@/services/conversation-service';
import { ticketService } from '@/services/ticket-service';
import { processEmployeeMessage } from '../orchestrator';

describe('Etapa 7 — Verificação End-to-End de Todos os Fluxos do Desafio', () => {
  beforeEach(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
    resetDbWithSeeds(':memory:');
  });

  it('Cenário Completo: Abertura de chamado com confirmação -> Transferência -> Analista assume -> Devolve ao agent', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    // 1. Funcionária relata problema de VPN no Windows 11
    const t1 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.',
    });
    expect(t1.agentMessage?.questionPrompt).toBe('Quem está sendo afetado?');

    // 2. Funcionária responde quem é afetado + urgência -> Agente monta rascunho sem gravar chamado ainda
    const t2 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.',
    });
    const draft = t2.agentMessage?.draftCard;
    expect(draft).toBeDefined();
    expect(draft!.status).toBe('PENDING_CONFIRMATION');
    expect(draft!.priority).toBe('Alta');

    // 3. Funcionária confirma o rascunho -> Chamado é efetivamente criado no banco
    const t3 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Confirmar',
    });
    expect(t3.agentMessage?.ticketCard).toBeDefined();
    const createdTicketNumber = t3.agentMessage!.ticketCard!.number;
    expect(createdTicketNumber).toMatch(/^INC-\d+/);

    // 4. Funcionária pede para falar com um analista -> Conversa vai para WAITING_ANALYST e agent pausa
    const t4 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Quero falar com um analista.',
    });
    expect(t4.conversation.status).toBe('WAITING_ANALYST');
    expect(t4.agentPaused).toBe(true);
    expect(t4.conversation.handoffSummary?.relatedTicketNumber).toBe(createdTicketNumber);

    // 5. Enquanto aguarda analista, funcionária manda mensagem -> Agent está PAUSADO e NÃO responde
    const t5 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Alguém pode me atender rápido?',
    });
    expect(t5.employeeMessage).toBeDefined();
    expect(t5.agentMessage).toBeUndefined();
    expect(t5.agentPaused).toBe(true);

    // 6. Analista (Rafael Lima) assume a conversa no Console e responde
    const takenConv = conversationService.analystTakeover(conversation.id, 'ana-rafael');
    expect(takenConv.status).toBe('WITH_ANALYST');

    const analystReply = conversationService.sendAnalystMessage(
      conversation.id,
      'ana-rafael',
      'Oi, Ana! Aqui é o Rafael do Suporte N2. Já estou ajustando sua política IKEv2 da VPN.'
    );
    expect(analystReply.senderName).toBe('Rafael Lima');

    // 7. Analista devolve a conversa ao agent -> Agent volta a responder normalmente!
    const returnedConv = conversationService.returnConversationToAgent(
      conversation.id,
      'Rafael Lima'
    );
    expect(returnedConv.status).toBe('ACTIVE_WITH_AGENT');

    const t6 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Qual é o horário de atendimento do service desk?',
    });
    expect(t6.agentPaused).toBe(false);
    expect(t6.agentMessage).toBeDefined();
    expect(t6.agentMessage!.content).toContain('8h às 18h');
  });

  it('Cenário de Indisponibilidade Temporária do Sistema Legado: explica falha e oferece opções sem perder contexto', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    ticketService.setLegacyInstabilityMode('down');

    const turnDown = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Qual o status do meu chamado?',
    });

    expect(turnDown.agentMessage?.decisionTrace?.intent).toBe('LEGACY_ERROR_FALLBACK');
    expect(turnDown.agentMessage?.content).toContain('temporariamente indisponível');

    // Quando o sistema legado volta a ficar estável, a mesma pergunta funciona normalmente
    ticketService.setLegacyInstabilityMode('0');

    const turnRecovered = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Qual o status do meu chamado?',
    });

    expect(turnRecovered.agentMessage?.decisionTrace?.intent).toBe('CHECK_TICKET_STATUS');
    expect(turnRecovered.agentMessage?.ticketSelector?.length).toBe(3);
  });

  it('Cenário de Chamado Duplicado Aberto: atualiza INC-20311 em vez de abrir novo chamado', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    const turn = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Meu notebook continua muito lento depois da atualização, travou a planilha agora.',
    });

    expect(turn.agentMessage?.decisionTrace?.intent).toBe('UPDATE_TICKET_DRAFT');
    expect(turn.agentMessage?.draftCard?.operation).toBe('UPDATE');
    expect(turn.agentMessage?.draftCard?.targetTicketNumber).toBe('INC-20311');
  });
});
