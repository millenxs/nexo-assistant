import {
  AffectedScope,
  ScopeDepartment,
  Ticket,
  TicketCategory,
  TicketPriority,
  TicketType,
  TransferReason,
} from '../types';

export interface ScopeCheckResult {
  isItScope: boolean;
  department: ScopeDepartment;
  redirectMessage?: string;
  ruleApplied: string;
}

const IT_KEYWORDS = [
  'vpn',
  'senha',
  'acesso',
  'pasta',
  'sharepoint',
  'sap',
  'notebook',
  'computador',
  'pc',
  'windows',
  'mac',
  'monitor',
  'teclado',
  'mouse',
  'headset',
  'outlook',
  'e-mail',
  'email',
  'teams',
  'slack',
  'wi-fi',
  'wifi',
  'rede',
  'internet',
  'erro',
  'sistema',
  'software',
  'instalar',
  'licença',
  'licenca',
  'impressora',
  'login',
  'bloquead',
  'lento',
  'travando',
  'atualização',
  'atualizacao',
  'chamado',
  'inc-',
  'req-',
];

const NON_IT_PATTERNS: Array<{
  department: Exclude<ScopeDepartment, 'TI'>;
  keywords: string[];
  redirectMessage: string;
}> = [
  {
    department: 'RH',
    keywords: [
      'férias',
      'ferias',
      'holerite',
      'contracheque',
      'vale-refeição',
      'vale refeicao',
      'vale-transporte',
      'plano de saúde',
      'plano odontológico',
      'atestado médico',
      'demissão',
      'rescisão',
      'benefício',
      'licença maternidade',
    ],
    redirectMessage:
      'Esse assunto é atendido pelo **RH (Pessoas & Cultura)**, não pelo service desk de TI. Você pode abrir uma solicitação no Portal do Colaborador > RH ou enviar um e-mail para `rh@nexo.com.br`.',
  },
  {
    department: 'Financeiro',
    keywords: [
      'reembolso',
      'nota fiscal',
      'pagamento de fornecedor',
      'adiantamento de viagem',
      'prestação de contas',
      'fatura',
      'boleto',
    ],
    redirectMessage:
      'Esse assunto pertence ao **Financeiro**, fora do escopo do service desk de TI. Encaminhe sua solicitação pelo Portal Financeiro (Concur/ERP) ou para `financeiro.atendimento@nexo.com.br`.',
  },
  {
    department: 'Facilities',
    keywords: [
      'ar-condicionado',
      'ar condicionado',
      'cadeira quebrada',
      'lâmpada',
      'lampada',
      'limpeza',
      'máquina de café',
      'estacionamento',
      'banheiro',
      'manutenção predial',
      'chave do armário',
    ],
    redirectMessage:
      'Esse pedido é de responsabilidade de **Facilities (Infraestrutura Predial)**, fora do escopo de TI. Abra um chamado predial no ramal 4100 ou pelo e-mail `facilities@nexo.com.br`.',
  },
];

/**
 * Verifica se a solicitação pertence ao escopo de TI ou se deve ser redirecionada
 * para RH, Financeiro ou Facilities (Anexo A — Escopo).
 */
export function evaluateScope(userMessage: string): ScopeCheckResult {
  const normalized = userMessage.toLowerCase();

  // Se menciona explicitamente um ativo de TI (ex.: "acesso à pasta Financeiro no SharePoint"), é TI!
  const hasExplicitItAsset = IT_KEYWORDS.some((kw) => normalized.includes(kw));

  for (const group of NON_IT_PATTERNS) {
    const matchedKeyword = group.keywords.find((kw) => normalized.includes(kw));
    if (matchedKeyword && !hasExplicitItAsset) {
      return {
        isItScope: false,
        department: group.department,
        redirectMessage: group.redirectMessage,
        ruleApplied: `Anexo A (Escopo): Assunto identificado como '${group.department}' (termo: '${matchedKeyword}') — redirecionado sem abrir chamado de TI.`,
      };
    }
  }

  return {
    isItScope: true,
    department: 'TI',
    ruleApplied: 'Anexo A (Escopo): Demanda validada dentro do escopo do Service Desk de TI.',
  };
}

/**
 * Classifica tipo de chamado (INC vs REQ) e categoria segundo o Anexo A:
 * - INC (incidente): quando algo parou ou não funciona
 * - REQ (requisição): quando é um pedido de acesso, equipamento ou software
 * - Categorias: Acesso, Rede e VPN, Hardware, Software, E-mail e Outros
 */
