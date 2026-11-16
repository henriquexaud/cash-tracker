import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Landmark, ListFilter, Wallet, type LucideIcon } from "lucide-react";
import { budgetTotal, monthLabel, monthlySummary, shiftMonth, wealthStats } from "../domain/finance";
import { usePrivacy } from "../privacy";
import type { PageProps } from "../ui-types";

type DashboardProps = Pick<PageProps, "data" | "month" | "actions">;
const percentage = (value: number) =>
  `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function DashboardPlanning({ data, month, actions }: DashboardProps) {
  const { money, protect, hidden } = usePrivacy();
  const summary = monthlySummary(data, month);
  const wealth = wealthStats(data, month);
  const hasBudget = Boolean(summary.budget || data.budgetTemplate.length);
  const hasMovements = data.movements.some((entry) => entry.date.slice(0, 7) === month);
  if (!hasBudget && !hasMovements) return null;

  const fixed = budgetTotal(summary.budgetItems.filter((item) => item.kind === "fixed"));
  const variable = budgetTotal(summary.budgetItems.filter((item) => item.kind === "variable"));
  const fixedShare = summary.estimatedExpenses > 0 ? fixed / summary.estimatedExpenses * 100 : 0;
  const previousMonth = shiftMonth(month, -1);
  const previousBudget = data.budgets.find((budget) => budget.month === previousMonth);
  const expenseChange = summary.budget && previousBudget
    ? summary.expenses - budgetTotal(previousBudget.items)
    : null;
  const plan = summary.reservePlan;
  const savedShare = plan > 0 ? wealth.monthSaved / plan * 100 : 0;
  const progress = Math.max(0, Math.min(100, savedShare));

  return (
    <div className="dashboard-detail-grid">
      <section className="panel dashboard-planning" aria-labelledby="dashboard-budget-title">
        <div className="panel-heading">
          <div>
            <h2 id="dashboard-budget-title">Como os gastos se dividem</h2>
            <span className="subtle">{summary.budget ? "Estimativa para o mês selecionado" : hasBudget ? "Estimativa da base · ainda não confirmada no mês" : "Seu mês ainda não tem um orçamento"}</span>
          </div>
        </div>
        {hasBudget ? (
          <>
            <div className={`dashboard-expense-bar ${hidden ? "values-hidden" : ""}`} aria-hidden="true">
              {!hidden && summary.estimatedExpenses > 0 && (
                <><span style={{ width: `${fixedShare}%` }} /><span style={{ width: `${100 - fixedShare}%` }} /></>
              )}
            </div>
            <dl className="dashboard-budget-breakdown">
              <div><dt><i className="fixed" aria-hidden="true" />Fixos</dt><dd>{money(fixed)}</dd></div>
              <div><dt><i className="variable" aria-hidden="true" />Variáveis</dt><dd>{money(variable)}</dd></div>
            </dl>
            <p className="dashboard-context">
              {summary.estimatedExpenses === 0
                ? "Nenhum gasto previsto neste orçamento."
                : summary.salary && summary.salary.amount > 0
                  ? <>{protect(percentage(summary.estimatedExpenses / summary.salary.amount * 100))} do recebido vai para os gastos previstos.</>
                  : "Registre o salário para comparar os gastos com o recebido."}
            </p>
            {expenseChange !== null && (
              <p className="dashboard-budget-comparison">
                <span>Em relação a {monthLabel(previousMonth, true)}</span>
                <strong>{protect(expenseChange === 0 ? "Mesmo valor previsto" : `${money(Math.abs(expenseChange))} ${expenseChange > 0 ? "a mais" : "a menos"}`)}</strong>
              </p>
            )}
          </>
        ) : (
          <p className="dashboard-empty-copy">Adicione uma estimativa dos gastos para entender quanto pode sobrar.</p>
        )}
        <button type="button" className="panel-bottom-link" onClick={() => actions.navigate("budget")}>
          {hasBudget ? "Ver orçamento" : "Definir orçamento"}<ArrowRight size={16} />
        </button>
      </section>

      <section className="panel dashboard-saving" aria-labelledby="dashboard-saving-title">
        <div className="panel-heading">
          <div><h2 id="dashboard-saving-title">Reserva deste mês</h2><span className="subtle">Do planejado ao que foi guardado</span></div>
        </div>
        {plan > 0 ? (
          <>
            <div className="dashboard-saving-status">
              {wealth.monthSaved < 0 ? (
                <span className="status-badge warning"><CircleAlert size={14} aria-hidden="true" /><span>As retiradas superam os aportes</span></span>
              ) : wealth.monthSaved >= plan ? (
                <span className="status-badge success"><Check size={14} aria-hidden="true" /><span>Planejado alcançado</span></span>
              ) : (
                <span className="status-badge"><span>{protect(`${percentage(savedShare)} do planejado`)}</span></span>
              )}
              <span className="dashboard-saving-amount">{money(wealth.monthSaved)} <span>de {money(plan)}</span></span>
            </div>
            {hidden ? <div className="dashboard-progress values-hidden" aria-hidden="true" /> : (
              <div className="dashboard-progress" role="progressbar" aria-label="Progresso da reserva planejada" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
                aria-valuetext={wealth.monthSaved < 0 ? "Saldo guardado no mês negativo" : `${percentage(savedShare)} do planejado`}>
                <span style={{ width: `${progress}%` }} />
              </div>
            )}
            <p className="dashboard-context">Aportes menos retiradas. Saldo inicial e rendimentos ficam fora deste progresso.</p>
          </>
        ) : (
          <div className="dashboard-no-plan">
            <p>Quanto você pretende guardar?</p>
            <span>Defina um valor no orçamento e acompanhe o progresso por aqui.</span>
            <button type="button" className="text-button" onClick={actions.editReservePlan}>Planejar reserva <ArrowUpRight size={14} /></button>
          </div>
        )}
        {hasMovements && (
          <dl className="dashboard-saving-flows">
            <div><dt>Aportes</dt><dd>{money(wealth.monthContributed)}</dd></div>
            <div><dt>Retiradas</dt><dd>{money(wealth.monthWithdrawn)}</dd></div>
            <div><dt>Rendimentos</dt><dd>{money(wealth.monthReturns)}</dd></div>
          </dl>
        )}
      </section>
    </div>
  );
}

export function DashboardActivity({ data, month, actions }: DashboardProps) {
  const { money, protect, hidden } = usePrivacy();
  const movements = data.movements
    .filter((entry) => entry.date.slice(0, 7) === month)
    .sort((a, b) => b.date.localeCompare(a.date));
  const labels = { contribution: "Aporte", withdrawal: "Retirada", return: "Rendimento", opening: "Saldo inicial" };
  return (
    <section className="panel dashboard-activity" aria-labelledby="dashboard-activity-title">
      <div className="panel-heading">
        <div><h2 id="dashboard-activity-title">Movimentações do mês</h2><span className="subtle">{movements.length ? "Os últimos registros na sua reserva" : "Aportes, retiradas e rendimentos"}</span></div>
      </div>
      {movements.length ? (
        <ul className="dashboard-activity-list">
          {movements.slice(0, 3).map((movement) => {
            const date = movement.datePrecision === "month"
              ? monthLabel(month, true)
              : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${movement.date}T12:00:00`));
            const account = data.accounts.find((entry) => entry.id === movement.accountId);
            const Icon = movement.kind === "withdrawal" ? ArrowUpRight : movement.kind === "contribution" ? ArrowDownLeft : Wallet;
            return (
              <li key={movement.id}>
                <button type="button" onClick={() => actions.editMovement(movement)} aria-label={`Editar ${labels[movement.kind]} de ${date}`}>
                  <span className="dashboard-activity-icon"><Icon size={17} aria-hidden="true" /></span>
                  <span className="dashboard-activity-copy"><strong>{labels[movement.kind]}</strong><span>{date} · {protect(account?.name ?? "Local de reserva")}</span></span>
                  <span className={`dashboard-activity-amount ${!hidden && (movement.kind === "withdrawal" || movement.amount < 0) ? "negative" : ""}`}>
                    {movement.kind === "withdrawal" && !hidden ? "− " : ""}{money(movement.amount)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dashboard-activity-empty"><Wallet size={24} aria-hidden="true" /><p>Nenhuma movimentação neste mês.</p><span>Se você guardou ou retirou dinheiro, registre na Reserva.</span></div>
      )}
      <button type="button" className="panel-bottom-link" onClick={() => actions.navigate("wealth")}>
        Ver movimentações {movements.length > 3 ? `· ${movements.length} movimentações` : ""}<ArrowRight size={16} />
      </button>
    </section>
  );
}

