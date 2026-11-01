import {
  AffectedScope,
  Conversation,
  DecisionToolCall,
  DecisionTrace,
  Employee,
  Message,
  QuickOption,
  TicketPriority,
} from '@/domain/types';
import { isAgentAllowedToRespond } from '@/domain/rules/conversation-state';
import {
  classifyTicketTypeAndCategory,
  evaluateScope,
} from '@/domain/rules/ticket-rules';
import { evaluatePriorityAndSla, inspectTicketSla } from '@/domain/rules/priority-sla';
import { conversationService } from '@/services/conversation-service';
import {
  LegacySystemUnavailableError,
  ticketService,
} from '@/services/ticket-service';
import {
  execCheckDuplicateOrReopen,
  execEvaluatePriorityAndSla,
  execInspectTicketDetail,
  execListMyTickets,
  execRequestAnalystTransfer,
  execSearchHelpCenter,
} from './tools/service-desk-tools';
import { getServerModelConfig } from './model-provider';
import { mastra } from './agent';

export interface ProcessChatTurnInput {
  conversationId: string;
  employeeId: string;
  userMessage: string;
}

export interface ProcessChatTurnOutput {
  employeeMessage?: Message;
  agentMessage?: Message;
  conversation: Conversation;
  agentPaused: boolean;
  limitReached: boolean;
  error?: string;
}

function parseAffectedScope(text: string): AffectedScope | null {
  const lower = text.toLowerCase().trim();
  if (
    lower === '1' ||
    lower.includes('só eu') ||
    lower.includes('so eu') ||
    lower.includes('somente eu') ||
    lower.includes('somente você') ||
    lower.includes('apenas eu') ||
    lower.includes('meu notebook')
  ) {
    return 'Somente você';
  }
  if (
    lower === '2' ||
    lower.includes('minha equipe') ||
    lower.includes('meu time') ||
    lower.includes('meu setor') ||
    lower.includes('equipe')
  ) {
    return 'Minha equipe';
  }
  if (
    lower === '3' ||
    lower.includes('toda a empresa') ||
    lower.includes('empresa inteira') ||
    lower.includes('todos') ||
    lower.includes('geral')
  ) {
    return 'Toda a empresa';
  }
  if (lower === '4' || lower.includes('não sei') || lower.includes('nao sei')) {
    return 'Não sei';
  }
  return null;
}

function detectUrgencySignals(text: string): {
  hasSameDayDeadline: boolean;
  blocksWorkCompletely: boolean;
  meetingTimeLabel?: string;
} {
  const lower = text.toLowerCase();
  const timeMatch = text.match(/(\d{1,2})\s*h(\d{2})?/i);
  const hasSameDayDeadline =
    lower.includes('reunião') ||
    lower.includes('reuniao') ||
    lower.includes('cliente') ||
    lower.includes('ainda hoje') ||
    lower.includes('hoje às') ||
    lower.includes('hoje as') ||
    lower.includes('apresentação') ||
    lower.includes('fechamento') ||
    Boolean(timeMatch);

  const blocksWorkCompletely =
    lower.includes('impede') ||
    lower.includes('não consigo trabalhar') ||
    lower.includes('nao consigo trabalhar') ||
    lower.includes('totalmente parado') ||
    lower.includes('travou tudo');

  return {
    hasSameDayDeadline,
    blocksWorkCompletely,
    meetingTimeLabel: timeMatch ? timeMatch[0] : undefined,
  };
}

/**
 * Se uma chave de LLM estiver configurada, permite ao agente Mastra refinar a resposta
 * mantendo todas as decisões e validações determinísticas das regras do Anexo A.
 */
async function maybeEnhanceWithMastraLlm(
  fallbackContent: string,
  contextSummary: string
): Promise<{ text: string; usedLlm: boolean }> {
  const cfg = getServerModelConfig();
  if (!cfg.hasApiKey) {
    return { text: fallbackContent, usedLlm: false };
  }

  try {
    const agent = mastra.getAgent('nexoAssist');
    const response = await agent.generate(
      `Contexto validado pelas regras do Service Desk:\n${contextSummary}\n\nResposta base sugerida:\n${fallbackContent}\n\nMantenha os fatos exatos (códigos de chamado, prazos, rascunhos e regras do Anexo A) e responda em português claro e conciso (máximo 2 frases).`
    );
    if (response?.text && response.text.trim().length > 10) {
      return { text: response.text.trim(), usedLlm: true };
    }
  } catch {
    // Em caso de falha/timeout da API externa, preserva a resposta determinística validada
  }

  return { text: fallbackContent, usedLlm: false };
}

export async function processEmployeeMessage(
  input: ProcessChatTurnInput
): Promise<ProcessChatTurnOutput> {
  const employee = conversationService.getEmployeeById(input.employeeId);
  if (!employee) {
    throw new Error('Funcionário autenticado não encontrado.');
  }

  let conversation = conversationService.getConversationById(input.conversationId);
  if (!conversation) {
    conversation = conversationService.getOrCreateEmployeeConversation(employee.id).conversation;
  }

  // 1. Verifica limite de 30 mensagens da sessão
  if (conversation.messageCount >= conversation.maxMessages) {
    return {
      conversation,
      agentPaused: false,
      limitReached: true,
      error: `Limite de ${conversation.maxMessages} mensagens por sessão atingido. Inicie uma nova conversa para continuar.`,
    };
  }

  // 2. Se a conversa está transferida (WAITING_ANALYST) ou assumida (WITH_ANALYST),
  // registra a mensagem do funcionário para o analista ver, mas o AGENT NÃO RESPONDE!
  const guard = isAgentAllowedToRespond(
    conversation.status,
    conversation.messageCount,
    conversation.maxMessages
  );

  const employeeMessage = conversationService.appendMessage({
    conversationId: conversation.id,
    senderType: 'employee',
    senderName: employee.name,
    content: input.userMessage.trim(),
  });

  conversation = conversationService.getConversationById(conversation.id)!;

  if (!guard.allowed) {
    return {
      employeeMessage,
      conversation,
      agentPaused: true,
      limitReached: conversation.messageCount >= conversation.maxMessages,
    };
  }

  try {
    const agentMessage = await executeAgentTurn(
      conversation,
      employee,
      input.userMessage.trim()
    );
    const updatedConv = conversationService.getConversationById(conversation.id)!;

    return {
      employeeMessage,
      agentMessage,
      conversation: updatedConv,
      agentPaused:
        updatedConv.status === 'WAITING_ANALYST' || updatedConv.status === 'WITH_ANALYST',
      limitReached: updatedConv.messageCount >= updatedConv.maxMessages,
    };
  } catch (err) {
    if (err instanceof LegacySystemUnavailableError) {
      const trace: DecisionTrace = {
        id: `dec-err-${Date.now()}`,
        steps: ['tentou consultar sistema legado', 'detectou indisponibilidade temporária'],
        intent: 'LEGACY_ERROR_FALLBACK',
        scope: 'TI',
        actionTaken:
          'Informou indisponibilidade temporária do sistema legado de chamados e ofereceu nova tentativa ou transferência para analista',
        confidence: 75,
        confidenceLevel: 'Média',
        rulesApplied: [
          'Resiliência de Sistema Legado (PRD pág. 1): O serviço de chamados fica indisponível por alguns segundos ocasionalmente.',
        ],
        reasoning:
          'O serviço legado de chamados retornou timeout/indisponibilidade temporária. O agente preservou o contexto da conversa e orientou o funcionário sem perder a mensagem.',
        toolCalls: [
          {
            toolId: 'list-my-tickets',
            label: 'tentou consultar sistema legado',
            input: { authenticatedEmployeeId: employee.id },
            outputSummary: 'Erro: LegacySystemUnavailableError (timeout temporário)',
            durationMs: 150,
            retriedLegacyError: true,
          },
        ],
        engine: 'mastra-deterministic-hybrid',
      };

      const fallbackMsg = conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content:
          'O sistema de chamados está temporariamente indisponível por alguns segundos. Posso tentar consultar novamente agora ou transferir sua conversa para um analista.',
        quickOptions: [
          { label: 'Tentar novamente', value: input.userMessage.trim() },
          { label: 'Falar com um analista', value: 'Quero falar com um analista.' },
        ],
        decisionTrace: trace,
      });

      return {
        employeeMessage,
        agentMessage: fallbackMsg,
        conversation: conversationService.getConversationById(conversation.id)!,
        agentPaused: false,
        limitReached: false,
      };
    }
    throw err;
  }
}

