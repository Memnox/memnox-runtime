import {
  budgetCrossings,
  DAEMON_EVENT,
  DAY_MS,
  describeCrossing,
  LEDGER_SCAN_LIMIT,
  NOTICE_KIND,
  readBudgets,
  spendReport,
  type BudgetLevel,
  type DaemonEvent,
} from '@memnox/core';
import { withEvents } from '../event-store';

/** No agent owns a budget, so its notice names the machine's book rather than a session. */
const BUDGET_AGENT = 'memnox';

/**
 * Tells a person once when a budget passes the line they asked to be told at, and once when it
 * runs out, so the stop is never the first they hear of it. Levels are kept for the daemon's
 * life, which is what makes it once.
 */
export class BudgetWatch {
  private levels: Map<string, BudgetLevel> = new Map();

  constructor(private readonly home: string) {}

  async look(moment: string): Promise<DaemonEvent[]> {
    const budgets = await readBudgets(this.home);
    if (budgets.length === 0) return [];
    // A day is the widest window a budget counts over; a session budget needs a session and is told where it stops.
    const since = new Date(Date.parse(moment) - DAY_MS).toISOString();
    const events = await withEvents(this.home, (store) =>
      store.query({ since, limit: LEDGER_SCAN_LIMIT }),
    );
    const { crossings, levels } = budgetCrossings(
      spendReport(budgets, { events, now: moment }),
      this.levels,
    );
    this.levels = levels;
    return crossings.map((crossing) => ({
      kind: DAEMON_EVENT.NOTICE,
      subject: `ntc_budget_${crossing.spend.budget.name}_${crossing.level}_${Date.parse(moment).toString(36)}`,
      agent: BUDGET_AGENT,
      notice: NOTICE_KIND.BUDGET,
      summary: describeCrossing(crossing),
      at: moment,
    }));
  }
}
