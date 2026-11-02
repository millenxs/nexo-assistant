import {
  Analyst,
  Conversation,
  ConversationStatus,
  Employee,
  HandoffSummary,
  Message,
} from '@/domain/types';
import { transitionConversationStatus } from '@/domain/rules/conversation-state';
import { getDb } from './db';
import { ticketService } from './ticket-service';

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  initials: string;
  department: string;
  role: string;
  os: Employee['os'];
  avatar_bg: string;
  avatar_fg: string;
  password_changed_days_ago: number;
  online: number;
}

interface AnalystRow {
  id: string;
  name: string;
  email: string;
  initials: string;
  tier: Analyst['tier'];
  online: number;
}

interface ConversationRow {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  employee_initials: string;
  employee_department: string;
  employee_avatar_bg: string;
  employee_avatar_fg: string;
  employee_online: number;
  status: ConversationStatus;
  assigned_analyst_id: string | null;
  assigned_analyst_name: string | null;
  active_ticket_number: string | null;
  unread_for_analyst: number;
  message_count: number;
  max_messages: number;
  list_tag_label: string;
  list_tag_tone: Conversation['listTagTone'];
  handoff_summary_json: string | null;
  pending_context_json: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: Message['senderType'];
  sender_name: string;
  sender_role: string | null;
  content: string;
  question_prompt: string | null;
  quick_options_json: string | null;
  ticket_selector_json: string | null;
  ticket_card_json: string | null;
  draft_card_json: string | null;
  decision_trace_json: string | null;
  system_icon: Message['systemIcon'] | null;
  created_at: string;
}

function mapEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    initials: row.initials,
    department: row.department,
    role: row.role,
    os: row.os,
    avatarBg: row.avatar_bg,
    avatarFg: row.avatar_fg,
    passwordChangedDaysAgo: row.password_changed_days_ago,
    online: Boolean(row.online),
  };
}

function mapAnalyst(row: AnalystRow): Analyst {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    initials: row.initials,
    tier: row.tier,
    online: Boolean(row.online),
  };
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    employeeInitials: row.employee_initials,
    employeeDepartment: row.employee_department,
    employeeAvatarBg: row.employee_avatar_bg,
    employeeAvatarFg: row.employee_avatar_fg,
    employeeOnline: Boolean(row.employee_online),
    status: row.status,
    assignedAnalystId: row.assigned_analyst_id,
    assignedAnalystName: row.assigned_analyst_name,
    activeTicketNumber: row.active_ticket_number,
    unreadForAnalyst: row.unread_for_analyst,
    messageCount: row.message_count,
    maxMessages: row.max_messages,
    listTagLabel: row.list_tag_label,
    listTagTone: row.list_tag_tone,
    handoffSummary: row.handoff_summary_json
      ? (JSON.parse(row.handoff_summary_json) as HandoffSummary)
      : null,
    pendingContext: row.pending_context_json
      ? (JSON.parse(row.pending_context_json) as Conversation['pendingContext'])
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    senderName: row.sender_name,
    senderRole: row.sender_role ?? undefined,
    content: row.content,
    questionPrompt: row.question_prompt ?? undefined,
    quickOptions: row.quick_options_json ? JSON.parse(row.quick_options_json) : undefined,
    ticketSelector: row.ticket_selector_json ? JSON.parse(row.ticket_selector_json) : undefined,
    ticketCard: row.ticket_card_json ? JSON.parse(row.ticket_card_json) : undefined,
    draftCard: row.draft_card_json ? JSON.parse(row.draft_card_json) : undefined,
    decisionTrace: row.decision_trace_json ? JSON.parse(row.decision_trace_json) : undefined,
    systemIcon: row.system_icon ?? undefined,
    createdAt: row.created_at,
  };
}

export class ConversationService {
  listEmployees(): Employee[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM employees ORDER BY name ASC').all() as unknown as EmployeeRow[];
    return rows.map(mapEmployee);
  }

