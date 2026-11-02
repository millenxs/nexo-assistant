import fs from 'node:fs';
import type { DatabaseLike, PreparedStatementLike } from './db';

type Row = Record<string, unknown>;

interface TableStore {
  employees: Row[];
  analysts: Row[];
  kb_articles: Row[];
  tickets: Row[];
  ticket_events: Row[];
  conversations: Row[];
  messages: Row[];
  drafts: Row[];
  system_settings: Row[];
  sessions: Row[];
  revoked_sessions: Row[];
}

function emptyStore(): TableStore {
  return {
    employees: [],
    analysts: [],
    kb_articles: [],
    tickets: [],
    ticket_events: [],
    conversations: [],
    messages: [],
    drafts: [],
    system_settings: [],
    sessions: [],
    revoked_sessions: [],
  };
}

/**
 * Fallback em JavaScript puro compatível com a interface de `DatabaseSync`
 * para ambientes de deploy serverless que rodem Node 18/20 (sem `node:sqlite`).
 */
export class JsonFallbackDatabase implements DatabaseLike {
  private store: TableStore = emptyStore();
  private filePath: string | null = null;

  constructor(targetPath: string) {
    if (targetPath && targetPath !== ':memory:') {
      this.filePath = targetPath.replace(/\.db$/, '.json');
      try {
        if (fs.existsSync(this.filePath)) {
          const raw = fs.readFileSync(this.filePath, 'utf8');
          const parsed = JSON.parse(raw) as Partial<TableStore>;
          this.store = { ...emptyStore(), ...parsed };
        }
      } catch {
        this.store = emptyStore();
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.store), 'utf8');
    } catch {
      // ignore read-only fs errors
    }
  }

  exec(sql: string): void {
    const normalized = sql.toLowerCase();
    for (const table of Object.keys(this.store) as Array<keyof TableStore>) {
      if (normalized.includes(`delete from ${table}`)) {
        this.store[table] = [];
      }
    }
    this.persist();
  }

  prepare(sql: string): PreparedStatementLike {
    const q = sql.replace(/\s+/g, ' ').trim();
    const qLower = q.toLowerCase();

    return {
      get: (...params: unknown[]): unknown => {
        if (qLower.startsWith('select count(*) as cnt from ')) {
          const table = qLower
            .replace('select count(*) as cnt from ', '')
            .trim() as keyof TableStore;
          return { cnt: (this.store[table] ?? []).length };
        }

        const allRows = this.prepare(sql).all(...params);
        return allRows[0];
      },

      all: (...params: unknown[]): unknown[] => {
        if (qLower.includes('from employees')) {
          const rows = [...this.store.employees];
          if (qLower.includes('where lower(email) = lower(?)')) {
            const email = String(params[0] ?? '').toLowerCase();
            return rows.filter((r) => String(r.email).toLowerCase() === email);
          }
          if (qLower.includes('where id = ?')) {
            return rows.filter((r) => r.id === params[0]);
          }
          return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }

        if (qLower.includes('from analysts')) {
          const rows = [...this.store.analysts];
          if (qLower.includes('where id = ? or lower(email) = lower(?)')) {
            const id = String(params[0] ?? '');
            const email = String(params[1] ?? '').toLowerCase();
            return rows.filter(
              (r) => r.id === id || String(r.email).toLowerCase() === email
            );
          }
          return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }

        if (qLower.includes('from kb_articles')) {
          return [...this.store.kb_articles];
        }

        if (qLower.includes('from system_settings')) {
          return this.store.system_settings.filter((r) => r.key === params[0]);
        }

        if (qLower.includes('from revoked_sessions')) {
          return this.store.revoked_sessions.filter((r) => r.token === params[0]);
        }

        if (qLower.includes('from sessions')) {
          return this.store.sessions.filter((r) => r.token === params[0]);
        }

        if (qLower.includes('from ticket_events')) {
          return this.store.ticket_events
            .filter((r) => r.ticket_number === params[0])
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        }

        if (qLower.includes('from tickets')) {
          const rows = [...this.store.tickets];
          if (qLower.includes('where requester_id = ?')) {
            return rows
              .filter((r) => r.requester_id === params[0])
              .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
          }
          if (qLower.includes('where upper(number) = upper(?) and requester_id = ?')) {
            const num = String(params[0] ?? '').toUpperCase();
            return rows.filter(
              (r) => String(r.number).toUpperCase() === num && r.requester_id === params[1]
            );
          }
          if (qLower.includes('where upper(number) = ?') || qLower.includes('where number = ?')) {
            const num = String(params[0] ?? '').toUpperCase();
            return rows.filter((r) => String(r.number).toUpperCase() === num);
          }
          return rows;
        }

        if (qLower.includes('from drafts')) {
          const rows = [...this.store.drafts];
          if (qLower.includes('where id = ? or upper(code) = upper(?)')) {
            const id = String(params[0] ?? '');
            const code = String(params[1] ?? '').toUpperCase();
            return rows.filter(
              (r) => r.id === id || String(r.code).toUpperCase() === code
            );
          }
          if (qLower.includes("where conversation_id = ? and status = 'pending_confirmation'")) {
            return rows
              .filter(
                (r) =>
                  r.conversation_id === params[0] &&
                  r.status === 'PENDING_CONFIRMATION'
              )
              .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          }
          return rows;
        }

        if (qLower.includes('from conversations')) {
          const rows = [...this.store.conversations];
          if (qLower.includes('where employee_id = ?')) {
            return rows
              .filter((r) => r.employee_id === params[0])
              .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
          }
          if (qLower.includes('where id = ?')) {
            return rows.filter((r) => r.id === params[0]);
          }
          return rows.sort((a, b) =>
            String(b.updated_at).localeCompare(String(a.updated_at))
          );
        }

        if (qLower.includes('from messages')) {
          const rows = [...this.store.messages];
          if (qLower.includes('where id = ?')) {
            return rows.filter((r) => r.id === params[0]);
          }
          if (qLower.includes('and draft_card_json is not null')) {
            return rows.filter(
              (r) => r.conversation_id === params[0] && r.draft_card_json != null
            );
          }
          if (qLower.includes("and sender_type != 'system'")) {
            return rows
              .filter(
                (r) => r.conversation_id === params[0] && r.sender_type !== 'system'
              )
              .reverse();
          }
          if (qLower.includes('where conversation_id = ?')) {
            return rows.filter((r) => r.conversation_id === params[0]);
          }
          return rows;
        }

        return [];
      },

      run: (...params: unknown[]): { changes?: number } => {
        if (qLower.startsWith('insert into employees')) {
          const [
            id,
            name,
            email,
            initials,
            department,
            role,
            os,
            avatar_bg,
            avatar_fg,
            password_changed_days_ago,
            online,
          ] = params;
          this.store.employees.push({
            id,
            name,
            email,
            initials,
            department,
            role,
            os,
            avatar_bg,
            avatar_fg,
            password_changed_days_ago,
            online,
          });
        } else if (qLower.startsWith('insert into analysts')) {
          const [id, name, email, initials, tier, online] = params;
          this.store.analysts.push({ id, name, email, initials, tier, online });
        } else if (qLower.startsWith('insert into kb_articles')) {
          const [
            id,
            title,
            category,
            summary,
            content,
            keywords_json,
            os_restriction_json,
          ] = params;
          this.store.kb_articles.push({
            id,
            title,
            category,
            summary,
            content,
            keywords_json,
            os_restriction_json,
          });
        } else if (qLower.startsWith('insert into tickets')) {
          const hasFixedStatus = qLower.includes("'aguardando analista'");
          if (hasFixedStatus) {
            const [
              id,
              number,
              type,
              title,
              description,
              category,
              priority,
              affected_scope,
              requester_id,
              requester_name,
              requester_email,
              created_at,
              updated_at,
              sla_due_at,
            ] = params;
            this.store.tickets.push({
              id,
              number,
              type,
              title,
              description,
              category,
              subcategory: null,
              priority,
              status: 'Aguardando analista',
              affected_scope,
              requester_id,
              requester_name,
              requester_email,
              assigned_analyst_id: null,
              assigned_analyst_name: null,
              created_at,
              updated_at,
              resolved_at: null,
              sla_due_at,
            });
          } else {
            const [
              id,
              number,
              type,
              title,
              description,
              category,
              subcategory,
              priority,
              status,
              affected_scope,
              requester_id,
              requester_name,
              requester_email,
              assigned_analyst_id,
              assigned_analyst_name,
              created_at,
              updated_at,
              resolved_at,
              sla_due_at,
            ] = params;
            this.store.tickets.push({
              id,
              number,
              type,
              title,
              description,
              category,
              subcategory,
              priority,
              status,
              affected_scope,
              requester_id,
              requester_name,
              requester_email,
              assigned_analyst_id,
              assigned_analyst_name,
              created_at,
              updated_at,
              resolved_at,
              sla_due_at,
            });
          }
        } else if (qLower.startsWith('insert into ticket_events')) {
          if (qLower.includes("'created'")) {
            const [id, ticket_number, description, actor, created_at] = params;
            this.store.ticket_events.push({
              id,
              ticket_number,
              type: 'created',
              description,
              actor,
              created_at,
            });
          } else if (qLower.includes("'transferred'")) {
            const [id, ticket_number, description, actor, created_at] = params;
            this.store.ticket_events.push({
              id,
              ticket_number,
              type: 'transferred',
              description,
              actor,
              created_at,
            });
          } else if (qLower.includes("'taken_over'")) {
            const [id, ticket_number, description, actor, created_at] = params;
            this.store.ticket_events.push({
              id,
              ticket_number,
              type: 'taken_over',
              description,
              actor,
              created_at,
            });
          } else {
            const [id, ticket_number, type, description, actor, created_at] = params;
            this.store.ticket_events.push({
              id,
              ticket_number,
              type,
              description,
              actor,
              created_at,
            });
          }
        } else if (qLower.startsWith('insert into conversations')) {
          if (params.length === 10) {
            const [
              id,
              employee_id,
              employee_name,
              employee_email,
              employee_initials,
              employee_department,
              employee_avatar_bg,
              employee_avatar_fg,
              created_at,
              updated_at,
            ] = params;
            this.store.conversations.push({
              id,
              employee_id,
              employee_name,
              employee_email,
              employee_initials,
              employee_department,
              employee_avatar_bg,
              employee_avatar_fg,
              employee_online: 1,
              status: 'ACTIVE_WITH_AGENT',
              assigned_analyst_id: null,
              assigned_analyst_name: null,
              active_ticket_number: null,
              unread_for_analyst: 0,
              message_count: 0,
              max_messages: 30,
              list_tag_label: 'Agent atendendo',
              list_tag_tone: 'success',
              handoff_summary_json: null,
              pending_context_json: null,
              created_at,
              updated_at,
            });
          } else {
            const [
              id,
              employee_id,
              employee_name,
              employee_email,
              employee_initials,
              employee_department,
              employee_avatar_bg,
              employee_avatar_fg,
              employee_online,
              status,
              assigned_analyst_id,
              assigned_analyst_name,
              active_ticket_number,
              unread_for_analyst,
              message_count,
              max_messages,
              list_tag_label,
              list_tag_tone,
              handoff_summary_json,
              pending_context_json,
              created_at,
              updated_at,
            ] = params;
            this.store.conversations.push({
              id,
              employee_id,
              employee_name,
              employee_email,
              employee_initials,
              employee_department,
              employee_avatar_bg,
              employee_avatar_fg,
              employee_online,
              status,
              assigned_analyst_id,
              assigned_analyst_name,
              active_ticket_number,
              unread_for_analyst,
              message_count,
              max_messages,
              list_tag_label,
              list_tag_tone,
              handoff_summary_json,
              pending_context_json,
              created_at,
              updated_at,
            });
          }
        } else if (qLower.startsWith('insert into messages')) {
          const [
            id,
            conversation_id,
            sender_type,
            sender_name,
            sender_role,
            content,
            question_prompt,
            quick_options_json,
            ticket_selector_json,
            ticket_card_json,
            draft_card_json,
            decision_trace_json,
            system_icon,
            created_at,
          ] = params;
          this.store.messages.push({
            id,
            conversation_id,
            sender_type,
            sender_name,
            sender_role,
            content,
            question_prompt,
            quick_options_json,
            ticket_selector_json,
            ticket_card_json,
            draft_card_json,
            decision_trace_json,
            system_icon,
            created_at,
          });
        } else if (qLower.startsWith('insert into drafts')) {
          const [
            id,
            code,
            conversation_id,
            requester_id,
            operation,
            target_ticket_number,
            type,
            title,
            description,
            category,
            priority,
            affected_scope,
            sla_due_label,
            created_at,
          ] = params;
          this.store.drafts.push({
            id,
            code,
            conversation_id,
            requester_id,
            operation,
            target_ticket_number,
            type,
            title,
            description,
            category,
            priority,
            affected_scope,
            sla_due_label,
            status: 'PENDING_CONFIRMATION',
            created_at,
          });
        } else if (qLower.includes('into system_settings')) {
          const [key, value] = params;
          this.store.system_settings = this.store.system_settings.filter(
            (r) => r.key !== key
          );
          this.store.system_settings.push({ key, value });
        } else if (qLower.includes('into sessions')) {
          const [
            token,
            user_id,
            role,
            user_email,
            user_name,
            created_at,
            expires_at,
          ] = params;
          this.store.sessions = this.store.sessions.filter((r) => r.token !== token);
          this.store.sessions.push({
            token,
            user_id,
            role,
            user_email,
            user_name,
            created_at,
            expires_at,
          });
        } else if (qLower.includes('into revoked_sessions')) {
          const [token, revoked_at] = params;
          this.store.revoked_sessions = this.store.revoked_sessions.filter(
            (r) => r.token !== token
          );
          this.store.revoked_sessions.push({ token, revoked_at });
        } else if (qLower.startsWith('delete from sessions where token = ?')) {
          this.store.sessions = this.store.sessions.filter((r) => r.token !== params[0]);
        } else if (qLower.startsWith('delete from messages where conversation_id = ?')) {
          this.store.messages = this.store.messages.filter(
            (r) => r.conversation_id !== params[0]
          );
        } else if (qLower.startsWith('delete from drafts where conversation_id = ?')) {
          this.store.drafts = this.store.drafts.filter(
            (r) => r.conversation_id !== params[0]
          );
        } else if (qLower.startsWith('delete from conversations where id = ?')) {
          this.store.conversations = this.store.conversations.filter(
            (r) => r.id !== params[0]
          );
        } else if (qLower.startsWith('update drafts')) {
          if (qLower.includes("set status = 'cancelled' where conversation_id = ?")) {
            for (const d of this.store.drafts) {
              if (
                d.conversation_id === params[0] &&
                d.status === 'PENDING_CONFIRMATION'
              ) {
                d.status = 'CANCELLED';
              }
            }
          } else if (qLower.includes("set status = 'cancelled' where id = ?")) {
            for (const d of this.store.drafts) {
              if (d.id === params[0]) d.status = 'CANCELLED';
            }
          } else if (qLower.includes("set status = 'confirmed' where id = ?")) {
            for (const d of this.store.drafts) {
              if (d.id === params[0]) d.status = 'CONFIRMED';
            }
          } else {
            const [
              type,
              title,
              description,
              category,
              priority,
              affected_scope,
              sla_due_label,
              id,
            ] = params;
            for (const d of this.store.drafts) {
              if (d.id === id) {
                d.type = type;
                d.title = title;
                d.description = description;
                d.category = category;
                d.priority = priority;
                d.affected_scope = affected_scope;
                d.sla_due_label = sla_due_label;
              }
            }
          }
        } else if (qLower.startsWith('update messages set draft_card_json = ? where id = ?')) {
          for (const m of this.store.messages) {
            if (m.id === params[1]) m.draft_card_json = params[0];
          }
        } else if (qLower.startsWith('update tickets')) {
          if (qLower.includes("set status = 'em atendimento'")) {
            const [assigned_analyst_id, assigned_analyst_name, updated_at, number] =
              params;
            for (const t of this.store.tickets) {
              if (t.number === number) {
                t.status = 'Em atendimento';
                t.assigned_analyst_id = assigned_analyst_id;
                t.assigned_analyst_name = assigned_analyst_name;
                t.updated_at = updated_at;
              }
            }
          } else {
            const [
              description,
              priority,
              affected_scope,
              status,
              updated_at,
              sla_due_at,
              number,
            ] = params;
            for (const t of this.store.tickets) {
              if (t.number === number) {
                t.description = description;
                t.priority = priority;
                t.affected_scope = affected_scope;
                t.status = status;
                t.resolved_at = null;
                t.updated_at = updated_at;
                t.sla_due_at = sla_due_at;
              }
            }
          }
        } else if (qLower.startsWith('update conversations')) {
          if (qLower.includes('set message_count = message_count + 1')) {
            const [updated_at, id] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.message_count = Number(c.message_count ?? 0) + 1;
                c.updated_at = updated_at;
              }
            }
          } else if (qLower.includes('set updated_at = ? where id = ?')) {
            const [updated_at, id] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) c.updated_at = updated_at;
            }
          } else if (
            qLower.includes(
              'set pending_context_json = ?, active_ticket_number = ?, updated_at = ? where id = ?'
            )
          ) {
            const [pending_context_json, active_ticket_number, updated_at, id] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.pending_context_json = pending_context_json;
                c.active_ticket_number = active_ticket_number;
                c.updated_at = updated_at;
              }
            }
          } else if (
            qLower.includes('set pending_context_json = ?, updated_at = ? where id = ?')
          ) {
            const [pending_context_json, updated_at, id] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.pending_context_json = pending_context_json;
                c.updated_at = updated_at;
              }
            }
          } else if (qLower.includes('handoff_summary_json = ?')) {
            const [
              status,
              handoff_summary_json,
              active_ticket_number,
              list_tag_label,
              list_tag_tone,
              updated_at,
              id,
            ] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.status = status;
                c.handoff_summary_json = handoff_summary_json;
                if (active_ticket_number) c.active_ticket_number = active_ticket_number;
                c.unread_for_analyst = Number(c.unread_for_analyst ?? 0) + 1;
                c.list_tag_label = list_tag_label;
                c.list_tag_tone = list_tag_tone;
                c.pending_context_json = null;
                c.updated_at = updated_at;
              }
            }
          } else if (qLower.includes("list_tag_label = 'você está atendendo'")) {
            const [status, assigned_analyst_id, assigned_analyst_name, updated_at, id] =
              params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.status = status;
                c.assigned_analyst_id = assigned_analyst_id;
                c.assigned_analyst_name = assigned_analyst_name;
                c.unread_for_analyst = 0;
                c.list_tag_label = 'Você está atendendo';
                c.list_tag_tone = 'primary';
                c.updated_at = updated_at;
              }
            }
          } else if (qLower.includes("list_tag_label = 'agent atendendo'")) {
            const [status, updated_at, id] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.status = status;
                c.assigned_analyst_id = null;
                c.assigned_analyst_name = null;
                c.unread_for_analyst = 0;
                c.list_tag_label = 'Agent atendendo';
                c.list_tag_tone = 'success';
                c.updated_at = updated_at;
              }
            }
          } else if (qLower.includes("list_tag_label = 'encerrada pelo analista'")) {
            const [status, updated_at, id] = params;
            for (const c of this.store.conversations) {
              if (c.id === id) {
                c.status = status;
                c.unread_for_analyst = 0;
                c.list_tag_label = 'Encerrada pelo analista';
                c.list_tag_tone = 'neutral';
                c.updated_at = updated_at;
              }
            }
          }
        }

        this.persist();
        return { changes: 1 };
      },
    };
  }
}
