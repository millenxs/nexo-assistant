import {
  AffectedScope,
  DraftOperation,
  Ticket,
  TicketCategory,
  TicketDraft,
  TicketEvent,
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@/domain/types';
import { evaluatePriorityAndSla, inspectTicketSla } from '@/domain/rules/priority-sla';
import { validateDraftRequirements } from '@/domain/rules/ticket-rules';
import { getDb } from './db';

export class PrivacyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivacyViolationError';
  }
}

export class LegacySystemUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacySystemUnavailableError';
  }
}

interface TicketRow {
  id: string;
  number: string;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  subcategory: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  affected_scope: AffectedScope;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  assigned_analyst_id: string | null;
  assigned_analyst_name: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  sla_due_at: string;
}

interface TicketEventRow {
  id: string;
  ticket_number: string;
  type: TicketEvent['type'];
  description: string;
  actor: string;
  created_at: string;
}

interface DraftRow {
  id: string;
  code: string;
  conversation_id: string;
  requester_id: string;
  operation: DraftOperation;
  target_ticket_number: string | null;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  affected_scope: AffectedScope;
  sla_due_label: string;
  status: TicketDraft['status'];
  created_at: string;
}

export interface ITicketService {
  listTicketsForEmployee(
    authenticatedEmployeeId: string,
    options?: { onlyOpen?: boolean }
  ): Promise<{ tickets: Ticket[]; retriedLegacyError: boolean }>;

  getTicketForEmployee(
    ticketNumber: string,
    authenticatedEmployeeId: string
  ): Promise<{ ticket: Ticket | null; retriedLegacyError: boolean }>;

  createPendingDraft(input: {
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
  }): TicketDraft;

  confirmDraft(
    draftIdOrCode: string,
    authenticatedEmployeeId: string
  ): Promise<{ ticket: Ticket; draft: TicketDraft; retriedLegacyError: boolean }>;
}

function hydrateTicket(row: TicketRow, events: TicketEvent[]): Ticket {
  const slaInspection = inspectTicketSla({
    priority: row.priority,
    status: row.status,
    updatedAt: row.updated_at,
    slaDueAt: row.sla_due_at,
  });

  return {
    id: row.id,
    number: row.number,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory ?? undefined,
    priority: row.priority,
    status: row.status,
    affectedScope: row.affected_scope,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    assignedAnalystId: row.assigned_analyst_id,
    assignedAnalystName: row.assigned_analyst_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    slaDueAt: row.sla_due_at,
    isOverdue: slaInspection.isOverdue,
    overdueLabel: slaInspection.isOverdue ? '· prazo vencido' : undefined,
    lastUpdateRelativeLabel: slaInspection.relativeUpdateLabel,
    events,
  };
}

