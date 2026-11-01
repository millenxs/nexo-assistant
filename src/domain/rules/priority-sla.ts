import { AffectedScope, Ticket, TicketPriority, TicketType } from '../types';

export interface PriorityEvaluationInput {
  type: TicketType;
  affectedScope: AffectedScope;
  hasSameDayDeadline?: boolean;
  blocksWorkCompletely?: boolean;
}

export interface PriorityEvaluationResult {
  priority: TicketPriority;
  slaDurationLabel: string;
  slaDueLabel: string;
  slaDueAt: string;
  ruleExplanation: string;
}

export interface SlaSpec {
  priority: TicketPriority;
  durationLabel: string;
  is24x7: boolean;
  targetHours: number;
  targetBusinessDays?: number;
}

export const SLA_TABLE: Record<TicketPriority, SlaSpec> = {
  Crítica: {
    priority: 'Crítica',
    durationLabel: '1 hora',
    is24x7: true,
    targetHours: 1,
  },
  Alta: {
    priority: 'Alta',
    durationLabel: '4 horas úteis',
    is24x7: false,
    targetHours: 4,
  },
  Média: {
    priority: 'Média',
    durationLabel: '3 dias úteis',
    is24x7: false,
    targetHours: 30, // 3 dias úteis x 10h úteis (08h às 18h)
    targetBusinessDays: 3,
  },
  Baixa: {
    priority: 'Baixa',
    durationLabel: '5 dias úteis',
    is24x7: false,
    targetHours: 50, // 5 dias úteis x 10h úteis (08h às 18h)
    targetBusinessDays: 5,
  },
};

/**
 * Calcula a prioridade e o prazo (SLA) segundo a matriz determinística do Anexo A:
 * - Crítica: Algo parado para uma equipe ou para a empresa -> 1 hora (plantão 24h)
 * - Alta: Impede uma pessoa de trabalhar, ou há um compromisso no mesmo dia -> 4 horas úteis
 * - Média: Atrapalha, mas há alternativa -> 3 dias úteis
 * - Baixa: Pedidos e melhorias sem urgência -> 5 dias úteis
 */
export function evaluatePriorityAndSla(
  input: PriorityEvaluationInput,
  referenceDate: Date = new Date()
): PriorityEvaluationResult {
  let priority: TicketPriority;
  let ruleExplanation: string;

  if (
    input.type === 'INC' &&
    (input.affectedScope === 'Minha equipe' || input.affectedScope === 'Toda a empresa')
  ) {
    priority = 'Crítica';
    ruleExplanation =
      input.affectedScope === 'Toda a empresa'
        ? 'Incidente afetando toda a empresa (impacto coletivo crítico) → Prioridade Crítica (prazo de 1 hora em plantão 24h).'
        : 'Incidente paralisando uma equipe inteira → Prioridade Crítica (prazo de 1 hora em plantão 24h).';
  } else if (input.hasSameDayDeadline || input.blocksWorkCompletely) {
    priority = 'Alta';
    ruleExplanation = input.hasSameDayDeadline
      ? 'Há compromisso/reunião em risco no mesmo dia → Prioridade Alta (prazo de 4 horas úteis).'
      : 'O problema impede completamente o funcionário de trabalhar → Prioridade Alta (prazo de 4 horas úteis).';
  } else if (input.type === 'REQ') {
    priority = 'Baixa';
    ruleExplanation =
      'Requisição de acesso, equipamento ou melhoria sem urgência no mesmo dia → Prioridade Baixa (prazo de 5 dias úteis).';
  } else {
    priority = 'Média';
    ruleExplanation =
      'Incidente individual que atrapalha o trabalho, mas possui contorno ou sem compromisso imediato em risco → Prioridade Média (prazo de 3 dias úteis).';
  }

  const spec = SLA_TABLE[priority];
  const dueDate = addSlaDuration(referenceDate, spec);
  const hh = String(dueDate.getHours()).padStart(2, '0');
  const mm = String(dueDate.getMinutes()).padStart(2, '0');

  let slaDueLabel: string;
  if (priority === 'Crítica') {
    slaDueLabel = `· resposta em até 1 h (${hh}:${mm})`;
  } else if (priority === 'Alta') {
    slaDueLabel = `· resposta até ${hh}:${mm}`;
  } else if (priority === 'Média') {
    slaDueLabel = '· em até 3 dias úteis';
  } else {
    slaDueLabel = '· em até 5 dias úteis';
  }

  return {
    priority,
    slaDurationLabel: spec.durationLabel,
    slaDueLabel,
    slaDueAt: dueDate.toISOString(),
    ruleExplanation,
  };
}

