import { ConversationStatus } from '../types';

export const MAX_MESSAGES_PER_SESSION = 30;

export type ConversationTransitionAction =
  | 'TRANSFER_TO_ANALYST'
  | 'ANALYST_TAKEOVER'
  | 'RETURN_TO_AGENT'
  | 'CLOSE_CONVERSATION'
  | 'REOPEN_CONVERSATION';

const ALLOWED_TRANSITIONS: Record<
  ConversationStatus,
  Partial<Record<ConversationTransitionAction, ConversationStatus>>
> = {
  ACTIVE_WITH_AGENT: {
    TRANSFER_TO_ANALYST: 'WAITING_ANALYST',
    ANALYST_TAKEOVER: 'WITH_ANALYST',
    CLOSE_CONVERSATION: 'CLOSED',
  },
  WAITING_ANALYST: {
    ANALYST_TAKEOVER: 'WITH_ANALYST',
    RETURN_TO_AGENT: 'ACTIVE_WITH_AGENT',
    CLOSE_CONVERSATION: 'CLOSED',
  },
  WITH_ANALYST: {
    RETURN_TO_AGENT: 'ACTIVE_WITH_AGENT',
    CLOSE_CONVERSATION: 'CLOSED',
  },
  CLOSED: {
    REOPEN_CONVERSATION: 'ACTIVE_WITH_AGENT',
  },
};

export function transitionConversationStatus(
  current: ConversationStatus,
  action: ConversationTransitionAction
): {
  nextStatus: ConversationStatus;
  agentPaused: boolean;
} {
  const nextStatus = ALLOWED_TRANSITIONS[current]?.[action];
  if (!nextStatus) {
    throw new Error(
      `Transição de estado inválida: não é possível aplicar '${action}' a partir do estado '${current}'.`
    );
  }

  return {
    nextStatus,
    agentPaused: nextStatus === 'WAITING_ANALYST' || nextStatus === 'WITH_ANALYST',
  };
}

export function isAgentAllowedToRespond(
  status: ConversationStatus,
  messageCount: number,
  maxMessages: number = MAX_MESSAGES_PER_SESSION
): {
  allowed: boolean;
  reason?: string;
} {
  if (status === 'WAITING_ANALYST') {
    return {
      allowed: false,
      reason:
        'A conversa foi transferida e aguarda um analista. O agent está pausado até ser liberado.',
    };
  }

  if (status === 'WITH_ANALYST') {
    return {
      allowed: false,
      reason:
        'Um analista humano assumiu esta conversa. O agent permanece pausado enquanto o analista atende.',
    };
  }

  if (status === 'CLOSED') {
    return {
      allowed: false,
      reason: 'Esta conversa foi encerrada. Inicie um novo atendimento para continuar.',
    };
  }

  if (messageCount >= maxMessages) {
    return {
      allowed: false,
      reason: `Limite de ${maxMessages} mensagens por sessão atingido. Inicie uma nova sessão ou transfira para um analista.`,
    };
  }

  return { allowed: true };
}
