import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { kbService } from '@/services/kb-service';
import { PrivacyViolationError, ticketService } from '@/services/ticket-service';
import { evaluatePriorityAndSla, inspectTicketSla } from '@/domain/rules/priority-sla';
import { evaluateDuplicateOrReopen } from '@/domain/rules/ticket-rules';
import { conversationService } from '@/services/conversation-service';

export async function execSearchHelpCenter(inputData: {
  query: string;
  employeeOs?: 'Windows 10' | 'Windows 11' | 'macOS';
}) {
  const res = kbService.searchArticles(inputData.query, inputData.employeeOs);
  return {
    matchedCount: res.articles.length,
    articles: res.articles.map((a) => ({
      id: a.article.id,
      title: a.article.title,
      category: a.article.category,
      summary: a.article.summary,
      content: a.article.content,
      solvesWithoutTicket: a.solvesWithoutTicket,
      osEscalationReason: a.osEscalationReason,
    })),
  };
}

export const searchHelpCenterTool = createTool({
  id: 'search-help-center',
  description:
    'Busca artigos na Central de Ajuda da Nexo para resolver dúvidas sem abrir chamado ou verificar restrições de sistema operacional (ex.: Windows 10 vs Windows 11).',
  inputSchema: z.object({
    query: z.string().describe('Termos da dúvida ou erro relatado pelo funcionário'),
    employeeOs: z
      .enum(['Windows 10', 'Windows 11', 'macOS'])
      .optional()
      .describe('Sistema operacional do funcionário'),
  }),
  outputSchema: z.object({
    matchedCount: z.number(),
    articles: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        category: z.string(),
        summary: z.string(),
        content: z.string(),
        solvesWithoutTicket: z.boolean(),
        osEscalationReason: z.string().optional(),
      })
    ),
  }),
  execute: async (inputData) => execSearchHelpCenter(inputData),
});

export async function execListMyTickets(inputData: {
  authenticatedEmployeeId: string;
  onlyOpen?: boolean;
}) {
  const { tickets, retriedLegacyError } = await ticketService.listTicketsForEmployee(
    inputData.authenticatedEmployeeId,
    { onlyOpen: inputData.onlyOpen }
  );
  return {
    count: tickets.length,
    retriedLegacyError,
    tickets: tickets.map((t) => ({
      number: t.number,
      type: t.type,
      title: t.title,
      category: t.category,
      priority: t.priority,
      status: t.status,
      isOverdue: Boolean(t.isOverdue),
      lastUpdateRelativeLabel: t.lastUpdateRelativeLabel ?? 'recente',
    })),
  };
}

export const listMyTicketsTool = createTool({
  id: 'list-my-tickets',
  description:
    'Lista exclusivamente os chamados do funcionário autenticado (isolamento por requesterId), incluindo cálculo de SLA e indicador de atraso.',
  inputSchema: z.object({
    authenticatedEmployeeId: z.string().describe('ID do funcionário autenticado na sessão'),
    onlyOpen: z.boolean().optional().describe('Se verdadeiro, retorna apenas chamados abertos'),
  }),
  outputSchema: z.object({
    count: z.number(),
    retriedLegacyError: z.boolean(),
    tickets: z.array(
      z.object({
        number: z.string(),
        type: z.enum(['INC', 'REQ']),
        title: z.string(),
        category: z.string(),
        priority: z.enum(['Crítica', 'Alta', 'Média', 'Baixa']),
        status: z.string(),
        isOverdue: z.boolean(),
        lastUpdateRelativeLabel: z.string(),
      })
    ),
  }),
  execute: async (inputData) => execListMyTickets(inputData),
});

export async function execInspectTicketDetail(inputData: {
  ticketNumber: string;
  authenticatedEmployeeId: string;
}) {
  try {
    const { ticket, retriedLegacyError } = await ticketService.getTicketForEmployee(
      inputData.ticketNumber,
      inputData.authenticatedEmployeeId
    );

    if (!ticket) {
      return {
        found: false,
        privacyDenied: false,
        retriedLegacyError,
        message: `Chamado ${inputData.ticketNumber} não encontrado entre os seus chamados.`,
        ticket: null,
      };
    }

    const sla = inspectTicketSla(ticket);
    return {
      found: true,
      privacyDenied: false,
      retriedLegacyError,
      message:
        sla.overdueExplanation ??
        `Chamado ${ticket.number} dentro do prazo (${sla.slaTargetLabel}).`,
      ticket: {
        number: ticket.number,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        isOverdue: sla.isOverdue,
        overdueExplanation: sla.overdueExplanation,
        lastUpdateRelativeLabel: sla.relativeUpdateLabel,
      },
    };
  } catch (err) {
    if (err instanceof PrivacyViolationError) {
      return {
        found: false,
        privacyDenied: true,
        retriedLegacyError: false,
        message: err.message,
        ticket: null,
      };
    }
    throw err;
  }
}

