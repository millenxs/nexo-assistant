import { KnowledgeArticle } from '@/domain/types';
import { getDb } from './db';

interface KbRow {
  id: string;
  title: string;
  category: KnowledgeArticle['category'];
  summary: string;
  content: string;
  keywords_json: string;
  os_restriction_json: string | null;
}

function mapRowToArticle(row: KbRow): KnowledgeArticle {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    summary: row.summary,
    content: row.content,
    keywords: JSON.parse(row.keywords_json) as string[],
    osRestriction: row.os_restriction_json
      ? (JSON.parse(row.os_restriction_json) as KnowledgeArticle['osRestriction'])
      : undefined,
  };
}

export class KnowledgeBaseService {
  getAllArticles(): KnowledgeArticle[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM kb_articles ORDER BY id ASC').all() as unknown as KbRow[];
    return rows.map(mapRowToArticle);
  }

  searchArticles(
    query: string,
    employeeOs?: 'Windows 10' | 'Windows 11' | 'macOS'
  ): {
    articles: Array<{
      article: KnowledgeArticle;
      score: number;
      solvesWithoutTicket: boolean;
      osEscalationReason?: string;
    }>;
  } {
    const normalizedQuery = query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const all = this.getAllArticles();
    const scored = all
      .map((article) => {
        let score = 0;
        for (const kw of article.keywords) {
          const normKw = kw
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          if (normalizedQuery.includes(normKw)) {
            score += normKw.length >= 5 ? 3 : 2;
          }
        }
        const normTitle = article.title
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        for (const word of normalizedQuery.split(/\s+/)) {
          if (word.length >= 3 && normTitle.includes(word)) {
            score += 1;
          }
        }

        let solvesWithoutTicket = score > 0;
        let osEscalationReason: string | undefined;

        if (article.osRestriction && employeeOs) {
          if (article.osRestriction.requiresTicketFor.includes(employeeOs)) {
            solvesWithoutTicket = false;
            osEscalationReason = article.osRestriction.escalationNote;
          }
        }

        // Artigo de equipamento home office orienta que é uma requisição (REQ), logo requer abertura de REQ
        if (article.id === 'kb-home-office-equipamentos') {
          solvesWithoutTicket = false;
        }

        return {
          article,
          score,
          solvesWithoutTicket,
          osEscalationReason,
        };
      })
      .filter((item) => item.score >= 2)
      .sort((a, b) => b.score - a.score);

    return { articles: scored.slice(0, 3) };
  }
}

export const kbService = new KnowledgeBaseService();