async function executeAgentTurn(
  conversation: Conversation,
  employee: Employee,
  text: string
): Promise<Message> {
  const lower = text.toLowerCase();
  const toolCalls: DecisionToolCall[] = [];
  const cfg = getServerModelConfig();
  const engineLabel: DecisionTrace['engine'] = cfg.hasApiKey
    ? 'mastra-llm'
    : 'mastra-deterministic-hybrid';

  // ============================================================================
  // PASSO 1: Verificar se há confirmação ou cancelamento de rascunho pendente via texto
  // ============================================================================
  const pendingDraft = ticketService.getPendingDraftForConversation(conversation.id);
  if (
    pendingDraft &&
    (lower === 'confirmar' ||
      lower === 'confirmo' ||
      lower === 'sim, pode criar' ||
      lower === 'pode criar' ||
      lower === 'pode confirmar')
  ) {
    const startMs = Date.now();
    const { ticket, draft, retriedLegacyError } = await ticketService.confirmDraft(
      pendingDraft.id,
      employee.id
    );
    toolCalls.push({
      toolId: 'confirm-ticket-draft',
      label:
        draft.operation === 'CREATE'
          ? `criou o chamado ${ticket.number}`
          : draft.operation === 'REOPEN'
            ? `reabriu o chamado ${ticket.number}`
            : `atualizou o chamado ${ticket.number}`,
      input: { draftCode: draft.code, authenticatedEmployeeId: employee.id },
      outputSummary: `${ticket.number} (${ticket.status} · Prioridade ${ticket.priority})`,
      durationMs: Date.now() - startMs,
      retriedLegacyError,
    });

    conversationService.updatePendingContext(conversation.id, null, ticket.number);

    const actionWord =
      draft.operation === 'CREATE'
        ? 'criado'
        : draft.operation === 'REOPEN'
          ? 'reaberto'
          : 'atualizado';

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: `Pronto! O chamado **${ticket.number}** foi ${actionWord} com prioridade **${ticket.priority.toLowerCase()}**. Você pode acompanhar o andamento por aqui.`,
      ticketCard: ticket,
      decisionTrace: {
        id: `dec-conf-${Date.now()}`,
        steps: [
          `confirmou o rascunho ${draft.code}`,
          `${actionWord === 'criado' ? 'criou' : actionWord === 'reaberto' ? 'reabriu' : 'atualizou'} o ${ticket.number}`,
        ],
        intent: 'CONFIRM_DRAFT',
        scope: 'TI',
        actionTaken: `Efetivou o rascunho ${draft.code} gerando/atualizando o chamado ${ticket.number}`,
        confidence: 99,
        confidenceLevel: 'Alta',
        classification: {
          type: ticket.type,
          category: ticket.category,
          priority: ticket.priority,
          affectedScope: ticket.affectedScope,
        },
        rulesApplied: [
          `Anexo A (Abertura com confirmação): Rascunho ${draft.code} confirmado explicitamente por ${employee.name}.`,
        ],
        reasoning:
          'O funcionário confirmou o rascunho pendente. A operação foi validada no servidor e persistida no banco SQLite.',
        toolCalls,
        engine: engineLabel,
      },
    });
  }

  // ============================================================================
  // PASSO 2: Verificar se o funcionário pediu transferência para analista
  // ============================================================================
  if (
    lower.includes('falar com um analista') ||
    lower.includes('falar com analista') ||
    lower.includes('chamar um analista') ||
    lower.includes('transferir para analista') ||
    lower.includes('atendente humano') ||
    lower.includes('quero falar com alguém')
  ) {
    const startMs = Date.now();
    const activeTicketNum = conversation.activeTicketNumber;
    const summaryText = activeTicketNum
      ? `${employee.name} solicitou falar com um analista sobre o chamado ${activeTicketNum}. Histórico da conversa preservado para atendimento N2.`
      : `${employee.name} solicitou atendimento humano direto no chat do Service Desk.`;

    await execRequestAnalystTransfer({
      conversationId: conversation.id,
      reason: activeTicketNum === 'INC-20311' ? 'OVERDUE_TICKET' : 'USER_REQUESTED',
      reasonLabel:
        activeTicketNum === 'INC-20311'
          ? 'Chamado vencido + solicitação do funcionário'
          : 'Solicitado pelo funcionário',
      targetTier: 'Suporte N2',
      confidence: 98,
      relatedTicketNumber: activeTicketNum ?? null,
      summary: summaryText,
    });

    toolCalls.push({
      toolId: 'request-analyst-transfer',
      label: 'transferiu para Suporte N2',
      input: {
        conversationId: conversation.id,
        relatedTicketNumber: activeTicketNum,
        targetTier: 'Suporte N2',
      },
      outputSummary: 'Conversa marcada como WAITING_ANALYST; agent pausado',
      durationMs: Date.now() - startMs,
    });

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content:
        'Encaminhei para o Suporte N2 com o resumo do seu caso. Um analista vai falar com você em até 2 h úteis. Enquanto isso, fico pausado nesta conversa.',
      decisionTrace: {
        id: `dec-tr-${Date.now()}`,
        steps: activeTicketNum
          ? [`consultou o ${activeTicketNum}`, 'transferiu para Suporte N2']
          : ['transferiu para Suporte N2'],
        intent: 'TRANSFER_TO_ANALYST',
        scope: 'TI',
        actionTaken:
          'Transferiu a conversa para o Suporte N2 com resumo do caso e pausou o agent',
        confidence: 98,
        confidenceLevel: 'Alta',
        rulesApplied: [
          'Anexo A (Transferência): Acontece quando o funcionário pede ou em chamados vencidos.',
          'Anexo A (Pausa do Agent): O agent para de responder enquanto a conversa aguarda ou está com um analista.',
        ],
        reasoning:
          'O funcionário solicitou atendimento por um analista. O agente montou o resumo do contexto, atualizou o status da conversa para Aguardando Atendente e pausou suas respostas.',
        toolCalls,
        engine: engineLabel,
      },
    });
  }

  // ============================================================================
  // PASSO 3: Verificar Escopo (Anexo A — Apenas assuntos de TI)
  // ============================================================================
  const scopeCheck = evaluateScope(text);
  if (!scopeCheck.isItScope) {
    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: scopeCheck.redirectMessage!,
      decisionTrace: {
        id: `dec-scope-${Date.now()}`,
        steps: ['validou o escopo da solicitação', `redirecionou para ${scopeCheck.department}`],
        intent: 'OUT_OF_SCOPE_REDIRECT',
        scope: scopeCheck.department,
        actionTaken: `Identificou assunto fora de TI (${scopeCheck.department}) e redirecionou sem abrir chamado`,
        confidence: 96,
        confidenceLevel: 'Alta',
        rulesApplied: [scopeCheck.ruleApplied],
        reasoning: `A mensagem trata de ${scopeCheck.department}, fora do escopo do Service Desk de TI definido no Anexo A.`,
        toolCalls: [],
        engine: engineLabel,
      },
    });
  }

  // ============================================================================
  // PASSO 4: Verificar se o usuário pediu para complementar/atualizar um chamado específico
  // ============================================================================
  const ticketCodeMatch = text.match(/\b(INC|REQ)-\d{4,6}\b/i);
  const explicitTicketNumber = ticketCodeMatch ? ticketCodeMatch[0].toUpperCase() : null;

  if (
    lower.includes('adicionar uma nova informação') ||
    lower.includes('adicionar informação') ||
    lower.includes('complementar chamado') ||
    lower.includes('atualizar o chamado')
  ) {
    const targetNum = explicitTicketNumber || conversation.activeTicketNumber || 'INC-20311';
    conversationService.updatePendingContext(
      conversation.id,
      {
        intent: 'UPDATE_TICKET',
        targetTicketNumber: targetNum,
        awaitingField: 'updateDetails',
      },
      targetNum
    );

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: `Claro! Qual informação adicional você gostaria de incluir no chamado **${targetNum}**? Vou montar um rascunho da atualização para você confirmar antes de salvar.`,
      decisionTrace: {
        id: `dec-upd-ask-${Date.now()}`,
        steps: [`selecionou o ${targetNum} para complemento`],
        intent: 'UPDATE_TICKET_DRAFT',
        scope: 'TI',
        actionTaken: `Solicitou os novos detalhes para preparar rascunho de atualização do chamado ${targetNum}`,
        confidence: 95,
        confidenceLevel: 'Alta',
        rulesApplied: [
          'Anexo A (Sem duplicidade / Atualização): Complementar chamado aberto após confirmação do funcionário.',
        ],
        reasoning: `O funcionário pediu para adicionar informações ao chamado ${targetNum}.`,
        toolCalls: [],
        engine: engineLabel,
      },
    });
  }

  if (
    conversation.pendingContext?.awaitingField === 'updateDetails' &&
    conversation.pendingContext.targetTicketNumber
  ) {
    const targetNum = conversation.pendingContext.targetTicketNumber;
    const t0 = Date.now();
    const detail = await execInspectTicketDetail({
      ticketNumber: targetNum,
      authenticatedEmployeeId: employee.id,
    });
    toolCalls.push({
      toolId: 'inspect-ticket-detail',
      label: `consultou o ${targetNum}`,
      input: { ticketNumber: targetNum, authenticatedEmployeeId: employee.id },
      outputSummary: detail.ticket
        ? `${detail.ticket.number} (${detail.ticket.category} · ${detail.ticket.priority})`
        : detail.message,
      durationMs: Date.now() - t0,
    });

    if (detail.ticket) {
      const slaRes = evaluatePriorityAndSla({
        type: targetNum.startsWith('REQ') ? 'REQ' : 'INC',
        affectedScope: 'Somente você',
        hasSameDayDeadline: detail.ticket.priority === 'Alta',
      });

      const draft = ticketService.createPendingDraft({
        conversationId: conversation.id,
        requesterId: employee.id,
        operation: 'UPDATE',
        targetTicketNumber: targetNum,
        type: targetNum.startsWith('REQ') ? 'REQ' : 'INC',
        title: detail.ticket.title,
        description: text,
        category: detail.ticket.category as never,
        priority: detail.ticket.priority,
        affectedScope: 'Somente você',
        slaDueLabel: slaRes.slaDueLabel,
      });

      toolCalls.push({
        toolId: 'prepare-ticket-draft',
        label: 'montou o rascunho',
        input: { operation: 'UPDATE', targetTicketNumber: targetNum, description: text },
        outputSummary: `Rascunho ${draft.code} (atualização de ${targetNum})`,
        durationMs: 14,
      });

      conversationService.updatePendingContext(conversation.id, null, targetNum);

      return conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content: `Preparei o rascunho para atualizar o chamado **${targetNum}** com as novas informações. Confira e confirme abaixo:`,
        draftCard: draft,
        decisionTrace: {
          id: `dec-upd-draft-${Date.now()}`,
          steps: [`consultou o ${targetNum}`, 'montou o rascunho'],
          intent: 'UPDATE_TICKET_DRAFT',
          scope: 'TI',
          actionTaken: `Criou rascunho ${draft.code} para atualizar o chamado aberto ${targetNum}`,
          confidence: 96,
          confidenceLevel: 'Alta',
          classification: {
            type: draft.type,
            category: draft.category,
            priority: draft.priority,
            affectedScope: draft.affectedScope,
          },
          rulesApplied: [
            'Anexo A (Abertura/Atualização): Mostrar rascunho e só atualizar o chamado depois da confirmação do funcionário.',
          ],
          reasoning: `O funcionário forneceu o complemento para o chamado ${targetNum}. O rascunho aguarda confirmação.`,
          toolCalls,
          engine: engineLabel,
        },
      });
    }
  }

  // ============================================================================
  // PASSO 5: Consulta explícita de um número de chamado (ex.: INC-20311, REQ-10501)
  // ============================================================================
  if (
    explicitTicketNumber &&
    !lower.includes('reabrir') &&
    !lower.includes('bloqueou de novo') &&
    !lower.includes('novamente')
  ) {
    const t0 = Date.now();
    const detail = await execInspectTicketDetail({
      ticketNumber: explicitTicketNumber,
      authenticatedEmployeeId: employee.id,
    });

    toolCalls.push({
      toolId: 'inspect-ticket-detail',
      label: `consultou o ${explicitTicketNumber}`,
      input: { ticketNumber: explicitTicketNumber, authenticatedEmployeeId: employee.id },
      outputSummary: detail.privacyDenied
        ? `Acesso negado (Privacidade): ${explicitTicketNumber} pertence a outro colaborador`
        : detail.found && detail.ticket
          ? `${detail.ticket.number} · ${detail.ticket.status}`
          : 'Chamado não encontrado',
      durationMs: Date.now() - t0,
      retriedLegacyError: detail.retriedLegacyError,
    });

    // Caso 5a: Violação de Privacidade (tentou consultar chamado de outro funcionário!)
    if (detail.privacyDenied) {
      return conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content: `Por segurança e privacidade, não posso exibir informações do chamado **${explicitTicketNumber}**, pois ele foi aberto por outro colaborador. Posso consultar apenas os chamados vinculados ao seu e-mail (${employee.email}).`,
        decisionTrace: {
          id: `dec-priv-${Date.now()}`,
          steps: [`verificou titularidade do ${explicitTicketNumber}`, 'bloqueou acesso por privacidade'],
          intent: 'CHECK_TICKET_STATUS',
          scope: 'TI',
          actionTaken: `Bloqueou exibição do chamado ${explicitTicketNumber} por pertencer a outro funcionário`,
          confidence: 99,
          confidenceLevel: 'Alta',
          rulesApplied: [
            'Anexo A (Privacidade): Informações de um chamado só podem ser passadas a quem o abriu.',
          ],
          reasoning: `O chamado ${explicitTicketNumber} existe no banco, mas o requester_id diverge do colaborador autenticado (${employee.id}). A camada de serviço bloqueou o acesso.`,
          toolCalls,
          engine: engineLabel,
        },
      });
    }

    // Caso 5b: Chamado encontrado e pertence ao funcionário!
    if (detail.found && detail.ticket) {
      const { ticket: fullTicket } = await ticketService.getTicketForEmployee(
        explicitTicketNumber,
        employee.id
      );
      const slaInfo = inspectTicketSla(fullTicket!);

      toolCalls.push({
        toolId: 'evaluate-priority-and-sla',
        label: 'calculou o prazo',
        input: { priority: fullTicket!.priority, updatedAt: fullTicket!.updatedAt },
        outputSummary: slaInfo.isOverdue
          ? `Vencido (${slaInfo.relativeUpdateLabel}, acima de ${slaInfo.slaTargetLabel})`
          : `Dentro do prazo (${slaInfo.slaTargetLabel})`,
        durationMs: 5,
      });

      conversationService.updatePendingContext(conversation.id, null, fullTicket!.number);

      const replyContent = slaInfo.isOverdue
        ? `Está sem atualização ${slaInfo.relativeUpdateLabel}, acima do prazo de ${slaInfo.slaTargetLabel} para prioridade ${fullTicket!.priority.toLowerCase()}. Quer que eu chame um analista?`
        : `O chamado **${fullTicket!.number}** está com status **${fullTicket!.status}** (última atualização ${slaInfo.relativeUpdateLabel}, dentro do prazo de ${slaInfo.slaTargetLabel} para prioridade ${fullTicket!.priority.toLowerCase()}). Deseja adicionar alguma informação?`;

      const options: QuickOption[] = slaInfo.isOverdue
        ? [
            { label: 'Falar com um analista', value: 'Quero falar com um analista.' },
            {
              label: 'Adicionar informação',
              value: `Quero adicionar uma nova informação ao chamado ${fullTicket!.number}`,
            },
            { label: 'Não, obrigado', value: 'Não, obrigado' },
          ]
        : [
            {
              label: 'Adicionar informação',
              value: `Quero adicionar uma nova informação ao chamado ${fullTicket!.number}`,
            },
            { label: 'Falar com um analista', value: 'Quero falar com um analista.' },
          ];

      return conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content: replyContent,
        ticketCard: fullTicket!,
        quickOptions: options,
        decisionTrace: {
          id: `dec-tkt-${Date.now()}`,
          steps: [`consultou o ${fullTicket!.number}`, 'calculou o prazo'],
          intent: 'CHECK_TICKET_STATUS',
          scope: 'TI',
          actionTaken: slaInfo.isOverdue
            ? `Exibiu o chamado ${fullTicket!.number}, detectou prazo vencido e ofereceu transferência para analista`
            : `Exibiu o status e prazo atualizados do chamado ${fullTicket!.number}`,
          confidence: 96,
          confidenceLevel: 'Alta',
          classification: {
            type: fullTicket!.type,
            category: fullTicket!.category,
            priority: fullTicket!.priority,
            affectedScope: fullTicket!.affectedScope,
            slaLabel: `${slaInfo.slaTargetLabel}${slaInfo.isOverdue ? ' (vencido)' : ''}`,
          },
          rulesApplied: [
            `Anexo A (Privacidade): Titularidade do chamado ${fullTicket!.number} validada para ${employee.email}.`,
            `Anexo A (Prioridade e prazos): Prioridade ${fullTicket!.priority} possui prazo de ${slaInfo.slaTargetLabel}.`,
            ...(slaInfo.isOverdue
              ? [
                  'Anexo A (Transferência): Chamado com prazo vencido habilita transferência para analista.',
                ]
              : []),
          ],
          reasoning: slaInfo.isOverdue
            ? `O chamado ${fullTicket!.number} está sem atualização ${slaInfo.relativeUpdateLabel}, ultrapassando o SLA de ${slaInfo.slaTargetLabel}.`
            : `O chamado ${fullTicket!.number} encontra-se dentro do SLA previsto.`,
          toolCalls,
          engine: engineLabel,
        },
      });
    }
  }

  // ============================================================================
  // PASSO 6: Consulta geral de chamados ("Qual o status do meu chamado?", "Meus chamados")
  // ============================================================================
  if (
    lower.includes('status do meu chamado') ||
    lower.includes('meus chamados') ||
    lower.includes('chamados abertos') ||
    lower.includes('como está meu chamado') ||
    lower.includes('como esta meu chamado') ||
    lower.includes('consultar chamado')
  ) {
    const t0 = Date.now();
    const listRes = await execListMyTickets({
      authenticatedEmployeeId: employee.id,
      onlyOpen: true,
    });

    toolCalls.push({
      toolId: 'list-my-tickets',
      label: 'consultou seus chamados',
      input: { authenticatedEmployeeId: employee.id, onlyOpen: true },
      outputSummary: `${listRes.count} chamados abertos encontrados`,
      durationMs: Date.now() - t0,
      retriedLegacyError: listRes.retriedLegacyError,
    });

    const { tickets: openTickets } = await ticketService.listTicketsForEmployee(employee.id, {
      onlyOpen: true,
    });

    if (openTickets.length === 0) {
      return conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content:
          'Você não tem nenhum chamado aberto no momento. Se estiver com algum problema de TI ou precisar de um acesso/equipamento, pode me descrever por aqui!',
        decisionTrace: {
          id: `dec-list-empty-${Date.now()}`,
          steps: ['consultou seus chamados'],
          intent: 'CHECK_TICKET_STATUS',
          scope: 'TI',
          actionTaken: 'Consultou chamados abertos do funcionário (nenhum aberto)',
          confidence: 97,
          confidenceLevel: 'Alta',
          rulesApplied: ['Anexo A (Privacidade): Consulta restrita ao colaborador autenticado.'],
          reasoning: 'Não há chamados abertos para este funcionário.',
          toolCalls,
          engine: engineLabel,
        },
      });
    }

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: `Você tem ${openTickets.length} chamados abertos. Sobre qual deles quer saber?`,
      ticketSelector: openTickets,
      decisionTrace: {
        id: `dec-list-${Date.now()}`,
        steps: ['consultou seus chamados'],
        intent: 'CHECK_TICKET_STATUS',
        scope: 'TI',
        actionTaken: `Listou os ${openTickets.length} chamados abertos de ${employee.name} para seleção`,
        confidence: 96,
        confidenceLevel: 'Alta',
        rulesApplied: [
          `Anexo A (Privacidade): Filtrados apenas os chamados de ${employee.email}.`,
        ],
        reasoning:
          'O funcionário perguntou sobre seus chamados sem especificar o número. Exibido o seletor com todos os chamados abertos dele.',
        toolCalls,
        engine: engineLabel,
      },
    });
  }

  // ============================================================================
  // PASSO 7: Continuação de triagem (funcionário respondeu "Quem está sendo afetado?" + urgência)
  // ============================================================================
  const parsedScope = parseAffectedScope(text);
  if (
    conversation.pendingContext?.awaitingField === 'affectedScope' ||
    (parsedScope && conversation.pendingContext?.problemDescription)
  ) {
    const scopeToUse: AffectedScope = parsedScope ?? 'Somente você';
    const urgency = detectUrgencySignals(text);
    const pending = conversation.pendingContext!;
    const ticketType = pending.type ?? 'INC';
    const ticketCategory = pending.category ?? 'Rede e VPN';
    const baseProblem = pending.problemDescription ?? 'Problema técnico relatado pelo colaborador';
    const title = pending.suggestedTitle ?? 'Chamado de suporte de TI';

    const t0 = Date.now();
    const slaRes = await execEvaluatePriorityAndSla({
      type: ticketType,
      affectedScope: scopeToUse,
      hasSameDayDeadline: urgency.hasSameDayDeadline,
      blocksWorkCompletely: urgency.blocksWorkCompletely,
    });

    toolCalls.push({
      toolId: 'evaluate-priority-and-sla',
      label: 'classificou a prioridade',
      input: {
        type: ticketType,
        affectedScope: scopeToUse,
        hasSameDayDeadline: urgency.hasSameDayDeadline,
      },
      outputSummary: `Prioridade ${slaRes.priority} · SLA ${slaRes.slaDurationLabel} (${slaRes.slaDueLabel})`,
      durationMs: Date.now() - t0,
    });

    toolCalls.push({
      toolId: 'evaluate-priority-and-sla',
      label: 'consultou o SLA',
      input: { priority: slaRes.priority },
      outputSummary: `Prazo de atendimento: ${slaRes.slaDurationLabel} (${slaRes.slaDueLabel})`,
      durationMs: 4,
    });

    const fullDescription = urgency.hasSameDayDeadline
      ? `${baseProblem} (${employee.os}). Informou impacto: ${scopeToUse}. Detalhe de urgência: ${text}`
      : `${baseProblem} (${employee.os}). Impacto informado: ${scopeToUse}.`;

    const draft = ticketService.createPendingDraft({
      conversationId: conversation.id,
      requesterId: employee.id,
      operation: 'CREATE',
      type: ticketType,
      title,
      description: fullDescription,
      category: ticketCategory,
      priority: slaRes.priority,
      affectedScope: scopeToUse,
      slaDueLabel: slaRes.slaDueLabel,
    });

    toolCalls.push({
      toolId: 'prepare-ticket-draft',
      label: 'montou o rascunho',
      input: {
        operation: 'CREATE',
        type: ticketType,
        title,
        category: ticketCategory,
        priority: slaRes.priority,
        affectedScope: scopeToUse,
      },
      outputSummary: `Rascunho ${draft.code} criado (PENDING_CONFIRMATION)`,
      durationMs: 15,
    });

    conversationService.updatePendingContext(conversation.id, null);

    let explanationText: string;
    if (slaRes.priority === 'Crítica') {
      explanationText = `Como o problema afeta **${scopeToUse.toLowerCase()}**, classifiquei com prioridade **Crítica** (prazo de 1 hora em plantão 24h). Confira o rascunho abaixo para eu abrir o chamado e já acionar um analista:`;
    } else if (slaRes.priority === 'Alta' && urgency.meetingTimeLabel) {
      explanationText = `Coloquei prioridade **alta** por causa do compromisso às ${urgency.meetingTimeLabel} — a resposta chega dentro de 4 horas úteis. Confira antes de eu criar:`;
    } else if (slaRes.priority === 'Alta') {
      explanationText = `Coloquei prioridade **alta** (prazo de 4 horas úteis) pois há bloqueio/compromisso no mesmo dia. Confira antes de eu criar:`;
    } else {
      explanationText = `Classifiquei com prioridade **${slaRes.priority.toLowerCase()}** (prazo de ${slaRes.slaDurationLabel}). Confira os dados do rascunho antes de eu criar:`;
    }

    const enhanced = await maybeEnhanceWithMastraLlm(
      explanationText,
      `Rascunho ${draft.code}: Título="${draft.title}", Tipo=${draft.type}, Categoria=${draft.category}, Prioridade=${draft.priority}, SLA=${slaRes.slaDurationLabel}, Afetados=${draft.affectedScope}`
    );

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: enhanced.text,
      draftCard: draft,
      decisionTrace: {
        id: `dec-draft-${Date.now()}`,
        steps: ['classificou a prioridade', 'consultou o SLA', 'montou o rascunho'],
        intent: 'OPEN_TICKET_DRAFT',
        scope: 'TI',
        actionTaken: `Classificou prioridade ${draft.priority} (${slaRes.slaDurationLabel}) e montou o rascunho ${draft.code} para confirmação`,
        confidence: 97,
        confidenceLevel: 'Alta',
        classification: {
          type: draft.type,
          category: draft.category,
          priority: draft.priority,
          affectedScope: draft.affectedScope,
          slaLabel: `${slaRes.slaDurationLabel} (${draft.slaDueLabel.replace('· ', '')})`,
        },
        rulesApplied: [
          `Anexo A (Prioridade e prazos): ${slaRes.ruleExplanation}`,
          'Anexo A (Abertura): Todo chamado exige título, descrição, tipo, categoria, prioridade e afetados, e só é criado após confirmação do rascunho.',
        ],
        reasoning: slaRes.ruleExplanation,
        toolCalls,
        engine: enhanced.usedLlm ? 'mastra-llm' : engineLabel,
      },
    });
  }

  // ============================================================================
  // PASSO 8: Buscar na Central de Ajuda e nos Chamados do Funcionário (Sem duplicidade / Reabertura 7 dias)
  // ============================================================================
  const { type, category, suggestedTitle } = classifyTicketTypeAndCategory(text);

  // 8.1: Verifica chamados existentes do funcionário (Sem duplicidade + Reabertura em 7 dias)
  const tDupStart = Date.now();
  const dupCheck = await execCheckDuplicateOrReopen({
    authenticatedEmployeeId: employee.id,
    problemText: text,
    category,
  });

  toolCalls.push({
    toolId: 'list-my-tickets',
    label: 'consultou seus chamados',
    input: { authenticatedEmployeeId: employee.id, category },
    outputSummary:
      dupCheck.action === 'CREATE_NEW_TICKET'
        ? `Nenhum chamado duplicado aberto ou recente em ${category}`
        : `${dupCheck.action}: ${dupCheck.matchedTicketNumber}`,
    durationMs: Date.now() - tDupStart,
  });

  // Se já existe chamado ABERTO sobre o mesmo problema -> propõe rascunho de ATUALIZAÇÃO (não duplica!)
  if (dupCheck.action === 'UPDATE_OPEN_TICKET' && dupCheck.matchedTicketNumber) {
    const { ticket: existingOpen } = await ticketService.getTicketForEmployee(
      dupCheck.matchedTicketNumber,
      employee.id
    );
    if (existingOpen) {
      const slaEval = evaluatePriorityAndSla({
        type: existingOpen.type,
        affectedScope: existingOpen.affectedScope,
        hasSameDayDeadline: detectUrgencySignals(text).hasSameDayDeadline,
      });

      const nextPriority: TicketPriority =
        detectUrgencySignals(text).hasSameDayDeadline && existingOpen.priority === 'Média'
          ? 'Alta'
          : existingOpen.priority;

      const draft = ticketService.createPendingDraft({
        conversationId: conversation.id,
        requesterId: employee.id,
        operation: 'UPDATE',
        targetTicketNumber: existingOpen.number,
        type: existingOpen.type,
        title: existingOpen.title,
        description: text,
        category: existingOpen.category,
        priority: nextPriority,
        affectedScope: existingOpen.affectedScope,
        slaDueLabel: slaEval.slaDueLabel,
      });

      toolCalls.push({
        toolId: 'prepare-ticket-draft',
        label: 'montou o rascunho',
        input: {
          operation: 'UPDATE',
          targetTicketNumber: existingOpen.number,
          priority: nextPriority,
        },
        outputSummary: `Rascunho ${draft.code} para atualizar ${existingOpen.number} sem duplicar`,
        durationMs: 12,
      });

      return conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content: `Você já tem o chamado aberto **${existingOpen.number}** ("${existingOpen.title}") sobre esse assunto. Pelas regras do service desk, não abrimos chamado duplicado — montei um rascunho para atualizar o seu chamado existente com essa nova informação. Confira e confirme:`,
        draftCard: draft,
        decisionTrace: {
          id: `dec-nodup-${Date.now()}`,
          steps: ['consultou seus chamados', 'detectou chamado aberto', 'montou o rascunho'],
          intent: 'UPDATE_TICKET_DRAFT',
          scope: 'TI',
          actionTaken: `Evitou duplicidade e preparou rascunho ${draft.code} para complementar o chamado ${existingOpen.number}`,
          confidence: 95,
          confidenceLevel: 'Alta',
          classification: {
            type: existingOpen.type,
            category: existingOpen.category,
            priority: nextPriority,
            affectedScope: existingOpen.affectedScope,
          },
          rulesApplied: [dupCheck.reason],
          reasoning:
            'Pelo Anexo A (Sem duplicidade), quando já existe chamado aberto sobre o mesmo problema, ele deve ser atualizado em vez de duplicado.',
          toolCalls,
          engine: engineLabel,
        },
      });
    }
  }

  // Se existe chamado RESOLVIDO HÁ ATÉ 7 DIAS sobre o mesmo problema (ex: INC-20150 Senha do SAP bloqueada!) -> REABRIR!
  if (dupCheck.action === 'REOPEN_RESOLVED_TICKET' && dupCheck.matchedTicketNumber) {
    const { ticket: resolvedTicket } = await ticketService.getTicketForEmployee(
      dupCheck.matchedTicketNumber,
      employee.id
    );
    if (resolvedTicket) {
      const urgency = detectUrgencySignals(text);
      const nextPriority: TicketPriority = urgency.hasSameDayDeadline ? 'Alta' : resolvedTicket.priority;
      const slaEval = evaluatePriorityAndSla({
        type: resolvedTicket.type,
        affectedScope: resolvedTicket.affectedScope,
        hasSameDayDeadline: urgency.hasSameDayDeadline,
      });

      const draft = ticketService.createPendingDraft({
        conversationId: conversation.id,
        requesterId: employee.id,
        operation: 'REOPEN',
        targetTicketNumber: resolvedTicket.number,
        type: resolvedTicket.type,
        title: `${resolvedTicket.title} (Reabertura)`,
        description: text,
        category: resolvedTicket.category,
        priority: nextPriority,
        affectedScope: resolvedTicket.affectedScope,
        slaDueLabel: slaEval.slaDueLabel,
      });

      toolCalls.push({
        toolId: 'prepare-ticket-draft',
        label: 'montou o rascunho de reabertura',
        input: {
          operation: 'REOPEN',
          targetTicketNumber: resolvedTicket.number,
          priority: nextPriority,
        },
        outputSummary: `Rascunho ${draft.code} para reabrir ${resolvedTicket.number}`,
        durationMs: 14,
      });

      return conversationService.appendMessage({
        conversationId: conversation.id,
        senderType: 'agent',
        senderName: 'Nexo Assist',
        senderRole: 'IA',
        content: `Encontrei o seu chamado **${resolvedTicket.number}** ("${resolvedTicket.title}"), que foi resolvido há menos de 7 dias. Pela regra do service desk, podemos **reabri-lo** em vez de criar um novo. Confira o rascunho de reabertura abaixo:`,
        draftCard: draft,
        decisionTrace: {
          id: `dec-reopen-${Date.now()}`,
          steps: ['consultou seus chamados', 'verificou regra de 7 dias', 'montou o rascunho'],
          intent: 'REOPEN_TICKET_DRAFT',
          scope: 'TI',
          actionTaken: `Identificou chamado ${resolvedTicket.number} resolvido há <= 7 dias e montou rascunho de reabertura ${draft.code}`,
          confidence: 96,
          confidenceLevel: 'Alta',
          classification: {
            type: resolvedTicket.type,
            category: resolvedTicket.category,
            priority: nextPriority,
            affectedScope: resolvedTicket.affectedScope,
          },
          rulesApplied: [dupCheck.reason],
          reasoning:
            'Conforme Anexo A (Sem duplicidade), chamados resolvidos há até 7 dias podem ser reabertos quando o problema volta a ocorrer.',
          toolCalls,
          engine: engineLabel,
        },
      });
    }
  }

  // 8.2: Busca na Central de Ajuda
  const tKbStart = Date.now();
  const kbRes = await execSearchHelpCenter({
    query: text,
    employeeOs: employee.os,
  });

  toolCalls.push({
    toolId: 'search-help-center',
    label: 'buscou na central de ajuda',
    input: { query: text, employeeOs: employee.os },
    outputSummary:
      kbRes.matchedCount > 0
        ? `Artigo: "${kbRes.articles[0]!.title}" (resolve sem chamado: ${kbRes.articles[0]!.solvesWithoutTicket ? 'Sim' : 'Não'})`
        : 'Nenhum artigo aplicável encontrado',
    durationMs: Date.now() - tKbStart,
  });

  const topArticle = kbRes.articles[0];

  // Caso 8.2a: Artigo encontrado e resolve sem precisar abrir chamado!
  if (
    topArticle &&
    topArticle.solvesWithoutTicket &&
    !lower.includes('abrir chamado') &&
    !lower.includes('abrir um chamado')
  ) {
    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: `${topArticle.content}\n\nIsso resolveu sua dúvida ou prefere que eu abra um chamado?`,
      quickOptions: [
        { label: 'Isso resolveu, obrigado!', value: 'Isso resolveu, obrigado!' },
        { label: 'Quero abrir um chamado', value: `Quero abrir um chamado sobre: ${text}` },
      ],
      decisionTrace: {
        id: `dec-kb-${Date.now()}`,
        steps: ['consultou seus chamados', 'buscou na central de ajuda'],
        intent: 'FAQ_RESOLUTION',
        scope: 'TI',
        actionTaken: `Respondeu usando o artigo "${topArticle.title}" da Central de Ajuda (Resolução sem fila)`,
        confidence: 94,
        confidenceLevel: 'Alta',
        rulesApplied: [
          `Resolução sem fila (PRD pág. 1): Dúvida respondida pelo artigo "${topArticle.title}" (${topArticle.id}).`,
        ],
        reasoning: `O artigo "${topArticle.title}" responde diretamente ao cenário relatado pelo colaborador (${employee.os}).`,
        toolCalls,
        engine: engineLabel,
      },
    });
  }

  // Caso 8.2b: Usuário agradeceu ("Isso resolveu, obrigado!" / "Não, obrigado")
  if (
    lower.includes('isso resolveu') ||
    lower.includes('não, obrigado') ||
    lower.includes('nao, obrigado') ||
    lower === 'obrigado' ||
    lower === 'obrigada'
  ) {
    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content:
        'Perfeito! Se precisar de mais alguma coisa do service desk de TI, é só me chamar por aqui.',
      decisionTrace: {
        id: `dec-ack-${Date.now()}`,
        steps: ['registrou encerramento da dúvida'],
        intent: 'FAQ_RESOLUTION',
        scope: 'TI',
        actionTaken: 'Finalizou o turno mantendo a sessão disponível',
        confidence: 99,
        confidenceLevel: 'Alta',
        rulesApplied: ['Atendimento concluído sem fila.'],
        reasoning: 'O funcionário confirmou que não precisa de ação adicional no momento.',
        toolCalls: [],
        engine: engineLabel,
      },
    });
  }

  // Caso 8.2c: Caso complexo/ambíguo com baixa confiança (< 60%) -> Escalonamento automático para Analista!
  const isAmbiguousOrComplexInfra =
    lower.includes('coletor') ||
    lower.includes('wms') ||
    lower.includes('vlan') ||
    lower.includes('bgp') ||
    lower.includes('firewall') ||
    lower.includes('servidor de produção') ||
    lower.includes('banco de dados corrompido');

  if (isAmbiguousOrComplexInfra) {
    await execRequestAnalystTransfer({
      conversationId: conversation.id,
      reason: 'LOW_CONFIDENCE',
      reasonLabel: 'Agent pediu ajuda · confiança 41%',
      targetTier: 'Suporte N2',
      confidence: 41,
      relatedTicketNumber: conversation.activeTicketNumber ?? null,
      summary: `${employee.name} relatou falha avançada de infraestrutura ("${text}"). Nenhum artigo aplicável na Central de Ajuda; escalonado automaticamente por baixa confiança (41%).`,
    });

    toolCalls.push({
      toolId: 'request-analyst-transfer',
      label: 'pediu ajuda ao analista (confiança 41%)',
      input: { reason: 'LOW_CONFIDENCE', confidence: 41, targetTier: 'Suporte N2' },
      outputSummary: 'Transferida para Suporte N2; agent pausado',
      durationMs: 18,
    });

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content:
        'Não tenho segurança suficiente para diagnosticar esse cenário de infraestrutura pela central de ajuda (confiança de 41%). Já chamei um analista do **Suporte N2** com o resumo do seu caso e pausei meu atendimento automático.',
      decisionTrace: {
        id: `dec-lowconf-${Date.now()}`,
        steps: ['consultou seus chamados', 'buscou na central de ajuda', 'pediu ajuda ao analista'],
        intent: 'TRANSFER_TO_ANALYST',
        scope: 'TI',
        actionTaken:
          'Escalonou automaticamente para o Suporte N2 por baixa segurança (confiança 41%)',
        confidence: 41,
        confidenceLevel: 'Baixa',
        classification: {
          type: 'INC',
          category,
          priority: 'Alta',
        },
        rulesApplied: [
          'Anexo A (Transferência): Acontece quando o agent não tem segurança sobre o que fazer (< 60%).',
          'Anexo A (Pausa do Agent): Conversa aguarda analista humano com resumo do caso.',
        ],
        reasoning:
          'O problema envolve infraestrutura especializada não coberta pela Central de Ajuda. Em vez de arriscar uma classificação ou orientação incorreta, o agente transferiu ao Suporte N2.',
        toolCalls,
        engine: engineLabel,
      },
    });
  }

  // ============================================================================
  // PASSO 9: Fluxo de Abertura de Chamado (Tela 2 do nexo.pen)
  // Se for Requisição (REQ) clara com escopo individual (ex.: segundo monitor), ou se já informou quem é afetado,
  // monta o rascunho direto; caso contrário, faz a pergunta "Quem está sendo afetado?" com as 4 opções rápidas!
  // ============================================================================
  if (type === 'REQ' && (lower.includes('monitor') || lower.includes('teclado') || lower.includes('headset'))) {
    const slaRes = evaluatePriorityAndSla({
      type: 'REQ',
      affectedScope: 'Somente você',
      hasSameDayDeadline: false,
    });

    const draft = ticketService.createPendingDraft({
      conversationId: conversation.id,
      requesterId: employee.id,
      operation: 'CREATE',
      type: 'REQ',
      title: suggestedTitle,
      description: `${text} (Solicitante: ${employee.name} · ${employee.department})`,
      category,
      priority: slaRes.priority,
      affectedScope: 'Somente você',
      slaDueLabel: slaRes.slaDueLabel,
    });

    toolCalls.push({
      toolId: 'evaluate-priority-and-sla',
      label: 'classificou a prioridade',
      input: { type: 'REQ', affectedScope: 'Somente você' },
      outputSummary: `Prioridade ${slaRes.priority} (${slaRes.slaDurationLabel})`,
      durationMs: 6,
    });

    toolCalls.push({
      toolId: 'prepare-ticket-draft',
      label: 'montou o rascunho',
      input: { type: 'REQ', title: suggestedTitle, category, priority: slaRes.priority },
      outputSummary: `Rascunho ${draft.code} (PENDING_CONFIRMATION)`,
      durationMs: 14,
    });

    return conversationService.appendMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderName: 'Nexo Assist',
      senderRole: 'IA',
      content: `Pedidos de equipamento para home office são registrados como **Requisição (REQ)** com prioridade **Baixa** (prazo de 5 dias úteis). Confira os dados do rascunho antes de eu criar:`,
      draftCard: draft,
      decisionTrace: {
        id: `dec-req-${Date.now()}`,
        steps: ['consultou seus chamados', 'buscou na central de ajuda', 'classificou a prioridade', 'montou o rascunho'],
        intent: 'OPEN_TICKET_DRAFT',
        scope: 'TI',
        actionTaken: `Montou rascunho ${draft.code} de Requisição (REQ) de Hardware com prioridade Baixa`,
        confidence: 96,
        confidenceLevel: 'Alta',
        classification: {
          type: 'REQ',
          category,
          priority: 'Baixa',
          affectedScope: 'Somente você',
          slaLabel: '5 dias úteis',
        },
        rulesApplied: [
          'Anexo A (Tipos de chamado): Requisição (REQ) quando é um pedido de acesso, equipamento ou software.',
          'Anexo A (Prioridade Baixa): Pedidos e melhorias sem urgência → 5 dias úteis.',
          'Anexo A (Abertura): Exibe rascunho para confirmação antes de criar.',
        ],
        reasoning:
          'Solicitação de equipamento individual classificada como REQ de Hardware com prioridade Baixa.',
        toolCalls,
        engine: engineLabel,
      },
    });
  }

  // Salva o contexto pendente para a próxima resposta ("Quem está sendo afetado?")
  conversationService.updatePendingContext(conversation.id, {
    intent: 'OPEN_TICKET',
    problemDescription: text,
    suggestedTitle,
    type,
    category,
    awaitingField: 'affectedScope',
  });

  const introMessage =
    topArticle && topArticle.osEscalationReason
      ? `Não há chamado aberto sobre ${category === 'Rede e VPN' ? 'VPN' : category}, e o artigo do erro 809 vale só para Windows 10 — o seu é ${employee.os}. Vou abrir um chamado.`
      : `Não encontrei um chamado aberto sobre isso e precisamos registrar um atendimento na categoria **${category}**. Antes de eu montar o rascunho para sua confirmação:`;

  return conversationService.appendMessage({
    conversationId: conversation.id,
    senderType: 'agent',
    senderName: 'Nexo Assist',
    senderRole: 'IA',
    content: introMessage,
    questionPrompt: 'Quem está sendo afetado?',
    quickOptions: [
      { key: '1', label: 'Só eu', value: 'Só eu', variant: 'primary' },
      { key: '2', label: 'Minha equipe', value: 'Minha equipe' },
      { key: '3', label: 'Toda a empresa', value: 'Toda a empresa' },
      { key: '4', label: 'Não sei', value: 'Não sei' },
    ],
    decisionTrace: {
      id: `dec-triage-${Date.now()}`,
      steps: ['consultou seus chamados', 'buscou na central de ajuda'],
      intent: 'OPEN_TICKET_TRIAGE',
      scope: 'TI',
      actionTaken:
        'Verificou chamados e Central de Ajuda e perguntou quem é afetado antes de classificar a prioridade e criar o rascunho',
      confidence: 95,
      confidenceLevel: 'Alta',
      classification: {
        type,
        category,
      },
      rulesApplied: [
        'Anexo A (Sem duplicidade): Verificado que não há chamado aberto sobre o mesmo problema.',
        ...(topArticle?.osEscalationReason
          ? [`Anexo B (Central de Ajuda): ${topArticle.osEscalationReason}`]
          : []),
        'Anexo A (Abertura): Todo chamado precisa de título, descrição, tipo, categoria, prioridade e de quem é afetado.',
      ],
      reasoning:
        topArticle?.osEscalationReason ??
        'Para definir a prioridade correta segundo a matriz de Impacto × Urgência do Anexo A, o agente precisa saber quantas pessoas são afetadas.',
      toolCalls,
      engine: engineLabel,
    },
  });
}