function mapDraftRow(row: DraftRow): TicketDraft {
  return {
    id: row.id,
    code: row.code,
    conversationId: row.conversation_id,
    requesterId: row.requester_id,
    operation: row.operation,
    targetTicketNumber: row.target_ticket_number,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    affectedScope: row.affected_scope,
    slaDueLabel: row.sla_due_label,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class SqliteTicketService implements ITicketService {
  /**
   * Consulta ou altera o modo de simulação de instabilidade do sistema legado.
   * Modos suportados:
   * - '0' (estável)
   * - 'transient' (falha na 1ª tentativa e recupera no retry em ~250ms)
   * - '1' / 'down' (sistema legado indisponível no momento)
   */
  getLegacyInstabilityMode(): '0' | 'transient' | 'down' {
    const db = getDb();
    const row = db
      .prepare('SELECT value FROM system_settings WHERE key = ?')
      .get('simulate_legacy_instability') as { value: string } | undefined;
    const val = row?.value ?? '0';
    if (val === 'down' || val === '1') return 'down';
    if (val === 'transient') return 'transient';
    return '0';
  }

  setLegacyInstabilityMode(mode: '0' | 'transient' | 'down'): void {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(
      'simulate_legacy_instability',
      mode
    );
  }

  private async executeWithLegacyResilience<T>(fn: () => T): Promise<{
    result: T;
    retriedLegacyError: boolean;
  }> {
    const mode = this.getLegacyInstabilityMode();
    if (mode === 'down') {
      throw new LegacySystemUnavailableError(
        'O sistema legado de chamados não respondeu dentro do tempo limite (indisponibilidade temporária).'
      );
    }

    if (mode === 'transient') {
      // Simula falha de alguns milissegundos na 1ª tentativa e sucesso na 2ª tentativa (retry com backoff)
      await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        result: fn(),
        retriedLegacyError: true,
      };
    }

    return {
      result: fn(),
      retriedLegacyError: false,
    };
  }

  private getEventsForTicket(ticketNumber: string): TicketEvent[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM ticket_events WHERE ticket_number = ? ORDER BY created_at ASC')
      .all(ticketNumber) as unknown as TicketEventRow[];

    return rows.map((r) => ({
      id: r.id,
      ticketNumber: r.ticket_number,
      type: r.type,
      description: r.description,
      actor: r.actor,
      createdAt: r.created_at,
    }));
  }

  /**
   * Lista chamados estritamente filtrados pelo authenticatedEmployeeId (Anexo A — Privacidade).
   */
  async listTicketsForEmployee(
    authenticatedEmployeeId: string,
    options?: { onlyOpen?: boolean }
  ): Promise<{ tickets: Ticket[]; retriedLegacyError: boolean }> {
    const { result, retriedLegacyError } = await this.executeWithLegacyResilience(() => {
      const db = getDb();
      const rows = db
        .prepare('SELECT * FROM tickets WHERE requester_id = ? ORDER BY updated_at DESC')
        .all(authenticatedEmployeeId) as unknown as TicketRow[];

      const hydrated = rows.map((r) => hydrateTicket(r, this.getEventsForTicket(r.number)));
      if (options?.onlyOpen) {
        return hydrated.filter((t) => t.status !== 'Resolvido');
      }
      return hydrated;
    });

    return { tickets: result, retriedLegacyError };
  }

  /**
   * Busca um chamado por número garantindo que pertence ao funcionário autenticado.
   * Se o chamado existir mas pertencer a outro funcionário, lança PrivacyViolationError.
   */
  async getTicketForEmployee(
    ticketNumber: string,
    authenticatedEmployeeId: string
  ): Promise<{ ticket: Ticket | null; retriedLegacyError: boolean }> {
    const normalizedNumber = ticketNumber.trim().toUpperCase();

    const { result, retriedLegacyError } = await this.executeWithLegacyResilience(() => {
      const db = getDb();
      const row = db
        .prepare('SELECT * FROM tickets WHERE UPPER(number) = ?')
        .get(normalizedNumber) as unknown as TicketRow | undefined;

      if (!row) {
        return null;
      }

      if (row.requester_id !== authenticatedEmployeeId) {
        throw new PrivacyViolationError(
          `Anexo A (Privacidade): O chamado ${normalizedNumber} pertence a outro colaborador e não pode ser acessado.`
        );
      }

      return hydrateTicket(row, this.getEventsForTicket(row.number));
    });

    return { ticket: result, retriedLegacyError };
  }

  /**
   * Uso exclusivo do Console do Analista: lista todos os chamados de um funcionário selecionado no atendimento.
   */
  listTicketsForAnalystConsole(employeeId: string): Ticket[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM tickets WHERE requester_id = ? ORDER BY updated_at DESC')
      .all(employeeId) as unknown as TicketRow[];
    return rows.map((r) => hydrateTicket(r, this.getEventsForTicket(r.number)));
  }

  createPendingDraft(input: {
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
  }): TicketDraft {
    const validation = validateDraftRequirements({
      title: input.title,
      description: input.description,
      type: input.type,
      category: input.category,
      priority: input.priority,
      affectedScope: input.affectedScope,
    });

    if (!validation.valid) {
      throw new Error(
        `Rascunho incompleto. Campos ausentes: ${validation.missingFields.join(', ')}.`
      );
    }

    const db = getDb();
    // Cancela rascunhos pendentes anteriores na mesma conversa
    db.prepare(
      `UPDATE drafts SET status = 'CANCELLED' WHERE conversation_id = ? AND status = 'PENDING_CONFIRMATION'`
    ).run(input.conversationId);

    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM drafts').get() as { cnt: number };
    const codeNumber = 381 + (countRow?.cnt ?? 0);
    const code = `D-${codeNumber}`;
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO drafts (
        id, code, conversation_id, requester_id, operation, target_ticket_number,
        type, title, description, category, priority, affected_scope, sla_due_label, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CONFIRMATION', ?)`
    ).run(
      id,
      code,
      input.conversationId,
      input.requesterId,
      input.operation,
      input.targetTicketNumber ?? null,
      input.type,
      input.title.trim(),
      input.description.trim(),
      input.category,
      input.priority,
      input.affectedScope,
      input.slaDueLabel,
      nowIso
    );

    return this.getDraftByIdOrCode(id)!;
  }

  getDraftByIdOrCode(idOrCode: string): TicketDraft | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM drafts WHERE id = ? OR UPPER(code) = UPPER(?)')
      .get(idOrCode, idOrCode) as unknown as DraftRow | undefined;

    return row ? mapDraftRow(row) : null;
  }

  getPendingDraftForConversation(conversationId: string): TicketDraft | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT * FROM drafts WHERE conversation_id = ? AND status = 'PENDING_CONFIRMATION' ORDER BY created_at DESC LIMIT 1`
      )
      .get(conversationId) as unknown as DraftRow | undefined;

    return row ? mapDraftRow(row) : null;
  }

  updateDraft(
    draftIdOrCode: string,
    authenticatedEmployeeId: string,
    updates: Partial<{
      type: TicketType;
      title: string;
      description: string;
      category: TicketCategory;
      priority: TicketPriority;
      affectedScope: AffectedScope;
    }>
  ): TicketDraft {
    const existing = this.getDraftByIdOrCode(draftIdOrCode);
    if (!existing) {
      throw new Error('Rascunho não encontrado.');
    }
    if (existing.requesterId !== authenticatedEmployeeId) {
      throw new PrivacyViolationError('Você não tem permissão para alterar este rascunho.');
    }
    if (existing.status !== 'PENDING_CONFIRMATION') {
      throw new Error('Este rascunho já foi processado.');
    }

    const nextType = updates.type ?? existing.type;
    const nextTitle = updates.title?.trim() ?? existing.title;
    const nextDesc = updates.description?.trim() ?? existing.description;
    const nextCategory = updates.category ?? existing.category;
    const nextScope = updates.affectedScope ?? existing.affectedScope;

    const slaEval = evaluatePriorityAndSla({
      type: nextType,
      affectedScope: nextScope,
      hasSameDayDeadline: (updates.priority ?? existing.priority) === 'Alta',
    });

    const nextPriority = updates.priority ?? slaEval.priority;
    const nextSlaLabel = slaEval.slaDueLabel;

    const db = getDb();
    db.prepare(
      `UPDATE drafts
       SET type = ?, title = ?, description = ?, category = ?, priority = ?, affected_scope = ?, sla_due_label = ?
       WHERE id = ?`
    ).run(
      nextType,
      nextTitle,
      nextDesc,
      nextCategory,
      nextPriority,
      nextScope,
      nextSlaLabel,
      existing.id
    );

    // Sincroniza também o card salvo na mensagem da conversa
    this.syncDraftInMessages(existing.conversationId, this.getDraftByIdOrCode(existing.id)!);

    return this.getDraftByIdOrCode(existing.id)!;
  }

  cancelDraft(draftIdOrCode: string, authenticatedEmployeeId: string): TicketDraft {
    const existing = this.getDraftByIdOrCode(draftIdOrCode);
    if (!existing) {
      throw new Error('Rascunho não encontrado.');
    }
    if (existing.requesterId !== authenticatedEmployeeId) {
      throw new PrivacyViolationError('Você não tem permissão para cancelar este rascunho.');
    }

    const db = getDb();
    db.prepare(`UPDATE drafts SET status = 'CANCELLED' WHERE id = ?`).run(existing.id);

    const updated = this.getDraftByIdOrCode(existing.id)!;
    this.syncDraftInMessages(existing.conversationId, updated);
    return updated;
  }

  /**
   * Efetiva a gravação do chamado (CREATE, UPDATE ou REOPEN) SOMENTE após confirmação explícita do funcionário.
   */
  async confirmDraft(
    draftIdOrCode: string,
    authenticatedEmployeeId: string
  ): Promise<{ ticket: Ticket; draft: TicketDraft; retriedLegacyError: boolean }> {
    const existing = this.getDraftByIdOrCode(draftIdOrCode);
    if (!existing) {
      throw new Error('Rascunho não encontrado.');
    }
    if (existing.requesterId !== authenticatedEmployeeId) {
      throw new PrivacyViolationError('Você não tem permissão para confirmar este rascunho.');
    }
    if (existing.status !== 'PENDING_CONFIRMATION') {
      throw new Error(`O rascunho ${existing.code} já está com status ${existing.status}.`);
    }

    const { result: ticket, retriedLegacyError } = await this.executeWithLegacyResilience(() => {
      const db = getDb();
      const now = new Date();
      const nowIso = now.toISOString();

      const empRow = db
        .prepare('SELECT name, email FROM employees WHERE id = ?')
        .get(authenticatedEmployeeId) as { name: string; email: string } | undefined;

      const requesterName = empRow?.name ?? 'Colaborador Nexo';
      const requesterEmail = empRow?.email ?? 'colaborador@nexo.com.br';

      const slaEval = evaluatePriorityAndSla(
        {
          type: existing.type,
          affectedScope: existing.affectedScope,
          hasSameDayDeadline: existing.priority === 'Alta',
        },
        now
      );

      let targetTicketNumber = existing.targetTicketNumber;

      if (
        (existing.operation === 'UPDATE' || existing.operation === 'REOPEN') &&
        targetTicketNumber
      ) {
        const ticketRow = db
          .prepare('SELECT * FROM tickets WHERE UPPER(number) = UPPER(?) AND requester_id = ?')
          .get(targetTicketNumber, authenticatedEmployeeId) as unknown as TicketRow | undefined;

        if (!ticketRow) {
          throw new Error(`Chamado ${targetTicketNumber} não encontrado para atualização.`);
        }

        const updatedDescription = `${ticketRow.description}\n\n[Complemento em ${now.toLocaleDateString('pt-BR')}]: ${existing.description}`;
        const nextStatus: TicketStatus =
          existing.operation === 'REOPEN' ? 'Aguardando analista' : ticketRow.status;

        db.prepare(
          `UPDATE tickets
           SET description = ?, priority = ?, affected_scope = ?, status = ?, resolved_at = NULL, updated_at = ?, sla_due_at = ?
           WHERE number = ?`
        ).run(
          updatedDescription,
          existing.priority,
          existing.affectedScope,
          nextStatus,
          nowIso,
          slaEval.slaDueAt,
          ticketRow.number
        );

        const evtId = `evt-${Date.now()}`;
        const evtType: TicketEvent['type'] =
          existing.operation === 'REOPEN' ? 'reopened' : 'updated';
        const evtDesc =
          existing.operation === 'REOPEN'
            ? `Chamado reaberto dentro do prazo de 7 dias: ${existing.description}`
            : `Complemento confirmado pelo colaborador: ${existing.description}`;

        db.prepare(
          `INSERT INTO ticket_events (id, ticket_number, type, description, actor, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(evtId, ticketRow.number, evtType, evtDesc, requesterName, nowIso);

        targetTicketNumber = ticketRow.number;
      } else {
        // Criação de novo chamado
        const countRow = db.prepare('SELECT COUNT(*) as cnt FROM tickets').get() as {
          cnt: number;
        };
        const seq = 20517 + (countRow?.cnt ?? 0);
        const number = `${existing.type}-${seq}`;
        const id = `tkt-${number.toLowerCase()}-${Date.now()}`;

        db.prepare(
          `INSERT INTO tickets (
            id, number, type, title, description, category, subcategory, priority, status,
            affected_scope, requester_id, requester_name, requester_email,
            assigned_analyst_id, assigned_analyst_name, created_at, updated_at, resolved_at, sla_due_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'Aguardando analista', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?)`
        ).run(
          id,
          number,
          existing.type,
          existing.title,
          existing.description,
          existing.category,
          existing.priority,
          existing.affectedScope,
          authenticatedEmployeeId,
          requesterName,
          requesterEmail,
          nowIso,
          nowIso,
          slaEval.slaDueAt
        );

        db.prepare(
          `INSERT INTO ticket_events (id, ticket_number, type, description, actor, created_at)
           VALUES (?, ?, 'created', ?, ?, ?)`
        ).run(
          `evt-${Date.now()}`,
          number,
          `Chamado criado após confirmação do rascunho ${existing.code}`,
          requesterName,
          nowIso
        );

        targetTicketNumber = number;
      }

      db.prepare(`UPDATE drafts SET status = 'CONFIRMED' WHERE id = ?`).run(existing.id);

      const finalRow = db
        .prepare('SELECT * FROM tickets WHERE number = ?')
        .get(targetTicketNumber!) as unknown as TicketRow;

      return hydrateTicket(finalRow, this.getEventsForTicket(finalRow.number));
    });

    const confirmedDraft = this.getDraftByIdOrCode(existing.id)!;
    this.syncDraftInMessages(existing.conversationId, confirmedDraft);

    return {
      ticket,
      draft: confirmedDraft,
      retriedLegacyError,
    };
  }

  /**
   * Adiciona informação direta a um chamado já existente e atualiza seu evento no histórico.
   */
  recordTicketTransferEvent(ticketNumber: string, targetTier: string, actor: string): void {
    const db = getDb();
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO ticket_events (id, ticket_number, type, description, actor, created_at)
       VALUES (?, ?, 'transferred', ?, ?, ?)`
    ).run(
      `evt-tr-${Date.now()}`,
      ticketNumber,
      `Transferido para ${targetTier}`,
      actor,
      nowIso
    );
  }

  recordTicketTakeoverEvent(ticketNumber: string, analystId: string, analystName: string): void {
    const db = getDb();
    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE tickets SET status = 'Em atendimento', assigned_analyst_id = ?, assigned_analyst_name = ?, updated_at = ?
       WHERE number = ?`
    ).run(analystId, analystName, nowIso, ticketNumber);

    db.prepare(
      `INSERT INTO ticket_events (id, ticket_number, type, description, actor, created_at)
       VALUES (?, ?, 'taken_over', ?, ?, ?)`
    ).run(
      `evt-tk-${Date.now()}`,
      ticketNumber,
      `Assumido por ${analystName}`,
      analystName,
      nowIso
    );
  }

  private syncDraftInMessages(conversationId: string, updatedDraft: TicketDraft): void {
    const db = getDb();
    const rows = db
      .prepare('SELECT id, draft_card_json FROM messages WHERE conversation_id = ? AND draft_card_json IS NOT NULL')
      .all(conversationId) as Array<{ id: string; draft_card_json: string }>;

    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.draft_card_json) as TicketDraft;
        if (parsed.id === updatedDraft.id || parsed.code === updatedDraft.code) {
          db.prepare('UPDATE messages SET draft_card_json = ? WHERE id = ?').run(
            JSON.stringify(updatedDraft),
            r.id
          );
        }
      } catch {
        // ignore invalid json
      }
    }
  }
}

export const ticketService = new SqliteTicketService();