export const inspectTicketDetailTool = createTool({
  id: 'inspect-ticket-detail',
  description:
    'Consulta os detalhes e o SLA de um chamado específico garantindo que pertence ao funcionário autenticado.',
  inputSchema: z.object({
    ticketNumber: z.string().describe('Código do chamado (ex.: INC-20311 ou REQ-10442)'),
    authenticatedEmployeeId: z.string().describe('ID do funcionário autenticado'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    privacyDenied: z.boolean(),
    retriedLegacyError: z.boolean(),
    message: z.string(),
    ticket: z
      .object({
        number: z.string(),
        title: z.string(),
        description: z.string(),
        category: z.string(),
        priority: z.enum(['Crítica', 'Alta', 'Média', 'Baixa']),
        status: z.string(),
        isOverdue: z.boolean(),
        overdueExplanation: z.string().nullable(),
        lastUpdateRelativeLabel: z.string(),
      })
      .nullable(),
  }),
  execute: async (inputData) => execInspectTicketDetail(inputData),
});

export async function execCheckDuplicateOrReopen(inputData: {
  authenticatedEmployeeId: string;
  problemText: string;
  category: 'Acesso' | 'Rede e VPN' | 'Hardware' | 'Software' | 'E-mail' | 'Outros';
}) {
  const { tickets } = await ticketService.listTicketsForEmployee(
    inputData.authenticatedEmployeeId
  );
  const check = evaluateDuplicateOrReopen(tickets, inputData.problemText, inputData.category);

  return {
    action: check.action,
    matchedTicketNumber:
      check.action === 'CREATE_NEW_TICKET' ? null : check.matchedTicket.number,
    reason: check.reason,
  };
}

export const checkDuplicateOrReopenTool = createTool({
  id: 'check-duplicate-or-reopen',
  description:
    'Verifica se o funcionário já possui chamado aberto sobre o mesmo problema (atualizar sem duplicar) ou resolvido há até 7 dias (reabrir).',
  inputSchema: z.object({
    authenticatedEmployeeId: z.string(),
    problemText: z.string(),
    category: z.enum(['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros']),
  }),
  outputSchema: z.object({
    action: z.enum(['UPDATE_OPEN_TICKET', 'REOPEN_RESOLVED_TICKET', 'CREATE_NEW_TICKET']),
    matchedTicketNumber: z.string().nullable(),
    reason: z.string(),
  }),
  execute: async (inputData) => execCheckDuplicateOrReopen(inputData),
});

export async function execEvaluatePriorityAndSla(inputData: {
  type: 'INC' | 'REQ';
  affectedScope: 'Somente você' | 'Minha equipe' | 'Toda a empresa' | 'Não sei';
  hasSameDayDeadline?: boolean;
  blocksWorkCompletely?: boolean;
}) {
  const res = evaluatePriorityAndSla(inputData);
  return {
    priority: res.priority,
    slaDurationLabel: res.slaDurationLabel,
    slaDueLabel: res.slaDueLabel,
    ruleExplanation: res.ruleExplanation,
  };
}

export const evaluatePriorityAndSlaTool = createTool({
  id: 'evaluate-priority-and-sla',
  description:
    'Calcula prioridade (Crítica, Alta, Média, Baixa) e prazo (SLA) segundo as regras determinísticas de Impacto x Urgência do Anexo A.',
  inputSchema: z.object({
    type: z.enum(['INC', 'REQ']),
    affectedScope: z.enum(['Somente você', 'Minha equipe', 'Toda a empresa', 'Não sei']),
    hasSameDayDeadline: z.boolean().optional(),
    blocksWorkCompletely: z.boolean().optional(),
  }),
  outputSchema: z.object({
    priority: z.enum(['Crítica', 'Alta', 'Média', 'Baixa']),
    slaDurationLabel: z.string(),
    slaDueLabel: z.string(),
    ruleExplanation: z.string(),
  }),
  execute: async (inputData) => execEvaluatePriorityAndSla(inputData),
});

export const prepareTicketDraftTool = createTool({
  id: 'prepare-ticket-draft',
  description:
    'Monta um rascunho de chamado (CREATE, UPDATE ou REOPEN) com status PENDING_CONFIRMATION. Nunca grava o chamado sem confirmação do funcionário.',
  inputSchema: z.object({
    conversationId: z.string(),
    authenticatedEmployeeId: z.string(),
    operation: z.enum(['CREATE', 'UPDATE', 'REOPEN']),
    targetTicketNumber: z.string().nullable().optional(),
    type: z.enum(['INC', 'REQ']),
    title: z.string(),
    description: z.string(),
    category: z.enum(['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros']),
    priority: z.enum(['Crítica', 'Alta', 'Média', 'Baixa']),
    affectedScope: z.enum(['Somente você', 'Minha equipe', 'Toda a empresa', 'Não sei']),
    slaDueLabel: z.string(),
  }),
  outputSchema: z.object({
    draftCode: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
  execute: async (inputData) => {
    const draft = ticketService.createPendingDraft({
      conversationId: inputData.conversationId,
      requesterId: inputData.authenticatedEmployeeId,
      operation: inputData.operation,
      targetTicketNumber: inputData.targetTicketNumber,
      type: inputData.type,
      title: inputData.title,
      description: inputData.description,
      category: inputData.category,
      priority: inputData.priority,
      affectedScope: inputData.affectedScope,
      slaDueLabel: inputData.slaDueLabel,
    });

    return {
      draftCode: draft.code,
      status: draft.status,
      priority: draft.priority,
    };
  },
});

export async function execRequestAnalystTransfer(inputData: {
  conversationId: string;
  reason:
    | 'USER_REQUESTED'
    | 'CRITICAL_PRIORITY'
    | 'OVERDUE_TICKET'
    | 'LOW_CONFIDENCE'
    | 'LEGACY_SYSTEM_FAILURE';
  reasonLabel: string;
  targetTier: 'Suporte N1' | 'Suporte N2';
  confidence: number;
  relatedTicketNumber?: string | null;
  summary: string;
}) {
  const updated = conversationService.transferToAnalyst({
    conversationId: inputData.conversationId,
    handoffSummary: {
      reason: inputData.reason,
      reasonLabel: inputData.reasonLabel,
      targetTier: inputData.targetTier,
      confidence: inputData.confidence,
      relatedTicketNumber: inputData.relatedTicketNumber ?? null,
      summary: inputData.summary,
      transferredAt: new Date().toISOString(),
      pausedUntilLabel: 'Agent pausado · aguardando atendente',
    },
  });

  return {
    status: updated.status,
    targetTier: inputData.targetTier,
  };
}

export const requestAnalystTransferTool = createTool({
  id: 'request-analyst-transfer',
  description:
    'Transfere a conversa para um analista humano (Suporte N1 ou N2) com um resumo estruturado do caso e pausa o agent.',
  inputSchema: z.object({
    conversationId: z.string(),
    reason: z.enum([
      'USER_REQUESTED',
      'CRITICAL_PRIORITY',
      'OVERDUE_TICKET',
      'LOW_CONFIDENCE',
      'LEGACY_SYSTEM_FAILURE',
    ]),
    reasonLabel: z.string(),
    targetTier: z.enum(['Suporte N1', 'Suporte N2']),
    confidence: z.number(),
    relatedTicketNumber: z.string().nullable().optional(),
    summary: z.string(),
  }),
  outputSchema: z.object({
    status: z.string(),
    targetTier: z.string(),
  }),
  execute: async (inputData) => execRequestAnalystTransfer(inputData),
});

export const nexoTools = {
  searchHelpCenterTool,
  listMyTicketsTool,
  inspectTicketDetailTool,
  checkDuplicateOrReopenTool,
  evaluatePriorityAndSlaTool,
  prepareTicketDraftTool,
  requestAnalystTransferTool,
};