type Step = { done: boolean; title: string; detail: string; action: string; icon: LucideIcon; run: () => void };

/** A new account starts with a short guide instead of a screen of dashes. */
export function DashboardFirstSteps({ data, month, actions }: DashboardProps) {
  const steps: Step[] = [
    {
      done: data.salaries.length > 0,
      title: "Registre o que recebeu",
      detail: "O salário do mês é a base para calcular quanto sobra.",
      action: "Adicionar salário",
      icon: Wallet,
      run: () => actions.editSalary(undefined, month),
    },
    {
      done: data.budgets.length > 0 || data.budgetTemplate.length > 0,
      title: "Estime os gastos do mês",
      detail: "Aluguel, mercado, transporte: uma estimativa já basta.",
      action: "Criar orçamento",
      icon: ListFilter,
      run: () => actions.navigate("budget"),
    },
    {
      done: data.accounts.length > 0,
      title: "Diga onde guarda dinheiro",
      detail: "Um local de reserva para acompanhar aportes e rendimentos.",
      action: "Adicionar local",
      icon: Landmark,
      run: actions.addAccount,
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length || data.movements.length > 0) return null;
  return (
    <section className="panel first-steps" aria-labelledby="first-steps-title">
      <div className="panel-heading">
        <div>
          <h2 id="first-steps-title">Primeiros passos</h2>
          <span className="subtle">Três registros rápidos para a visão geral ganhar vida.</span>
        </div>
        <span className="first-steps-count">{completed} de {steps.length}</span>
      </div>
      <ol className="first-steps-list">
        {steps.map((step) => {
          const Icon = step.done ? Check : step.icon;
          return (
            <li key={step.title} className={step.done ? "done" : ""}>
              <span className="first-steps-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="first-steps-copy">
                <strong>{step.title}</strong>
                <span>{step.done ? "Concluído" : step.detail}</span>
              </span>
              {!step.done && (
                <button type="button" className="button secondary small" onClick={step.run}>{step.action}</button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
