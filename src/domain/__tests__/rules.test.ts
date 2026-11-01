import { describe, expect, it } from 'vitest';
import { evaluatePriorityAndSla, inspectTicketSla } from '../rules/priority-sla';
import {
  classifyTicketTypeAndCategory,
  evaluateDuplicateOrReopen,
  evaluateScope,
  evaluateTransferTrigger,
  validateDraftRequirements,
} from '../rules/ticket-rules';
import {
  isAgentAllowedToRespond,
  transitionConversationStatus,
} from '../rules/conversation-state';
import { Ticket } from '../types';

describe('Anexo A — Regras de Prioridade e SLA', () => {
  const refDate = new Date('2026-10-20T09:43:00.000Z');

  it('classifica como Crítica (1h plantão 24h) quando incidente afeta equipe ou toda a empresa', () => {
    const res = evaluatePriorityAndSla(
      {
        type: 'INC',
        affectedScope: 'Minha equipe',
      },
      refDate
    );
    expect(res.priority).toBe('Crítica');
    expect(res.slaDurationLabel).toBe('1 hora');
  });

  it('classifica como Alta (4h úteis) quando há compromisso/reunião no mesmo dia ou bloqueio total', () => {
    const res = evaluatePriorityAndSla(
      {
        type: 'INC',
        affectedScope: 'Somente você',
        hasSameDayDeadline: true,
      },
      refDate
    );
    expect(res.priority).toBe('Alta');
    expect(res.slaDurationLabel).toBe('4 horas úteis');
  });

  it('classifica como Média (3 dias úteis) para incidente individual com alternativa', () => {
    const res = evaluatePriorityAndSla(
      {
        type: 'INC',
        affectedScope: 'Somente você',
        hasSameDayDeadline: false,
        blocksWorkCompletely: false,
      },
      refDate
    );
    expect(res.priority).toBe('Média');
    expect(res.slaDurationLabel).toBe('3 dias úteis');
  });

  it('classifica como Baixa (5 dias úteis) para requisições (REQ) sem urgência', () => {
    const res = evaluatePriorityAndSla(
      {
        type: 'REQ',
        affectedScope: 'Somente você',
      },
      refDate
    );
    expect(res.priority).toBe('Baixa');
    expect(res.slaDurationLabel).toBe('5 dias úteis');
  });

  it('detecta chamado vencido quando última atualização ultrapassa o SLA', () => {
    const now = new Date('2026-10-21T14:00:00.000Z');
    const fiveDaysAgo = new Date('2026-10-16T14:00:00.000Z').toISOString();
    const expiredDue = new Date('2026-10-19T14:00:00.000Z').toISOString();

    const check = inspectTicketSla(
      {
        priority: 'Média',
        status: 'Aguardando analista',
        updatedAt: fiveDaysAgo,
        slaDueAt: expiredDue,
      },
      now
    );

    expect(check.isOverdue).toBe(true);
    expect(check.relativeUpdateLabel).toBe('há 5 dias');
    expect(check.overdueExplanation).toContain('acima do prazo de 3 dias úteis');
  });
});