export function classifyTicketTypeAndCategory(text: string): {
  type: TicketType;
  category: TicketCategory;
  suggestedTitle: string;
} {
  const lower = text.toLowerCase();

  const isRequest =
    (lower.includes('preciso de') ||
      lower.includes('solicitar') ||
      lower.includes('pedido') ||
      lower.includes('gostaria de') ||
      lower.includes('quero um') ||
      lower.includes('segundo monitor') ||
      lower.includes('instalar') ||
      lower.includes('liberar acesso') ||
      lower.includes('novo acesso')) &&
    !lower.includes('erro') &&
    !lower.includes('não conecta') &&
    !lower.includes('nao conecta') &&
    !lower.includes('parou') &&
    !lower.includes('lento') &&
    !lower.includes('bloquead') &&
    !lower.includes('não funciona') &&
    !lower.includes('nao funciona');

  const type: TicketType = isRequest ? 'REQ' : 'INC';

  let category: TicketCategory = 'Outros';
  let suggestedTitle = text.trim();

  if (lower.includes('vpn') || lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('rede') || lower.includes('internet') || lower.includes('809')) {
    category = 'Rede e VPN';
    if (lower.includes('809') || lower.includes('vpn')) {
      suggestedTitle = 'VPN não conecta no notebook — erro 809';
    }
  } else if (
    lower.includes('senha') ||
    lower.includes('acesso') ||
    lower.includes('login') ||
    lower.includes('bloquead') ||
    lower.includes('sharepoint') ||
    lower.includes('permissão') ||
    lower.includes('permissao') ||
    lower.includes('sap')
  ) {
    category = 'Acesso';
    if (lower.includes('sap')) {
      suggestedTitle = lower.includes('bloquead') || lower.includes('senha')
        ? 'Senha do SAP bloqueada'
        : 'Liberação de acesso ao SAP';
    } else if (lower.includes('sharepoint') || lower.includes('financeiro')) {
      suggestedTitle = 'Acesso à pasta Financeiro no SharePoint';
    }
  } else if (
    lower.includes('outlook') ||
    lower.includes('e-mail') ||
    lower.includes('email') ||
    lower.includes('caixa de entrada')
  ) {
    category = 'E-mail';
    if (lower.includes('outlook')) {
      suggestedTitle = 'Problema de sincronização no Outlook';
    }
  } else if (
    lower.includes('monitor') ||
    lower.includes('notebook') ||
    lower.includes('teclado') ||
    lower.includes('mouse') ||
    lower.includes('headset') ||
    lower.includes('bateria') ||
    lower.includes('tela') ||
    lower.includes('lento')
  ) {
    category = 'Hardware';
    if (lower.includes('monitor')) {
      suggestedTitle = 'Segundo monitor para home office';
    } else if (lower.includes('lento')) {
      suggestedTitle = 'Notebook lento após atualização do Windows';
    }
  } else if (
    lower.includes('software') ||
    lower.includes('excel') ||
    lower.includes('word') ||
    lower.includes('teams') ||
    lower.includes('zoom') ||
    lower.includes('licença') ||
    lower.includes('instalar')
  ) {
    category = 'Software';
  }

  if (suggestedTitle.length > 72) {
    suggestedTitle = suggestedTitle.slice(0, 69).trim() + '...';
  }

  return { type, category, suggestedTitle };
}

export type DuplicateCheckOutcome =
  | {
      action: 'UPDATE_OPEN_TICKET';
      matchedTicket: Ticket;
      reason: string;
    }
  | {
      action: 'REOPEN_RESOLVED_TICKET';
      matchedTicket: Ticket;
      daysSinceResolved: number;
      reason: string;
    }
  | {
      action: 'CREATE_NEW_TICKET';
      reason: string;
    };

const STOP_WORDS = new Set([
  'meu',
  'minha',
  'nao',
  'não',
  'esta',
  'está',
  'com',
  'para',
  'uma',
  'por',
  'que',
  'como',
  'mais',
  'muito',
  'ontem',
  'hoje',
  'ainda',
  'preciso',
  'quero',
  'abrir',
  'chamado',
  'problema',
  'notebook',
  'computador',
  'windows',
  'desde',
  'aparece',
  'erro',
]);

function extractSignificantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Regra de Sem Duplicidade e Reabertura (Anexo A):
 * - "Se já existe um chamado aberto sobre o mesmo problema, ele é atualizado, não duplicado."
 * - "Chamados resolvidos há até 7 dias podem ser reabertos."
 */
