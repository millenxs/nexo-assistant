import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbWithSeeds } from '@/services/db';
import { conversationService } from '@/services/conversation-service';
import { processEmployeeMessage } from '../orchestrator';

describe('Fluxo Conversacional do Agente Mastra & Decisões (Etapas 4 e 5)', () => {
  beforeEach(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
    resetDbWithSeeds(':memory:');
  });

  it('Fluxo Tela 2 (.pen): VPN erro 809 no Windows 11 pergunta quem é afetado e monta rascunho Alta com confirmação', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    // Turno 1: Ana (Windows 11) relata erro 809 na VPN
    const turn1 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.',
    });

    expect(turn1.agentMessage).toBeDefined();
    expect(turn1.agentMessage!.content).toContain('Windows 10');
    expect(turn1.agentMessage!.content).toContain('Windows 11');
    expect(turn1.agentMessage!.questionPrompt).toBe('Quem está sendo afetado?');
    expect(turn1.agentMessage!.quickOptions?.length).toBe(4);
    expect(turn1.agentMessage!.decisionTrace?.steps).toEqual([
      'consultou seus chamados',
      'buscou na central de ajuda',
    ]);

    // Turno 2: Ana informa impacto individual + reunião às 14h
    const turn2 = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.',
    });

    expect(turn2.agentMessage?.draftCard).toBeDefined();
    expect(turn2.agentMessage?.draftCard?.priority).toBe('Alta');
    expect(turn2.agentMessage?.draftCard?.category).toBe('Rede e VPN');
    expect(turn2.agentMessage?.draftCard?.status).toBe('PENDING_CONFIRMATION');
    expect(turn2.agentMessage?.decisionTrace?.steps).toEqual([
      'classificou a prioridade',
      'consultou o SLA',
      'montou o rascunho',
    ]);
  });

  it('Resolução sem fila: em Windows 10 (Fábio Nunes), o erro 809 da VPN é resolvido pela Central de Ajuda sem abrir chamado', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-fabio', 'empty');

    const turn = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-fabio',
      userMessage: 'Meu notebook não conecta na VPN e mostra o erro 809.',
    });

    expect(turn.agentMessage?.decisionTrace?.intent).toBe('FAQ_RESOLUTION');
    expect(turn.agentMessage?.content).toContain('reinstale o cliente de VPN');
    expect(turn.agentMessage?.draftCard).toBeUndefined();
  });

  it('Sem duplicidade e Reabertura em 7 dias: propõe reabrir INC-20150 (Senha do SAP bloqueada há 4 dias)', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    const turn = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Minha senha do SAP ficou bloqueada novamente hoje.',
    });

    expect(turn.agentMessage?.decisionTrace?.intent).toBe('REOPEN_TICKET_DRAFT');
    expect(turn.agentMessage?.draftCard?.operation).toBe('REOPEN');
    expect(turn.agentMessage?.draftCard?.targetTicketNumber).toBe('INC-20150');
  });

  it('Redireciona assuntos fora de TI (RH, Financeiro, Facilities) sem abrir chamado', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    const turn = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Como solicito o reembolso da nota fiscal do táxi?',
    });

    expect(turn.agentMessage?.decisionTrace?.intent).toBe('OUT_OF_SCOPE_REDIRECT');
    expect(turn.agentMessage?.decisionTrace?.scope).toBe('Financeiro');
    expect(turn.agentMessage?.draftCard).toBeUndefined();
  });

  it('Bloqueia acesso a chamado de outro funcionário (Privacidade Anexo A)', async () => {
    const { conversation } = conversationService.startFreshConversation('emp-ana', 'empty');

    const turn = await processEmployeeMessage({
      conversationId: conversation.id,
      employeeId: 'emp-ana',
      userMessage: 'Qual o status do chamado REQ-10501?',
    });

    expect(turn.agentMessage?.content).toContain('outro colaborador');
    expect(turn.agentMessage?.decisionTrace?.rulesApplied[0]).toContain('Privacidade');
  });
});