describe('Anexo A — Escopo, Duplicidade, Reabertura em 7 dias e Transferência', () => {
  it('redireciona solicitações de RH, Financeiro e Facilities, mantendo demandas de TI', () => {
    const rh = evaluateScope('Quero saber sobre minhas férias e holerite');
    expect(rh.isItScope).toBe(false);
    expect(rh.department).toBe('RH');

    const finIt = evaluateScope('Preciso de acesso à pasta Financeiro no SharePoint');
    expect(finIt.isItScope).toBe(true);
    expect(finIt.department).toBe('TI');
  });

  it('diferencia incidente (INC) de requisição (REQ) e mapeia categoria', () => {
    const vpn = classifyTicketTypeAndCategory('Meu notebook não conecta na VPN. Erro 809.');
    expect(vpn.type).toBe('INC');
    expect(vpn.category).toBe('Rede e VPN');

    const monitor = classifyTicketTypeAndCategory('Gostaria de solicitar um segundo monitor para home office');
    expect(monitor.type).toBe('REQ');
    expect(monitor.category).toBe('Hardware');
  });

  it('evita duplicidade atualizando chamado aberto ou reabrindo chamado resolvido há <= 7 dias', () => {
    const now = new Date('2026-10-21T10:00:00.000Z');
    const mockTickets: Ticket[] = [
      {
        id: '1',
        number: 'INC-20311',
        type: 'INC',
        title: 'Notebook lento após atualização do Windows',
        description: 'Lentidão geral desde a atualização',
        category: 'Hardware',
        priority: 'Média',
        status: 'Aguardando analista',
        affectedScope: 'Somente você',
        requesterId: 'emp-ana',
        requesterName: 'Ana Souza',
        requesterEmail: 'ana.souza@nexo.com.br',
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: '2026-10-16T10:00:00.000Z',
        slaDueAt: '2026-10-19T10:00:00.000Z',
        events: [],
      },
      {
        id: '2',
        number: 'INC-20150',
        type: 'INC',
        title: 'Senha do SAP bloqueada',
        description: 'Acesso ao SAP bloqueado após tentativa de login',
        category: 'Acesso',
        priority: 'Média',
        status: 'Resolvido',
        affectedScope: 'Somente você',
        requesterId: 'emp-ana',
        requesterName: 'Ana Souza',
        requesterEmail: 'ana.souza@nexo.com.br',
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: '2026-10-17T10:00:00.000Z',
        resolvedAt: '2026-10-17T10:00:00.000Z', // 4 dias atrás
        slaDueAt: '2026-10-20T10:00:00.000Z',
        events: [],
      },
    ];

    const dupOpen = evaluateDuplicateOrReopen(
      mockTickets,
      'Meu notebook continua muito lento depois da atualização',
      'Hardware',
      now
    );
    expect(dupOpen.action).toBe('UPDATE_OPEN_TICKET');

    const reopenRecent = evaluateDuplicateOrReopen(
      mockTickets,
      'Minha senha do SAP ficou bloqueada novamente hoje',
      'Acesso',
      now
    );
    expect(reopenRecent.action).toBe('REOPEN_RESOLVED_TICKET');
  });

  it('valida todos os campos obrigatórios antes de permitir rascunho de chamado', () => {
    const incomplete = validateDraftRequirements({
      title: 'VPN erro 809',
      type: 'INC',
    });
    expect(incomplete.valid).toBe(false);
    expect(incomplete.missingFields).toContain('descrição');
    expect(incomplete.missingFields).toContain('quem é afetado');
  });

  it('aciona transferência quando usuário pede, caso crítico, chamado vencido ou baixa confiança', () => {
    expect(evaluateTransferTrigger({ confidence: 41 }).shouldTransfer).toBe(true);
    expect(evaluateTransferTrigger({ confidence: 90, priority: 'Crítica' }).shouldTransfer).toBe(true);
    expect(evaluateTransferTrigger({ confidence: 90, isTicketOverdue: true }).shouldTransfer).toBe(true);
    expect(evaluateTransferTrigger({ confidence: 88 }).shouldTransfer).toBe(false);
  });
});

describe('Máquina de Estados da Conversa e Pausa do Agent', () => {
  it('pausa o agent ao transferir para analista e libera ao devolver ao agent', () => {
    const t1 = transitionConversationStatus('ACTIVE_WITH_AGENT', 'TRANSFER_TO_ANALYST');
    expect(t1.nextStatus).toBe('WAITING_ANALYST');
    expect(t1.agentPaused).toBe(true);
    expect(isAgentAllowedToRespond(t1.nextStatus, 10).allowed).toBe(false);

    const t2 = transitionConversationStatus(t1.nextStatus, 'ANALYST_TAKEOVER');
    expect(t2.nextStatus).toBe('WITH_ANALYST');
    expect(t2.agentPaused).toBe(true);

    const t3 = transitionConversationStatus(t2.nextStatus, 'RETURN_TO_AGENT');
    expect(t3.nextStatus).toBe('ACTIVE_WITH_AGENT');
    expect(t3.agentPaused).toBe(false);
    expect(isAgentAllowedToRespond(t3.nextStatus, 10).allowed).toBe(true);
  });

  it('bloqueia o envio quando atinge o limite de 30 mensagens na sessão', () => {
    const check = isAgentAllowedToRespond('ACTIVE_WITH_AGENT', 30, 30);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('30 mensagens');
  });
});