  getEmployeeByEmail(email: string): Employee | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM employees WHERE LOWER(email) = LOWER(?)')
      .get(email.trim()) as unknown as EmployeeRow | undefined;
    return row ? mapEmployee(row) : null;
  }

  getEmployeeById(id: string): Employee | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM employees WHERE id = ?')
      .get(id) as unknown as EmployeeRow | undefined;
    return row ? mapEmployee(row) : null;
  }

  listAnalysts(): Analyst[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM analysts ORDER BY name ASC').all() as unknown as AnalystRow[];
    return rows.map(mapAnalyst);
  }

  getAnalystByEmailOrId(emailOrId: string): Analyst | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM analysts WHERE id = ? OR LOWER(email) = LOWER(?)')
      .get(emailOrId.trim(), emailOrId.trim()) as unknown as AnalystRow | undefined;
    return row ? mapAnalyst(row) : null;
  }

  getOrCreateEmployeeConversation(employeeId: string): {
    conversation: Conversation;
    messages: Message[];
  } {
    const db = getDb();
    const existingRow = db
      .prepare('SELECT * FROM conversations WHERE employee_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(employeeId) as unknown as ConversationRow | undefined;

    if (existingRow) {
      const conv = mapConversation(existingRow);
      return {
        conversation: conv,
        messages: this.getMessages(conv.id),
      };
    }

    return this.startFreshConversation(employeeId);
  }

  startFreshConversation(employeeId: string, preset?: 'empty' | 'vpn-draft' | 'ticket-overdue'): {
    conversation: Conversation;
    messages: Message[];
  } {
    const emp = this.getEmployeeById(employeeId);
    if (!emp) {
      throw new Error('Funcionário não encontrado.');
    }

    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const convId = `conv-${emp.id.replace('emp-', '')}`;

    // Remove conversa anterior desse colaborador para reiniciar a sessão limpa
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
    db.prepare('DELETE FROM drafts WHERE conversation_id = ?').run(convId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);

    db.prepare(
      `INSERT INTO conversations (
        id, employee_id, employee_name, employee_email, employee_initials, employee_department,
        employee_avatar_bg, employee_avatar_fg, employee_online, status,
        assigned_analyst_id, assigned_analyst_name, active_ticket_number,
        unread_for_analyst, message_count, max_messages, list_tag_label, list_tag_tone,
        handoff_summary_json, pending_context_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE_WITH_AGENT', NULL, NULL, NULL, 0, 0, 30, 'Agent atendendo', 'success', NULL, NULL, ?, ?)`
    ).run(
      convId,
      emp.id,
      emp.name,
      emp.email,
      emp.initials,
      emp.department,
      emp.avatarBg,
      emp.avatarFg,
      nowIso,
      nowIso
    );

    if (preset === 'vpn-draft') {
      // Pré-carrega exatamente a Tela 2 do nexo.pen ("Chat — Novo chamado")
      this.appendMessage({
        conversationId: convId,
        senderType: 'employee',
        senderName: emp.name,
        content: 'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.',
      });

      this.appendMessage({
        conversationId: convId,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content:
          'Não há chamado aberto sobre VPN, e o artigo do erro 809 vale só para Windows 10 — o seu é Windows 11. Vou abrir um chamado.',
        questionPrompt: 'Quem está sendo afetado?',
        quickOptions: [
          { key: '1', label: 'Só eu', value: 'Só eu', variant: 'primary' },
          { key: '2', label: 'Minha equipe', value: 'Minha equipe' },
          { key: '3', label: 'Toda a empresa', value: 'Toda a empresa' },
          { key: '4', label: 'Não sei', value: 'Não sei' },
        ],
        decisionTrace: {
          id: `dec-vpn-1-${Date.now()}`,
          steps: ['consultou seus chamados', 'buscou na central de ajuda'],
          intent: 'OPEN_TICKET_TRIAGE',
          scope: 'TI',
          actionTaken:
            'Verificou ausência de chamado duplicado de VPN, checou restrição de Windows 11 no artigo do erro 809 e perguntou impacto',
          confidence: 95,
          confidenceLevel: 'Alta',
          classification: {
            type: 'INC',
            category: 'Rede e VPN',
          },
          rulesApplied: [
            'Anexo A (Sem duplicidade): Nenhum chamado aberto de VPN encontrado para Ana Souza.',
            'Anexo B (Central de Ajuda - kb-vpn-809): Artigo resolve apenas para Windows 10; no Windows 11 exige abertura de chamado.',
            'Anexo A (Abertura): Perguntando quem é afetado antes de classificar prioridade e montar rascunho.',
          ],
          reasoning:
            'O artigo de erro 809 da VPN aplica-se somente ao Windows 10, mas o cadastro de Ana Souza indica Windows 11. Antes de criar o rascunho do incidente, o agente precisa coletar o escopo de impacto ("Quem está sendo afetado?").',
          toolCalls: [
            {
              toolId: 'list-my-tickets',
              label: 'consultou seus chamados',
              input: { requesterId: emp.id, category: 'Rede e VPN' },
              outputSummary: '0 chamados abertos sobre Rede e VPN',
              durationMs: 12,
            },
            {
              toolId: 'search-help-center',
              label: 'buscou na central de ajuda',
              input: { query: 'VPN erro 809', employeeOs: emp.os },
              outputSummary: 'Artigo kb-vpn-809 encontrado (restrito a Windows 10; requer chamado no Windows 11)',
              durationMs: 15,
            },
          ],
          engine: 'mastra-deterministic-hybrid',
        },
      });

      this.appendMessage({
        conversationId: convId,
        senderType: 'employee',
        senderName: emp.name,
        content: 'Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.',
      });

      const draft = ticketService.createPendingDraft({
        conversationId: convId,
        requesterId: emp.id,
        operation: 'CREATE',
        type: 'INC',
        title: 'VPN não conecta no notebook — erro 809',
        description:
          'Desde 20/10 o notebook (Windows 11) não conecta na VPN e mostra o erro 809. Precisa dela para a reunião das 14h.',
        category: 'Rede e VPN',
        priority: 'Alta',
        affectedScope: 'Somente você',
        slaDueLabel: '· resposta até 13:43',
      });

      this.appendMessage({
        conversationId: convId,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content:
          'Coloquei prioridade alta por causa da reunião — a resposta chega antes das 14h. Confira antes de eu criar:',
        draftCard: draft,
        decisionTrace: {
          id: `dec-vpn-2-${Date.now()}`,
          steps: ['classificou a prioridade', 'consultou o SLA', 'montou o rascunho'],
          intent: 'OPEN_TICKET_DRAFT',
          scope: 'TI',
          actionTaken:
            'Classificou como Incidente (INC) de Prioridade Alta (SLA 4h úteis) e exibiu rascunho D-381 para confirmação',
          confidence: 97,
          confidenceLevel: 'Alta',
          classification: {
            type: 'INC',
            category: 'Rede e VPN',
            priority: 'Alta',
            affectedScope: 'Somente você',
            slaLabel: '4 horas úteis (resposta até 13:43)',
          },
          rulesApplied: [
            'Anexo A (Prioridade Alta): Afeta 1 pessoa com compromisso/reunião em risco no mesmo dia → Prioridade Alta.',
            'Anexo A (SLA): Prioridade Alta = 4 horas úteis.',
            'Anexo A (Abertura com confirmação): Rascunho D-381 montado; aguardando confirmação explícita antes de gravar no banco.',
          ],
          reasoning:
            'Embora afete apenas uma pessoa ("Somente você"), há uma reunião com cliente às 14h no mesmo dia. Pela matriz de Impacto × Urgência do Anexo A, compromisso em risco no mesmo dia eleva a prioridade para Alta (4 horas úteis).',
          toolCalls: [
            {
              toolId: 'evaluate-priority-and-sla',
              label: 'classificou a prioridade',
              input: { type: 'INC', affectedScope: 'Somente você', hasSameDayDeadline: true },
              outputSummary: 'Prioridade Alta · SLA 4 horas úteis (resposta até 13:43)',
              durationMs: 8,
            },
            {
              toolId: 'prepare-ticket-draft',
              label: 'montou o rascunho',
              input: {
                type: 'INC',
                category: 'Rede e VPN',
                priority: 'Alta',
                affectedScope: 'Somente você',
              },
              outputSummary: `Rascunho ${draft.code} criado com status PENDING_CONFIRMATION`,
              durationMs: 19,
            },
          ],
          engine: 'mastra-deterministic-hybrid',
        },
      });

      // The supplied Tela 2 reference shows this preloaded session at 18/30.
      db.prepare('UPDATE conversations SET message_count = 18 WHERE id = ?').run(convId);
    }

    const conv = this.getConversationById(convId)!;
    return {
      conversation: conv,
      messages: this.getMessages(convId),
    };
  }

  getConversationById(conversationId: string): Conversation | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(conversationId) as unknown as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }

  getMessages(conversationId: string): Message[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(conversationId) as unknown as MessageRow[];
    return rows.map(mapMessage);
  }

  appendMessage(input: {
    conversationId: string;
    senderType: Message['senderType'];
    senderName: string;
    senderRole?: string;
    content: string;
    questionPrompt?: string;
    quickOptions?: Message['quickOptions'];
    ticketSelector?: Message['ticketSelector'];
    ticketCard?: Message['ticketCard'];
    draftCard?: Message['draftCard'];
    decisionTrace?: Message['decisionTrace'];
    systemIcon?: Message['systemIcon'];
  }): Message {
    const db = getDb();
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO messages (
        id, conversation_id, sender_type, sender_name, sender_role, content,
        question_prompt, quick_options_json, ticket_selector_json, ticket_card_json,
        draft_card_json, decision_trace_json, system_icon, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.conversationId,
      input.senderType,
      input.senderName,
      input.senderRole ?? null,
      input.content,
      input.questionPrompt ?? null,
      input.quickOptions ? JSON.stringify(input.quickOptions) : null,
      input.ticketSelector ? JSON.stringify(input.ticketSelector) : null,
      input.ticketCard ? JSON.stringify(input.ticketCard) : null,
      input.draftCard ? JSON.stringify(input.draftCard) : null,
      input.decisionTrace ? JSON.stringify(input.decisionTrace) : null,
      input.systemIcon ?? null,
      nowIso
    );

    if (input.senderType !== 'system') {
      db.prepare(
        `UPDATE conversations
         SET message_count = message_count + 1, updated_at = ?
         WHERE id = ?`
      ).run(nowIso, input.conversationId);
    } else {
      db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
        nowIso,
        input.conversationId
      );
    }

    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow;
    return mapMessage(row);
  }

  updatePendingContext(
    conversationId: string,
    pendingContext: Conversation['pendingContext'],
    activeTicketNumber?: string | null
  ): void {
    const db = getDb();
    const nowIso = new Date().toISOString();
    if (activeTicketNumber !== undefined) {
      db.prepare(
        `UPDATE conversations SET pending_context_json = ?, active_ticket_number = ?, updated_at = ? WHERE id = ?`
      ).run(
        pendingContext ? JSON.stringify(pendingContext) : null,
        activeTicketNumber,
        nowIso,
        conversationId
      );
    } else {
      db.prepare(
        `UPDATE conversations SET pending_context_json = ?, updated_at = ? WHERE id = ?`
      ).run(pendingContext ? JSON.stringify(pendingContext) : null, nowIso, conversationId);
    }
  }

  /**
   * Transfere a conversa para o analista (pausando o agent) e salva o resumo do caso.
   */
  transferToAnalyst(input: {
    conversationId: string;
    handoffSummary: HandoffSummary;
    listTagLabel?: string;
    listTagTone?: Conversation['listTagTone'];
  }): Conversation {
    const conv = this.getConversationById(input.conversationId);
    if (!conv) throw new Error('Conversa não encontrada.');

    const { nextStatus } =
      conv.status === 'WAITING_ANALYST'
        ? { nextStatus: 'WAITING_ANALYST' as const }
        : transitionConversationStatus(conv.status, 'TRANSFER_TO_ANALYST');

    const db = getDb();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    const tagLabel =
      input.listTagLabel ??
      (input.handoffSummary.relatedTicketNumber
        ? `Transferida · ${input.handoffSummary.relatedTicketNumber}`
        : input.handoffSummary.reasonLabel);

    const tagTone =
      input.listTagTone ??
      (input.handoffSummary.reason === 'LOW_CONFIDENCE' ? 'warning' : 'danger');

    db.prepare(
      `UPDATE conversations
       SET status = ?, handoff_summary_json = ?, active_ticket_number = COALESCE(?, active_ticket_number),
           unread_for_analyst = unread_for_analyst + 1, list_tag_label = ?, list_tag_tone = ?,
           pending_context_json = NULL, updated_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      JSON.stringify(input.handoffSummary),
      input.handoffSummary.relatedTicketNumber ?? null,
      tagLabel,
      tagTone,
      now.toISOString(),
      input.conversationId
    );

    if (input.handoffSummary.relatedTicketNumber) {
      ticketService.recordTicketTransferEvent(
        input.handoffSummary.relatedTicketNumber,
        input.handoffSummary.targetTier,
        'Nexo Assist'
      );
    }

    this.appendMessage({
      conversationId: input.conversationId,
      senderType: 'system',
      senderName: 'Sistema',
      content: `Transferida para ${input.handoffSummary.targetTier} · ${hh}:${mm}`,
      systemIcon: 'transfer',
    });

    return this.getConversationById(input.conversationId)!;
  }

  /**
   * Analista assume a conversa no Console (agent permanece pausado).
   */
  analystTakeover(conversationId: string, analystId: string): Conversation {
    const conv = this.getConversationById(conversationId);
    if (!conv) throw new Error('Conversa não encontrada.');

    const analyst = this.getAnalystByEmailOrId(analystId) ?? {
      id: 'ana-rafael',
      name: 'Rafael Lima',
      email: 'rafael.lima@nexo.com.br',
      initials: 'RL',
      tier: 'Suporte N2' as const,
      online: true,
    };

    const { nextStatus } =
      conv.status === 'WITH_ANALYST'
        ? { nextStatus: 'WITH_ANALYST' as const }
        : transitionConversationStatus(conv.status, 'ANALYST_TAKEOVER');

    const db = getDb();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    db.prepare(
      `UPDATE conversations
       SET status = ?, assigned_analyst_id = ?, assigned_analyst_name = ?,
           unread_for_analyst = 0, list_tag_label = 'Você está atendendo', list_tag_tone = 'primary',
           updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, analyst.id, analyst.name, now.toISOString(), conversationId);

    if (conv.activeTicketNumber) {
      ticketService.recordTicketTakeoverEvent(
        conv.activeTicketNumber,
        analyst.id,
        analyst.name
      );
    }

    this.appendMessage({
      conversationId,
      senderType: 'system',
      senderName: 'Sistema',
      content: `${analyst.name} assumiu · agent pausado · ${hh}:${mm}`,
      systemIcon: 'takeover',
    });

    return this.getConversationById(conversationId)!;
  }

  /**
   * Analista envia mensagem na conversa assumida.
   */
  sendAnalystMessage(conversationId: string, analystId: string, content: string): Message {
    const conv = this.getConversationById(conversationId);
    if (!conv) throw new Error('Conversa não encontrada.');
    if (conv.status !== 'WITH_ANALYST') {
      throw new Error('Assuma o atendimento antes de enviar mensagens como analista.');
    }

    const analyst = this.getAnalystByEmailOrId(analystId) ?? {
      id: 'ana-rafael',
      name: 'Rafael Lima',
      tier: 'Suporte N2' as const,
    };

    return this.appendMessage({
      conversationId,
      senderType: 'analyst',
      senderName: analyst.name,
      senderRole: analyst.tier,
      content: content.trim(),
    });
  }

  /**
   * Analista devolve a conversa ao agent (agent volta a responder).
   */
  returnConversationToAgent(conversationId: string, analystName = 'Rafael Lima'): Conversation {
    const conv = this.getConversationById(conversationId);
    if (!conv) throw new Error('Conversa não encontrada.');

    const { nextStatus } = transitionConversationStatus(conv.status, 'RETURN_TO_AGENT');
    const db = getDb();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    db.prepare(
      `UPDATE conversations
       SET status = ?, assigned_analyst_id = NULL, assigned_analyst_name = NULL,
           unread_for_analyst = 0, list_tag_label = 'Agent atendendo', list_tag_tone = 'success',
           updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, now.toISOString(), conversationId);

    this.appendMessage({
      conversationId,
      senderType: 'system',
      senderName: 'Sistema',
      content: `${analystName} devolveu a conversa ao Nexo Assist · ${hh}:${mm}`,
      systemIcon: 'return',
    });

    return this.getConversationById(conversationId)!;
  }

  /**
   * Analista encerra o atendimento.
   */
  closeConversation(conversationId: string, analystName = 'Rafael Lima'): Conversation {
    const conv = this.getConversationById(conversationId);
    if (!conv) throw new Error('Conversa não encontrada.');

    const { nextStatus } =
      conv.status === 'CLOSED'
        ? { nextStatus: 'CLOSED' as const }
        : transitionConversationStatus(conv.status, 'CLOSE_CONVERSATION');

    const db = getDb();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    db.prepare(
      `UPDATE conversations
       SET status = ?, unread_for_analyst = 0, list_tag_label = 'Encerrada pelo analista', list_tag_tone = 'neutral',
           updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, now.toISOString(), conversationId);

    this.appendMessage({
      conversationId,
      senderType: 'system',
      senderName: 'Sistema',
      content: `Atendimento encerrado por ${analystName} · ${hh}:${mm}`,
      systemIcon: 'close',
    });

    return this.getConversationById(conversationId)!;
  }

  /**
   * Lista todas as conversas para o Console do Analista com a última mensagem e contadores por filtro.
   */
  listConversationsForConsole(analystId = 'ana-rafael'): {
    conversations: Array<
      Conversation & {
        lastMessagePreview: string;
        lastMessageSenderType: Message['senderType'];
        lastMessageTimeLabel: string;
      }
    >;
    counts: {
      all: number;
      forYou: number;
      withAgent: number;
      mine: number;
    };
  } {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all() as unknown as ConversationRow[];

    const items = rows.map((r) => {
      const conv = mapConversation(r);
      const lastMsg = db
        .prepare(
          `SELECT content, sender_type, sender_name, created_at
           FROM messages
           WHERE conversation_id = ? AND sender_type != 'system'
           ORDER BY created_at DESC, rowid DESC LIMIT 1`
        )
        .get(conv.id) as
        | { content: string; sender_type: Message['senderType']; sender_name: string; created_at: string }
        | undefined;

      let lastMessagePreview = lastMsg?.content ?? 'Sem mensagens';
      if (lastMsg?.sender_type === 'agent') {
        lastMessagePreview = `Nexo: ${lastMsg.content}`;
      } else if (lastMsg?.sender_type === 'analyst') {
        lastMessagePreview = `Você: ${lastMsg.content}`;
      }
      if (lastMessagePreview.length > 44) {
        lastMessagePreview = lastMessagePreview.slice(0, 42).trim() + '…';
      }

      const d = new Date(lastMsg?.created_at ?? conv.updatedAt);
      const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
      let lastMessageTimeLabel: string;
      if (diffHours > 18) {
        lastMessageTimeLabel = 'ontem';
      } else if (diffHours < 0.04) {
        lastMessageTimeLabel = 'agora';
      } else {
        lastMessageTimeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }

      return {
        ...conv,
        lastMessagePreview,
        lastMessageSenderType: lastMsg?.sender_type ?? 'employee',
        lastMessageTimeLabel,
      };
    });

    const counts = {
      all: items.length,
      forYou: items.filter((c) => c.status === 'WAITING_ANALYST').length,
      withAgent: items.filter((c) => c.status === 'ACTIVE_WITH_AGENT').length,
      mine: items.filter(
        (c) => c.status === 'WITH_ANALYST' && (!c.assignedAnalystId || c.assignedAnalystId === analystId)
      ).length,
    };

    return { conversations: items, counts };
  }
}

export const conversationService = new ConversationService();
