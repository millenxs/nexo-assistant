export type TicketType = 'INC' | 'REQ';

export type TicketCategory =
  | 'Acesso'
  | 'Rede e VPN'
  | 'Hardware'
  | 'Software'
  | 'E-mail'
  | 'Outros';

export type TicketPriority = 'Crítica' | 'Alta' | 'Média' | 'Baixa';

export type AffectedScope =
  | 'Somente você'
  | 'Minha equipe'
  | 'Toda a empresa'
  | 'Não sei';

export type TicketStatus =
  | 'Aguardando analista'
  | 'Em andamento'
  | 'Em atendimento'
  | 'Aprovado'
  | 'Resolvido';

export type ScopeDepartment = 'TI' | 'RH' | 'Financeiro' | 'Facilities';

export type ConversationStatus =
  | 'ACTIVE_WITH_AGENT'
  | 'WAITING_ANALYST'
  | 'WITH_ANALYST'
  | 'CLOSED';

export type TransferReason =
  | 'USER_REQUESTED'
  | 'CRITICAL_PRIORITY'
  | 'OVERDUE_TICKET'
  | 'LOW_CONFIDENCE'
  | 'LEGACY_SYSTEM_FAILURE';

export interface Employee {
  id: string;
  name: string;
  email: string;
  initials: string;
  department: string;
  role: string;
  os: 'Windows 10' | 'Windows 11' | 'macOS';
  avatarBg: string;
  avatarFg: string;
  passwordChangedDaysAgo: number;
  online: boolean;
}

export interface Analyst {
  id: string;
  name: string;
  email: string;
  initials: string;
  tier: 'Suporte N1' | 'Suporte N2';
  online: boolean;
}

export interface TicketEvent {
  id: string;
  ticketNumber: string;
  type: 'created' | 'updated' | 'reopened' | 'transferred' | 'taken_over' | 'resolved';
  description: string;
  actor: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  number: string;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  subcategory?: string;
  priority: TicketPriority;
  status: TicketStatus;
  affectedScope: AffectedScope;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  assignedAnalystId?: string | null;
  assignedAnalystName?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  slaDueAt: string;
  isOverdue?: boolean;
  overdueLabel?: string;
  lastUpdateRelativeLabel?: string;
  events: TicketEvent[];
}

export type DraftOperation = 'CREATE' | 'UPDATE' | 'REOPEN';

export type DraftStatus = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED';

export interface TicketDraft {
  id: string;
  code: string;
  conversationId: string;
  requesterId: string;
  operation: DraftOperation;
  targetTicketNumber?: string | null;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  affectedScope: AffectedScope;
  slaDueLabel: string;
  status: DraftStatus;
  createdAt: string;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  category: TicketCategory | 'Políticas e Horários';
  summary: string;
  content: string;
  keywords: string[];
  osRestriction?: {
    solvesFor: ('Windows 10' | 'Windows 11' | 'macOS')[];
    requiresTicketFor: ('Windows 10' | 'Windows 11' | 'macOS')[];
    escalationNote: string;
  };
}

export interface DecisionToolCall {
  toolId: string;
  label: string;
  input: Record<string, unknown>;
  outputSummary: string;
  durationMs: number;
  retriedLegacyError?: boolean;
}

export interface DecisionTrace {
  id: string;
  steps: string[];
  intent:
    | 'FAQ_RESOLUTION'
    | 'CHECK_TICKET_STATUS'
    | 'OPEN_TICKET_TRIAGE'
    | 'OPEN_TICKET_DRAFT'
    | 'UPDATE_TICKET_DRAFT'
    | 'REOPEN_TICKET_DRAFT'
    | 'CONFIRM_DRAFT'
    | 'TRANSFER_TO_ANALYST'
    | 'OUT_OF_SCOPE_REDIRECT'
    | 'CLARIFICATION_NEEDED'
    | 'LEGACY_ERROR_FALLBACK';
  scope: ScopeDepartment;
  actionTaken: string;
  confidence: number;
  confidenceLevel: 'Alta' | 'Média' | 'Baixa';
  classification?: {
    type?: TicketType;
    category?: TicketCategory;
    priority?: TicketPriority;
    affectedScope?: AffectedScope;
    slaLabel?: string;
  };
  rulesApplied: string[];
  reasoning: string;
  toolCalls: DecisionToolCall[];
  engine: 'mastra-llm' | 'mastra-deterministic-hybrid';
}

export interface HandoffSummary {
  reason: TransferReason;
  reasonLabel: string;
  targetTier: 'Suporte N1' | 'Suporte N2';
  confidence: number;
  relatedTicketNumber?: string | null;
  summary: string;
  transferredAt: string;
  pausedUntilLabel: string;
}

export interface QuickOption {
  key?: string;
  label: string;
  value: string;
  variant?: 'primary' | 'default';
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: 'employee' | 'agent' | 'analyst' | 'system';
  senderName: string;
  senderRole?: string;
  content: string;
  questionPrompt?: string;
  quickOptions?: QuickOption[];
  ticketSelector?: Ticket[];
  ticketCard?: Ticket;
  draftCard?: TicketDraft;
  decisionTrace?: DecisionTrace;
  systemIcon?: 'transfer' | 'takeover' | 'return' | 'close';
  createdAt: string;
}

export interface Conversation {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeInitials: string;
  employeeDepartment: string;
  employeeAvatarBg: string;
  employeeAvatarFg: string;
  employeeOnline: boolean;
  status: ConversationStatus;
  assignedAnalystId?: string | null;
  assignedAnalystName?: string | null;
  activeTicketNumber?: string | null;
  unreadForAnalyst: number;
  messageCount: number;
  maxMessages: number;
  listTagLabel: string;
  listTagTone: 'danger' | 'warning' | 'success' | 'neutral' | 'primary';
  handoffSummary?: HandoffSummary | null;
  pendingContext?: {
    intent?: string;
    problemDescription?: string;
    suggestedTitle?: string;
    type?: TicketType;
    category?: TicketCategory;
    affectedScope?: AffectedScope;
    hasSameDayDeadline?: boolean;
    blocksWorkCompletely?: boolean;
    targetTicketNumber?: string;
    awaitingField?: 'affectedScope' | 'urgencyOrDeadline' | 'updateDetails' | 'ticketSelection';
  } | null;
  createdAt: string;
  updatedAt: string;
}
