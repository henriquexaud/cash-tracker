import { useState } from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import {
  budgetSeries,
  budgetStats,
  budgetTotal,
  formatMoney,
  monthLabel,
} from "../domain/finance";
import type { PageProps } from "../ui-types";
import { Chart } from "./Chart";

export function BudgetHistory({
  data,
  month,
  setMonth,
  actions,
}: Pick<PageProps, "data" | "month" | "setMonth" | "actions">) {
  const [year, setYear] = useState(month.slice(0, 4));
  const stats = budgetStats(data.budgets);
  const years = Array.from(
    new Set([
      month.slice(0, 4),
      ...data.budgets.map((budget) => budget.month.slice(0, 4)),
    ]),
  )
    .sort()
    .reverse();
  const filtered = [...data.budgets]
    .filter((budget) => year === "all" || budget.month.startsWith(`${year}-`))
    .sort((a, b) => b.month.localeCompare(a.month));
  const filteredStats = budgetStats(filtered);
  const points = budgetSeries(filtered);
  const periodLabel = year === "all" ? "todo o histórico" : year;

  function openBudget(selectedMonth: string) {
    setMonth(selectedMonth);
    actions.navigate("budget");
  }

  if (!data.budgets.length)
    return (
      <section className="panel">
        <div className="empty-state">
          <CalendarDays size={28} aria-hidden="true" />
          <h3>Nenhum orçamento registrado</h3>
          <p>Comece com a base da planilha ou crie seu orçamento do mês.</p>
          <button
            className="button primary"
            type="button"
            onClick={() => actions.navigate("budget")}
          >
            Abrir orçamento <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
    );

  return (
    <div className="budget-history">
      <section
        className="metrics-strip three"
        aria-label="Resumo de todos os orçamentos registrados"
      >
        <div className="metric">
          <span className="metric-label">Total previsto no histórico</span>
          <div className="metric-value">{formatMoney(stats.total)}</div>
          <span className="metric-detail">
            {data.budgets.length}{" "}
            {data.budgets.length === 1 ? "mês registrado" : "meses registrados"}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Fixos previstos</span>
          <div className="metric-value">{formatMoney(stats.fixed)}</div>
        </div>
        <div className="metric">
          <span className="metric-label">Variáveis previstos</span>
          <div className="metric-value">{formatMoney(stats.variable)}</div>
        </div>
      </section>

      <section className="panel history-chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Evolução dos orçamentos</h2>
            <span className="subtle">Gastos previstos · {periodLabel}</span>
          </div>
          <div className="heading-controls">
            <select
              aria-label="Filtrar histórico de orçamentos por ano"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="all">Todos os anos</option>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        {points.length ? (
          <Chart
            points={points}
            title={`Evolução dos gastos previstos nos orçamentos registrados em ${periodLabel}`}
            height={248}
          />
        ) : (
          <div className="empty-state">
            <p>Nenhum orçamento registrado em {year}.</p>
          </div>
        )}
      </section>

      <section className="panel history-records">
        <div className="panel-heading">
          <div>
            <h2>Orçamentos mensais</h2>
          </div>
          <button
            className="button secondary small"
            type="button"
            onClick={() => actions.navigate("budget")}
          >
            Abrir {monthLabel(month, true)}
          </button>
        </div>
        <div
          className="history-table"
          role="table"
          aria-label={`Orçamentos previstos em ${periodLabel}`}
        >
          <div className="history-row budget-history-row table-head" role="row">
            <span role="columnheader">Mês</span>
            <span role="columnheader">Gastos previstos</span>
            <span role="columnheader">Reserva planejada</span>
            <span role="columnheader" aria-label="Abrir orçamento" />
          </div>
          {filtered.map((budget) => (
            <div
              className="history-row budget-history-row"
              key={budget.month}
              role="row"
            >
              <div role="cell">
                <span className="calendar-icon">
                  <CalendarDays size={16} aria-hidden="true" />
                </span>
                <strong>{monthLabel(budget.month)}</strong>
              </div>
              <strong role="cell">
                {formatMoney(budgetTotal(budget.items))}
              </strong>
              <span role="cell">{formatMoney(budget.reservePlan)}</span>
              <div role="cell">
                <button
                  className="text-button"
                  type="button"
                  aria-label={`Abrir orçamento de ${monthLabel(budget.month)}`}
                  onClick={() => openBudget(budget.month)}
                >
                  Abrir orçamento
                </button>
              </div>
            </div>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            <CalendarDays size={27} aria-hidden="true" />
            <h3>Sem orçamentos neste período</h3>
            <p>Escolha outro ano ou crie um orçamento para este mês.</p>
            <button
              className="text-button"
              type="button"
              onClick={() => actions.navigate("budget")}
            >
              Abrir orçamento <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="budget-list-total">
          <span>
            {filtered.length}{" "}
            {filtered.length === 1 ? "orçamento" : "orçamentos"} · total
            previsto {year === "all" ? "no histórico" : `em ${year}`}
          </span>
          <strong>{formatMoney(filteredStats.total)}</strong>
        </div>
      </section>
    </div>
  );
}