/**
 * Soma horas corridas (para plantão 24h Crítica) ou horas úteis (seg-sex, 8h às 18h).
 */
export function addSlaDuration(startDate: Date, spec: SlaSpec): Date {
  const result = new Date(startDate.getTime());

  if (spec.is24x7) {
    result.setTime(result.getTime() + spec.targetHours * 60 * 60 * 1000);
    return result;
  }

  let remainingMinutes = spec.targetHours * 60;
  const WORK_START_HOUR = 8;
  const WORK_END_HOUR = 18;

  // Avança minuto a minuto dentro da janela útil (8h-18h, seg-sex)
  while (remainingMinutes > 0) {
    const day = result.getDay();
    const hour = result.getHours();

    if (day === 0) {
      // Domingo -> avança para segunda 08:00
      result.setDate(result.getDate() + 1);
      result.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    if (day === 6) {
      // Sábado -> avança para segunda 08:00
      result.setDate(result.getDate() + 2);
      result.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    if (hour < WORK_START_HOUR) {
      result.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    if (hour >= WORK_END_HOUR) {
      result.setDate(result.getDate() + 1);
      result.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }

    const minutesLeftToday =
      (WORK_END_HOUR - result.getHours()) * 60 - result.getMinutes();
    if (remainingMinutes <= minutesLeftToday) {
      result.setTime(result.getTime() + remainingMinutes * 60 * 1000);
      remainingMinutes = 0;
    } else {
      remainingMinutes -= minutesLeftToday;
      result.setDate(result.getDate() + 1);
      result.setHours(WORK_START_HOUR, 0, 0, 0);
    }
  }

  return result;
}

export interface TicketSlaInspection {
  isOverdue: boolean;
  daysSinceUpdate: number;
  hoursSinceUpdate: number;
  relativeUpdateLabel: string;
  slaTargetLabel: string;
  overdueExplanation: string | null;
}

/**
 * Avalia se um chamado está vencido segundo o Anexo A:
 * "O prazo vale para a primeira resposta e para cada atualização; passado o prazo, o chamado está vencido."
 */
export function inspectTicketSla(
  ticket: Pick<Ticket, 'priority' | 'status' | 'updatedAt' | 'slaDueAt'>,
  referenceNow: Date = new Date()
): TicketSlaInspection {
  const updatedDate = new Date(ticket.updatedAt);
  const diffMs = Math.max(0, referenceNow.getTime() - updatedDate.getTime());
  const hoursSinceUpdate = Math.floor(diffMs / (1000 * 60 * 60));
  const daysSinceUpdate = Math.floor(hoursSinceUpdate / 24);

  const spec = SLA_TABLE[ticket.priority];
  let relativeUpdateLabel: string;
  if (daysSinceUpdate >= 7) {
    const weeks = Math.floor(daysSinceUpdate / 7);
    relativeUpdateLabel = weeks === 1 ? 'há 1 semana' : `há ${weeks} semanas`;
  } else if (daysSinceUpdate >= 1) {
    relativeUpdateLabel = daysSinceUpdate === 1 ? 'há 1 dia' : `há ${daysSinceUpdate} dias`;
  } else if (hoursSinceUpdate >= 1) {
    relativeUpdateLabel = `há ${hoursSinceUpdate} h`;
  } else {
    relativeUpdateLabel = 'há poucos minutos';
  }

  if (ticket.status === 'Resolvido' || ticket.status === 'Aprovado') {
    return {
      isOverdue: false,
      daysSinceUpdate,
      hoursSinceUpdate,
      relativeUpdateLabel,
      slaTargetLabel: spec.durationLabel,
      overdueExplanation: null,
    };
  }

  const slaDueDate = new Date(ticket.slaDueAt);
  const isPastSlaDue = referenceNow.getTime() > slaDueDate.getTime();
  const isOverdueByDays =
    spec.targetBusinessDays !== undefined && daysSinceUpdate > spec.targetBusinessDays;
  const isOverdueByHours =
    spec.targetBusinessDays === undefined && hoursSinceUpdate > spec.targetHours;

  const isOverdue = isPastSlaDue || isOverdueByDays || isOverdueByHours;

  const overdueExplanation = isOverdue
    ? `Está sem atualização ${relativeUpdateLabel}, acima do prazo de ${spec.durationLabel} para prioridade ${ticket.priority.toLowerCase()}.`
    : null;

  return {
    isOverdue,
    daysSinceUpdate,
    hoursSinceUpdate,
    relativeUpdateLabel,
    slaTargetLabel: spec.durationLabel,
    overdueExplanation,
  };
}
