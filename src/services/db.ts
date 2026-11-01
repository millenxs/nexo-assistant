import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSeedConversationsAndMessages,
  buildSeedTickets,
  SEED_ANALYSTS,
  SEED_EMPLOYEES,
  SEED_KNOWLEDGE_ARTICLES,
} from './seed-data';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDbPath(): string {
  if (process.env.SQLITE_DB_PATH) {
    return process.env.SQLITE_DB_PATH;
  }
  return path.join(process.cwd(), 'data', 'nexo.db');
}

export function getDb(customPath?: string): DatabaseSync {
  const targetPath = customPath || getDbPath();

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  initializeSchema(db);
  seedDatabaseIfEmpty(db);

  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function resetDbWithSeeds(customPath?: string): void {
  const db = getDb(customPath);
  db.exec(`
    DELETE FROM messages;
    DELETE FROM drafts;
    DELETE FROM conversations;
    DELETE FROM ticket_events;
    DELETE FROM tickets;
    DELETE FROM kb_articles;
    DELETE FROM analysts;
    DELETE FROM employees;
    DELETE FROM system_settings;
  `);
  seedDatabaseIfEmpty(db);
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      initials TEXT NOT NULL,
      department TEXT NOT NULL,
      role TEXT NOT NULL,
      os TEXT NOT NULL,
      avatar_bg TEXT NOT NULL,
      avatar_fg TEXT NOT NULL,
      password_changed_days_ago INTEGER NOT NULL DEFAULT 30,
      online INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS analysts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      initials TEXT NOT NULL,
      tier TEXT NOT NULL,
      online INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS kb_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      os_restriction_json TEXT
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      affected_scope TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      assigned_analyst_id TEXT,
      assigned_analyst_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      sla_due_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_events (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      employee_initials TEXT NOT NULL,
      employee_department TEXT NOT NULL,
      employee_avatar_bg TEXT NOT NULL,
      employee_avatar_fg TEXT NOT NULL,
      employee_online INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      assigned_analyst_id TEXT,
      assigned_analyst_name TEXT,
      active_ticket_number TEXT,
      unread_for_analyst INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      max_messages INTEGER NOT NULL DEFAULT 30,
      list_tag_label TEXT NOT NULL,
      list_tag_tone TEXT NOT NULL,
      handoff_summary_json TEXT,
      pending_context_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT,
      content TEXT NOT NULL,
      question_prompt TEXT,
      quick_options_json TEXT,
      ticket_selector_json TEXT,
      ticket_card_json TEXT,
      draft_card_json TEXT,
      decision_trace_json TEXT,
      system_icon TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      target_ticket_number TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      affected_scope TEXT NOT NULL,
      sla_due_label TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function seedDatabaseIfEmpty(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM employees').get() as { cnt: number };
  if (row && row.cnt > 0) {
    return;
  }

  const now = new Date();

  const insertEmployee = db.prepare(`
    INSERT INTO employees (
      id, name, email, initials, department, role, os, avatar_bg, avatar_fg, password_changed_days_ago, online
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const emp of SEED_EMPLOYEES) {
    insertEmployee.run(
      emp.id,
      emp.name,
      emp.email,
      emp.initials,
      emp.department,
      emp.role,
      emp.os,
      emp.avatarBg,
      emp.avatarFg,
      emp.passwordChangedDaysAgo,
      emp.online ? 1 : 0
    );
  }

  const insertAnalyst = db.prepare(`
    INSERT INTO analysts (id, name, email, initials, tier, online)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const an of SEED_ANALYSTS) {
    insertAnalyst.run(an.id, an.name, an.email, an.initials, an.tier, an.online ? 1 : 0);
  }

  const insertArticle = db.prepare(`
    INSERT INTO kb_articles (id, title, category, summary, content, keywords_json, os_restriction_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const art of SEED_KNOWLEDGE_ARTICLES) {
    insertArticle.run(
      art.id,
      art.title,
      art.category,
      art.summary,
      art.content,
      JSON.stringify(art.keywords),
      art.osRestriction ? JSON.stringify(art.osRestriction) : null
    );
  }

  const insertTicket = db.prepare(`
    INSERT INTO tickets (
      id, number, type, title, description, category, subcategory, priority, status,
      affected_scope, requester_id, requester_name, requester_email,
      assigned_analyst_id, assigned_analyst_name, created_at, updated_at, resolved_at, sla_due_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO ticket_events (id, ticket_number, type, description, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tickets = buildSeedTickets(now);
  for (const t of tickets) {
    insertTicket.run(
      t.id,
      t.number,
      t.type,
      t.title,
      t.description,
      t.category,
      t.subcategory ?? null,
      t.priority,
      t.status,
      t.affectedScope,
      t.requesterId,
      t.requesterName,
      t.requesterEmail,
      t.assignedAnalystId ?? null,
      t.assignedAnalystName ?? null,
      t.createdAt,
      t.updatedAt,
      t.resolvedAt ?? null,
      t.slaDueAt
    );

    for (const ev of t.events) {
      insertEvent.run(ev.id, ev.ticketNumber, ev.type, ev.description, ev.actor, ev.createdAt);
    }
  }

  const { conversations, messages } = buildSeedConversationsAndMessages(now);

  const insertConv = db.prepare(`
    INSERT INTO conversations (
      id, employee_id, employee_name, employee_email, employee_initials, employee_department,
      employee_avatar_bg, employee_avatar_fg, employee_online, status,
      assigned_analyst_id, assigned_analyst_name, active_ticket_number,
      unread_for_analyst, message_count, max_messages, list_tag_label, list_tag_tone,
      handoff_summary_json, pending_context_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of conversations) {
    insertConv.run(
      c.id,
      c.employeeId,
      c.employeeName,
      c.employeeEmail,
      c.employeeInitials,
      c.employeeDepartment,
      c.employeeAvatarBg,
      c.employeeAvatarFg,
      c.employeeOnline ? 1 : 0,
      c.status,
      c.assignedAnalystId ?? null,
      c.assignedAnalystName ?? null,
      c.activeTicketNumber ?? null,
      c.unreadForAnalyst,
      c.messageCount,
      c.maxMessages,
      c.listTagLabel,
      c.listTagTone,
      c.handoffSummary ? JSON.stringify(c.handoffSummary) : null,
      c.pendingContext ? JSON.stringify(c.pendingContext) : null,
      c.createdAt,
      c.updatedAt
    );
  }

  const insertMsg = db.prepare(`
    INSERT INTO messages (
      id, conversation_id, sender_type, sender_name, sender_role, content,
      question_prompt, quick_options_json, ticket_selector_json, ticket_card_json,
      draft_card_json, decision_trace_json, system_icon, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of messages) {
    insertMsg.run(
      m.id,
      m.conversationId,
      m.senderType,
      m.senderName,
      m.senderRole ?? null,
      m.content,
      m.questionPrompt ?? null,
      m.quickOptions ? JSON.stringify(m.quickOptions) : null,
      m.ticketSelector ? JSON.stringify(m.ticketSelector) : null,
      m.ticketCard ? JSON.stringify(m.ticketCard) : null,
      m.draftCard ? JSON.stringify(m.draftCard) : null,
      m.decisionTrace ? JSON.stringify(m.decisionTrace) : null,
      m.systemIcon ?? null,
      m.createdAt
    );
  }

  db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(
    'simulate_legacy_instability',
    process.env.SIMULATE_LEGACY_INSTABILITY === '1' ? '1' : '0'
  );
}