export function evaluateDuplicateOrReopen(
  employeeTickets: Ticket[],
  problemText: string,
  category: TicketCategory,
  referenceNow: Date = new Date()
): DuplicateCheckOutcome {
  const inputTokens = extractSignificantTokens(problemText);

  const sharesProblemContext = (ticket: Ticket): boolean => {
    const ticketTokens = extractSignificantTokens(`${ticket.title} ${ticket.description}`);
    const strongKeywords = ['sap', 'vpn', '809', 'monitor', 'sharepoint', 'lento', 'lentidao', 'outlook'];
    const matchedStrong = strongKeywords.some(
      (kw) => inputTokens.includes(kw) && ticketTokens.includes(kw)
    );
    if (matchedStrong) return true;

    if (ticket.category !== category) return false;
    const overlap = inputTokens.filter((token) => ticketTokens.includes(token));
    return overlap.length >= 2;
  };

  // 1. Verifica chamados abertos do funcionário sobre o mesmo problema
  const openTickets = employeeTickets.filter((t) => t.status !== 'Resolvido');
  for (const ticket of openTickets) {
    if (sharesProblemContext(ticket)) {
      return {
        action: 'UPDATE_OPEN_TICKET',
        matchedTicket: ticket,
        reason: `Anexo A (Sem duplicidade): Encontrado chamado aberto ${ticket.number} ("${ticket.title}") sobre o mesmo tema. Ele deve ser atualizado em vez de duplicado.`,
      };
    }
  }

  // 2. Verifica chamados resolvidos há até 7 dias sobre o mesmo problema
  const resolvedTickets = employeeTickets.filter((t) => t.status === 'Resolvido');
  for (const ticket of resolvedTickets) {
    if (sharesProblemContext(ticket)) {
      const resolvedDate = new Date(ticket.resolvedAt || ticket.updatedAt);
      const diffMs = Math.max(0, referenceNow.getTime() - resolvedDate.getTime());
      const daysSinceResolved = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (daysSinceResolved <= 7) {
        return {
          action: 'REOPEN_RESOLVED_TICKET',
          matchedTicket: ticket,
          daysSinceResolved,
          reason: `Anexo A (Sem duplicidade / Reabertura): O chamado ${ticket.number} ("${ticket.title}") foi resolvido há ${daysSinceResolved} dias (dentro do limite de 7 dias) e pode ser reaberto.`,
        };
      }
    }
  }

  return {
    action: 'CREATE_NEW_TICKET',
    reason: `Anexo A (Sem duplicidade): Nenhum chamado aberto ou resolvido nos últimos 7 dias sobre "${category}" com o mesmo problema.`,
  };
}

export interface DraftValidationInput {
  title?: string;
  description?: string;
  type?: TicketType;
  category?: TicketCategory;
  priority?: TicketPriority;
  affectedScope?: AffectedScope;
}

export function validateDraftRequirements(input: DraftValidationInput): {
  valid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  if (!input.title || input.title.trim().length < 5) missingFields.push('título');
  if (!input.description || input.description.trim().length < 10) missingFields.push('descrição');
  if (!input.type) missingFields.push('tipo (INC/REQ)');
  if (!input.category) missingFields.push('categoria');
  if (!input.priority) missingFields.push('prioridade');
  if (!input.affectedScope) missingFields.push('quem é afetado');

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

export interface TransferEvaluationInput {
  userRequestedTransfer?: boolean;
  priority?: TicketPriority;
  isTicketOverdue?: boolean;
  confidence: number;
  legacySystemFailed?: boolean;
}

export interface TransferEvaluationResult {
  shouldTransfer: boolean;
  reason?: TransferReason;
  reasonLabel?: string;
  targetTier: 'Suporte N1' | 'Suporte N2';
}

/**
 * Avalia os critérios de transferência para analista do Anexo A:
 * "Transferência: acontece quando o funcionário pede, em casos críticos,
 * em chamados vencidos ou quando o agent não tem segurança sobre o que fazer."
 */
export function evaluateTransferTrigger(
  input: TransferEvaluationInput
): TransferEvaluationResult {
  if (input.userRequestedTransfer) {
    return {
      shouldTransfer: true,
      reason: 'USER_REQUESTED',
      reasonLabel: 'Solicitado pelo funcionário',
      targetTier: 'Suporte N2',
    };
  }

  if (input.priority === 'Crítica') {
    return {
      shouldTransfer: true,
      reason: 'CRITICAL_PRIORITY',
      reasonLabel: 'Caso crítico (Prioridade Crítica)',
      targetTier: 'Suporte N2',
    };
  }

  if (input.isTicketOverdue) {
    return {
      shouldTransfer: true,
      reason: 'OVERDUE_TICKET',
      reasonLabel: 'Chamado com prazo vencido',
      targetTier: 'Suporte N2',
    };
  }

  if (input.legacySystemFailed) {
    return {
      shouldTransfer: true,
      reason: 'LEGACY_SYSTEM_FAILURE',
      reasonLabel: 'Sistema legado indisponível',
      targetTier: 'Suporte N1',
    };
  }

  if (input.confidence < 60) {
    return {
      shouldTransfer: true,
      reason: 'LOW_CONFIDENCE',
      reasonLabel: `Agent pediu ajuda · confiança ${input.confidence}%`,
      targetTier: 'Suporte N1',
    };
  }

  return {
    shouldTransfer: false,
    targetTier: 'Suporte N1',
  };
}
