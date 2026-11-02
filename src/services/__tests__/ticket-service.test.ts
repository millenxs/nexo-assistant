import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbWithSeeds } from '../db';
import {
  LegacySystemUnavailableError,
  PrivacyViolationError,
  ticketService,
} from '../ticket-service';
import { conversationService } from '../conversation-service';
import {
  ForbiddenRoleError,
  sessionService,
  UnauthorizedSessionError,
} from '../session-service';

describe('SqliteTicketService & Isolamento de Privacidade (Etapa 3)', () => {
  beforeEach(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
    resetDbWithSeeds(':memory:');
  });

  it('retorna apenas os chamados do funcionário autenticado e nunca de terceiros', async () => {
    const anaResult = await ticketService.listTicketsForEmployee('emp-ana');
    expect(anaResult.tickets.length).toBeGreaterThanOrEqual(5);
    expect(anaResult.tickets.every((t) => t.requesterId === 'emp-ana')).toBe(true);

    // Tentativa de Ana Souza consultar o chamado REQ-10501 de Carla Mendes deve lançar PrivacyViolationError
    await expect(
      ticketService.getTicketForEmployee('REQ-10501', 'emp-ana')
    ).rejects.toThrow(PrivacyViolationError);
  });

  it('exige rascunho pendente e confirmação explícita antes de criar ou reabrir chamado', async () => {
    const draft = ticketService.createPendingDraft({
      conversationId: 'conv-ana',
      requesterId: 'emp-ana',
      operation: 'CREATE',
      type: 'INC',
      title: 'VPN não conecta no notebook — erro 809',
      description: 'Notebook Windows 11 com erro 809 ao conectar na VPN antes da reunião.',
      category: 'Rede e VPN',
      priority: 'Alta',
      affectedScope: 'Somente você',
      slaDueLabel: '· resposta até 13:43',
    });

    expect(draft.status).toBe('PENDING_CONFIRMATION');
    expect(draft.code).toMatch(/^D-\d+/);

    // Outro funcionário não pode confirmar o rascunho da Ana
    await expect(ticketService.confirmDraft(draft.id, 'emp-carla')).rejects.toThrow(
      PrivacyViolationError
    );

    // Ana confirma o rascunho -> chamado é criado no banco
    const confirmed = await ticketService.confirmDraft(draft.id, 'emp-ana');
    expect(confirmed.draft.status).toBe('CONFIRMED');
    expect(confirmed.ticket.number).toMatch(/^INC-\d+/);
    expect(confirmed.ticket.priority).toBe('Alta');
  });

  it('simula falha temporária do sistema legado e recuperação via retry', async () => {
    ticketService.setLegacyInstabilityMode('transient');
    const res = await ticketService.listTicketsForEmployee('emp-ana');
    expect(res.retriedLegacyError).toBe(true);
    expect(res.tickets.length).toBeGreaterThan(0);

    ticketService.setLegacyInstabilityMode('down');
    await expect(ticketService.listTicketsForEmployee('emp-ana')).rejects.toThrow(
      LegacySystemUnavailableError
    );

    ticketService.setLegacyInstabilityMode('0');
  });

  it('gerencia o ciclo completo de transferência, takeover do analista e devolução ao agent', () => {
    // Ana começa em WAITING_ANALYST no seed; Rafael assume o atendimento
    const taken = conversationService.analystTakeover('conv-ana', 'ana-rafael');
    expect(taken.status).toBe('WITH_ANALYST');
    expect(taken.assignedAnalystName).toBe('Rafael Lima');

    const msg = conversationService.sendAnalystMessage(
      'conv-ana',
      'ana-rafael',
      'Oi, Ana! Aqui é o Rafael. Vou verificar o driver remotamente.'
    );
    expect(msg.senderType).toBe('analyst');
    expect(msg.senderRole).toBe('Suporte N2');

    const returned = conversationService.returnConversationToAgent('conv-ana', 'Rafael Lima');
    expect(returned.status).toBe('ACTIVE_WITH_AGENT');
  });

  it('valida sessão de servidor e impede personificação (spoofing) de employeeId ou analystId', () => {
    // Sem token -> 401 UnauthorizedSessionError
    expect(() => sessionService.requireEmployeeSession(null)).toThrow(
      UnauthorizedSessionError
    );

    // Cria sessão de servidor para Ana Souza (funcionária)
    const anaSession = sessionService.createSession({
      userId: 'emp-ana',
      role: 'employee',
      userEmail: 'ana.souza@nexo.com.br',
      userName: 'Ana Souza',
    });

    const validatedAna = sessionService.requireEmployeeSession(anaSession.token);
    expect(validatedAna.employee.id).toBe('emp-ana');

    // Tentativa de Ana Souza enviar employeeId de Carla Mendes no payload -> 403 ForbiddenRoleError
    expect(() =>
      sessionService.requireEmployeeSession(anaSession.token, 'emp-carla')
    ).toThrow(ForbiddenRoleError);

    // Tentativa de Ana Souza (role=employee) acessar rota do Console do Analista -> 403 ForbiddenRoleError
    expect(() => sessionService.requireAnalystSession(anaSession.token)).toThrow(
      ForbiddenRoleError
    );

    // Cria sessão de servidor para Rafael Lima (analista)
    const rafaelSession = sessionService.createSession({
      userId: 'ana-rafael',
      role: 'analyst',
      userEmail: 'rafael.lima@nexo.com.br',
      userName: 'Rafael Lima',
    });

    const validatedRafael = sessionService.requireAnalystSession(rafaelSession.token);
    expect(validatedRafael.analyst.id).toBe('ana-rafael');

    // Logout revoga a sessão no banco
    sessionService.revokeSession(anaSession.token);
    expect(() => sessionService.requireEmployeeSession(anaSession.token)).toThrow(
      UnauthorizedSessionError
    );
  });
});
