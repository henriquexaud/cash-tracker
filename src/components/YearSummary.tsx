import { CalendarDays } from "lucide-react";
import { Select } from "./Select";
import { useHistoryYear } from "./useHistoryYear";
import { usePrivacy } from "../privacy";
import { monthLabel, yearSummary } from "../domain/finance";
import type { PageProps } from "../ui-types";

const percent = (value: number) =>
  `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** One year at a glance: what came in, what was planned and what was actually saved. */
export function YearSummary({ data, month }: Pick<PageProps, "data" | "month">) {
  const { money, protect, hidden } = usePrivacy();
  const { year: selected, setYear, years } = useHistoryYear(month, [
    ...data.salaries.map((row) => row.month),
    ...data.budgets.map((row) => row.month),
    ...data.movements.map((row) => row.date.slice(0, 7)),
  ]);
  const year = selected === "all" ? month.slice(0, 4) : selected;
  const summary = yearSummary(data, year);
  const rows = [...summary.months].reverse();

  return (
    <div className="year-summary">
      <section className="metrics-strip three" aria-label={`Resumo de ${year}`}>
        <div className="metric">
          <div className="metric-label">Recebido em {year}</div>
          <div className="metric-value">{money(summary.received)}</div>
          <div className="metric-detail">
            Gastos previstos: {money(summary.expenses)}
          </div>
        </div>
        <div className="metric metric-accent">
          <div className="metric-label">Guardado em {year}</div>
          <div className={`metric-value ${!hidden && summary.saved < 0 ? "negative" : ""}`}>
            {money(summary.saved)}
          </div>
          <div className="metric-detail">
            {summary.rate === null
              ? "Aportes menos retiradas"
              : protect(`${percent(summary.rate)} do recebido`)}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Rendimentos em {year}</div>
          <div className={`metric-value ${!hidden && summary.returns < 0 ? "negative" : ""}`}>
            {money(summary.returns)}
          </div>
          <div className="metric-detail">Não entram no guardado</div>
        </div>
      </section>

      <section className="panel history-records">
        <div className="panel-heading">
          <div>
            <h2>Mês a mês</h2>
            <span className="subtle">Guardado = aportes menos retiradas</span>
          </div>
          <div className="heading-controls">
            <Select
              aria-label="Ano do resumo"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {rows.length ? (
          <div className="history-table" role="table" aria-label={`Resumo mensal de ${year}`}>
            <div className="history-row year-row table-head" role="row">
              <span role="columnheader">Mês</span>
              <span role="columnheader">Guardado</span>
              <span role="columnheader">Recebido</span>
              <span role="columnheader">Do recebido</span>
            </div>
            {rows.map((row) => (
              <div className="history-row year-row" key={row.month} role="row">
                <div role="cell">
                  <span className="calendar-icon">
                    <CalendarDays size={16} aria-hidden="true" />
                  </span>
                  <strong>{monthLabel(row.month)}</strong>
                </div>
                <strong role="cell" className={!hidden && row.saved < 0 ? "negative" : ""}>
                  {money(row.saved)}
                </strong>
                <span role="cell">{row.salary === null ? "—" : money(row.salary)}</span>
                <span role="cell">{row.rate === null ? "—" : protect(percent(row.rate))}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <CalendarDays size={27} aria-hidden="true" />
            <h3>Nada registrado em {year}</h3>
            <p>Salários, orçamentos e movimentações do ano aparecem aqui.</p>
          </div>
        )}
      </section>
    </div>
  );
}
