import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  Dumbbell,
  HeartPulse,
  House,
  Info,
  Laptop,
  Plus,
  Palette,
  ShieldCheck,
  ShoppingBasket,
  Smartphone,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  Pencil,
  Car,
  Play,
  Landmark,
} from "lucide-react";
import {
  accountBalance,
  budgetTotal,
  monthLabel,
  monthlySummary,
  salarySeries,
  salaryStats,
  shiftMonth,
  wealthSeries,
  wealthStats,
} from "./domain/finance";
import type { BudgetItem, Movement, MovementKind } from "./domain/types";
import { usePrivacy } from "./privacy";
import { Select } from "./components/Select";
import { Chart } from "./components/Chart";
import { BudgetHistory } from "./components/BudgetHistory";
import { DashboardActivity, DashboardPlanning } from "./components/DashboardDetails";
import { ThemePicker } from "./components/ThemePicker";
import { useInstalledApp } from "./components/InstallGuide";
import type { PageProps } from "./ui-types";

const percent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const freq = { monthly: "mês", weekly: "semana", daily: "dia" };
const movementLabels: Record<MovementKind, string> = {
  contribution: "Aporte",
  withdrawal: "Retirada",
  return: "Rendimento",
  opening: "Saldo inicial",
};
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
const movementDateLabel = (movement: Movement) =>
  movement.datePrecision === "month"
    ? monthLabel(movement.date.slice(0, 7))
    : dateLabel(movement.date);
function CategoryIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  const Icon = normalized.includes("alimenta")
    ? Utensils
    : normalized.includes("saúde")
      ? HeartPulse
      : normalized.includes("mercado")
        ? ShoppingBasket
        : normalized.includes("uber")
          ? Car
          : normalized.includes("condom")
            ? Building2
            : normalized.includes("academia")
              ? Dumbbell
              : normalized.includes("luz")
                ? Zap
                : normalized.includes("celular")
                  ? Smartphone
                  : normalized.includes("internet")
                    ? Wifi
                    : normalized.includes("icloud")
                      ? Cloud
                      : normalized.includes("youtube")
                        ? Play
                        : normalized.includes("chatgpt")
                          ? Laptop
                          : House;
  return <Icon size={18} strokeWidth={1.7} />;
}
function BudgetRow({
  item,
  index,
  onEdit,
  onRemove,
}: {
  item: BudgetItem;
  index: number;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { money: formatMoney } = usePrivacy();
  return (
    <div className="budget-row">
      <span className={`category-icon color-${index % 4}`}>
        <CategoryIcon name={item.name} />
      </span>
      <div className="budget-row-main">
        <strong>{item.name}</strong>
        {(item.frequency !== "monthly" || item.factor !== 1) && (
          <span>
            {formatMoney(item.unitAmount)} × {item.factor} ·{" "}
            {freq[item.frequency]}
          </span>
        )}
      </div>
      <div className="budget-row-value">
        <strong>{formatMoney(item.unitAmount * item.factor)}</strong>
        {onEdit && (
          <span className="row-type">
            {item.kind === "fixed" ? "Fixo" : "Variável"}
          </span>
        )}
      </div>
      {onEdit && (
        <div className="row-actions">
          <button
            className="icon-button"
            onClick={onEdit}
            aria-label={`Editar ${item.name}`}
          >
            <Pencil size={15} />
          </button>
          {onRemove && (
            <button
              className="icon-button muted"
              onClick={onRemove}
              aria-label={`Excluir ${item.name}`}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  accent = false,
  onClick,
  actionLabel = "Editar",
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
  onClick?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className={`metric ${accent ? "metric-accent" : ""}`}>
      <div className="metric-label">{label}</div>
      <div
        className={`metric-value ${value.startsWith("-") ? "negative" : ""}`}
      >
        {value}
      </div>
      {(detail || onClick) && (
        <div className="metric-detail">
          {detail}
          {onClick && (
            <button className="text-button" onClick={onClick}>
              {actionLabel} <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function ChartRange({
  value,
  set,
}: {
  value: number;
  set: (n: number) => void;
}) {
  return (
    <div className="segmented-control" aria-label="Período do gráfico">
      {[
        { value: 12, label: "1 ano" },
        { value: 36, label: "3 anos" },
        { value: 0, label: "Tudo" },
      ].map((item) => (
        <button
          key={item.value}
          onClick={() => set(item.value)}
          className={value === item.value ? "selected" : ""}
          aria-pressed={value === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardPage({ data, month, actions }: PageProps) {
  const { money: formatMoney, hidden } = usePrivacy();
  const stats = salaryStats(data.salaries);
  const summary = monthlySummary(data, month);
  const wealth = wealthStats(data, month);
  const confirmed =
    data.movements.length > 0 || data.legacy.status !== "pending";
  const hasBase = data.budgetTemplate.length > 0;
  const cost = summary.estimatedExpenses;
  const free = summary.estimatedFree;
  return (
    <div className="dashboard-content">
      <section className="metrics-strip three" aria-label="Resumo do mês">
        <Metric
          label="Recebido no mês"
          value={summary.salary ? formatMoney(summary.salary.amount) : "—"}
          detail={summary.salary ? undefined : "Ainda não registrado"}
          onClick={() => actions.editSalary(summary.salary ?? undefined)}
          actionLabel={summary.salary ? "Editar salário" : "Registrar salário"}
        />
        <Metric
          label="Gastos aproximados"
          value={summary.budget || hasBase ? formatMoney(cost) : "—"}
          detail={
            summary.budget
              ? undefined
              : hasBase
                ? "Base da planilha · não confirmada no mês"
                : "Adicione os gastos previstos"
          }
          onClick={() => actions.navigate("budget")}
          actionLabel={summary.budget ? "Ajustar gastos" : "Definir orçamento"}
        />
        <Metric
          label="Guardado no mês"
          value={formatMoney(wealth.monthSaved)}
          detail={
            data.movements.length
              ? "Aportes menos retiradas"
              : "Registre o que guardou de fato"
          }
          onClick={() => actions.editMovement(undefined, "contribution")}
          actionLabel="Registrar aporte"
          accent
        />
      </section>
      <div className="monthly-remainder dashboard-remainder">
        <span>
          {summary.budget || !hasBase
            ? "Livre previsto"
            : "Livre estimado com a base"}
          <strong className={!hidden && free !== null && free < 0 ? "negative" : ""}>
            {free === null || (!summary.budget && !hasBase)
              ? "—"
              : formatMoney(free)}
          </strong>
        </span>
        <span className="subtle">
          {free === null
            ? "Registre o salário para calcular."
            : !summary.budget && !hasBase
              ? "Adicione os gastos para calcular a estimativa."
              : summary.reservePlan
                ? `Após gastos e ${formatMoney(summary.reservePlan)} de reserva planejada.`
                : "Após os gastos aproximados."}
        </span>
      </div>
      <DashboardPlanning data={data} month={month} actions={actions} />
      {(stats.count > 0 ||
        data.accounts.length > 0 ||
        data.legacy.status !== "none") && (
        <div className="dashboard-detail-grid">
          <div className="panel dashboard-history-panel">
            <section className="dashboard-total">
              <h2>Recebido no histórico</h2>
              <div className="lifetime-amount">{formatMoney(stats.total)}</div>
              <p className="subtle">
                {stats.count} {stats.count === 1 ? "mês registrado" : "meses registrados"}
                {stats.first && ` · desde ${monthLabel(stats.first.month)}`}
              </p>
              <button
                className="panel-bottom-link"
                onClick={() => actions.navigate("history")}
              >
                Ver histórico <ArrowRight size={16} />
              </button>
            </section>
            <section className="dashboard-total">
              <h2>Saldo guardado</h2>
              <div className="lifetime-amount">
                {confirmed ? formatMoney(wealth.total) : "A confirmar"}
              </div>
              <p className="subtle">
                {confirmed
                  ? "Saldo inicial + aportes + rendimentos − retiradas."
                  : "Revise o saldo da planilha na tela Reserva."}
              </p>
              <button
                className="panel-bottom-link"
                onClick={() => actions.navigate("wealth")}
              >
                Ver reserva <ArrowRight size={16} />
              </button>
            </section>
          </div>
          <DashboardActivity data={data} month={month} actions={actions} />
        </div>
      )}
    </div>
  );
}

export function BudgetPage({ data, month, actions }: PageProps) {
  const { money: formatMoney, hidden, protect } = usePrivacy();
  const [filter, setFilter] = useState("all");
  const summary = monthlySummary(data, month);
  const items = summary.budgetItems;
  const cost = summary.estimatedExpenses;
  const previous = data.budgets.find((b) => b.month === shiftMonth(month, -1));
  const filtered = items
    .filter((i) => filter === "all" || i.kind === filter)
    .sort((a, b) => b.unitAmount * b.factor - a.unitAmount * a.factor);
  return (
    <>
      {!summary.budget && (previous || data.budgetTemplate.length > 0) && (
        <div className="inline-notice">
          <Info size={18} />
          <span>
            {previous
              ? "Reaproveite os gastos do mês anterior e ajuste o que mudou."
              : "Os valores abaixo são da base da planilha. Confirme ou ajuste para este mês."}
          </span>
          <button
            className="text-button"
            onClick={() =>
              actions.startBudget(previous ? "previous" : "template")
            }
          >
            {previous ? "Copiar mês anterior" : "Usar base neste mês"}{" "}
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      <section className="metrics-strip two">
        <Metric
          label="Gastos aproximados"
          value={formatMoney(cost)}
          detail={`${items.length} itens`}
        />
        <Metric
          label="Livre previsto"
          value={
            summary.estimatedFree === null ||
            (!summary.budget && !data.budgetTemplate.length)
              ? "—"
              : formatMoney(summary.estimatedFree)
          }
          detail={
            !summary.salary
              ? "Registre o salário para calcular"
              : !summary.budget && data.budgetTemplate.length > 0
                ? "Estimativa com a base da planilha"
                : !summary.budget
                  ? "Adicione os gastos para calcular"
                  : summary.reservePlan
                    ? "Após gastos e reserva planejada"
                    : "Após os gastos aproximados"
          }
          onClick={!summary.salary ? () => actions.editSalary() : undefined}
          actionLabel="Registrar salário"
          accent
        />
      </section>
      <div className="budget-layout">
        <section className="panel budget-editor">
          <div className="panel-heading">
            <div>
              <h2>Gastos previstos</h2>
            </div>
            <button
              className="button primary small"
              onClick={() => actions.editBudgetItem()}
            >
              <Plus size={16} /> Adicionar gasto
            </button>
          </div>
          {items.length > 0 && (
            <div className="budget-toolbar">
              <div className="filter-tabs" aria-label="Filtrar gastos">
                {[
                  { id: "all", label: "Todos" },
                  { id: "fixed", label: "Fixos" },
                  { id: "variable", label: "Variáveis" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    aria-pressed={filter === f.id}
                    className={filter === f.id ? "active" : ""}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="budget-list">
            {filtered.map((item, index) => (
              <BudgetRow
                key={item.id}
                item={item}
                index={index}
                onEdit={() => actions.editBudgetItem(item)}
                onRemove={() => actions.removeBudgetItem(item)}
              />
            ))}
            {!filtered.length && (
              <div className="empty-state">
                <ShoppingBasket size={27} />
                <h3>
                  {items.length
                    ? "Nenhum gasto neste filtro"
                    : "Quais são os gastos deste mês?"}
                </h3>
                <p>
                  {items.length
                    ? "Escolha outro filtro para ver os gastos."
                    : "Comece por aluguel, mercado ou outra despesa. Uma estimativa já basta."}
                </p>
              </div>
            )}
          </div>
        </section>
        <aside className="budget-aside">
          <details className="panel optional-panel">
            <summary>
              <span>Reserva planejada</span>
              <span className="optional-value">
                {formatMoney(summary.reservePlan)}
              </span>
              <ChevronRight size={16} />
            </summary>
            <p className="form-hint">
              Opcional. Separa um valor no cálculo do livre previsto.
            </p>
            <button
              className="button secondary full-width"
              onClick={actions.editReservePlan}
            >
              {summary.reservePlan ? "Editar reserva" : "Planejar reserva"}
            </button>
            <p className="form-hint">
              O dinheiro só conta como guardado ao registrar um aporte.
            </p>
          </details>
          {(previous || data.budgetTemplate.length > 0) && (
            <details className="panel optional-panel reuse-card">
              <summary>
                <span>
                  {summary.budget ? "Trocar orçamento" : "Outras opções"}
                </span>
                <ChevronRight size={16} />
              </summary>
              {previous && (
                <button
                  className="text-button"
                  onClick={() => actions.startBudget("previous")}
                >
                  <Copy size={15} /> Copiar mês anterior
                </button>
              )}
              {data.budgetTemplate.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => actions.startBudget("template")}
                >
                  Usar base da planilha
                </button>
              )}
              <button
                className="text-button muted"
                onClick={() => actions.startBudget("empty")}
              >
                Começar em branco
              </button>
            </details>
          )}
        </aside>
      </div>
    </>
  );
}

export function HistoryPage(props: PageProps) {
  const { money: formatMoney, hidden, protect } = usePrivacy();
  const { data, month, actions } = props;
  const [tab, setTab] = useState<"salary" | "budget">("salary");
  const [range, setRange] = useState(0);
  const [year, setYear] = useState(month.slice(0, 4));
  const stats = salaryStats(data.salaries);
  const series = salarySeries(data.salaries);
  const years = [...new Set(data.salaries.map((s) => s.month.slice(0, 4)))]
    .sort()
    .reverse();
  const records = [...data.salaries].sort((a, b) =>
    b.month.localeCompare(a.month),
  );
  const filtered = records.filter(
    (s) => year === "all" || s.month.startsWith(year),
  );
  const annualTotal = filtered.reduce((total, row) => total + row.amount, 0);
  const tabs = (
    <div className="history-tabs filter-tabs" aria-label="Tipo de histórico">
      <button
        className={tab === "salary" ? "active" : ""}
        aria-pressed={tab === "salary"}
        onClick={() => setTab("salary")}
      >
        Salários
      </button>
      <button
        className={tab === "budget" ? "active" : ""}
        aria-pressed={tab === "budget"}
        onClick={() => setTab("budget")}
      >
        Orçamentos
      </button>
    </div>
  );
  if (tab === "budget")
    return (
      <>
        {tabs}
        <BudgetHistory {...props} />
      </>
    );
  if (!records.length)
    return (
      <>
        {tabs}
        <section className="panel empty-state">
          <CalendarDays size={27} aria-hidden="true" />
          <h2>Seu histórico começa com o primeiro salário</h2>
          <p>
            Registre um recebimento. Os meses e a evolução aparecem aqui
            conforme você usa o app.
          </p>
          <button
            className="button primary"
            onClick={() => actions.editSalary()}
          >
            <Plus size={16} /> Registrar salário
          </button>
        </section>
      </>
    );
  return (
    <>
      {tabs}
      <section className="history-overview">
        <div>
          <span className="overline">TOTAL RECEBIDO NO HISTÓRICO</span>
          <div className="history-total">{formatMoney(stats.total)}</div>
          <p>
            {stats.first && monthLabel(stats.first.month, true)} —{" "}
            {stats.latest && monthLabel(stats.latest.month, true)} ·{" "}
            {stats.count} meses
          </p>
        </div>
        <div className="history-growth">
          <TrendingUp size={19} />
          <strong>{protect(percent(stats.growth))}</strong>
          <span>do primeiro ao último salário</span>
        </div>
      </section>
      <section className="metrics-strip three compact">
        <Metric
          label="Primeiro salário"
          value={stats.first ? formatMoney(stats.first.amount) : "—"}
          detail={stats.first ? monthLabel(stats.first.month) : "Sem registros"}
        />
        <Metric
          label="Último salário registrado"
          value={stats.latest ? formatMoney(stats.latest.amount) : "—"}
          detail={
            stats.latest ? monthLabel(stats.latest.month) : "Sem registros"
          }
        />
        <Metric
          label="Maior recebimento mensal"
          value={stats.highest ? formatMoney(stats.highest.amount) : "—"}
          detail={
            stats.highest ? monthLabel(stats.highest.month) : "Sem registros"
          }
        />
      </section>
      <section className="panel history-chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Evolução salarial</h2>
          </div>
          <ChartRange value={range} set={setRange} />
        </div>
        <Chart
          points={range ? series.slice(-range) : series}
          title="Histórico dos recebimentos salariais"
          height={248}
        />
      </section>
      <section className="panel history-records">
        <div className="panel-heading">
          <div>
            <h2>Recebimentos</h2>
          </div>
          <div className="heading-controls">
            <Select
              aria-label="Filtrar histórico por ano"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="all">Todos os anos</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </Select>

            <button
              className="button primary small"
              onClick={() => actions.editSalary()}
            >
              <Plus size={16} /> Registrar salário
            </button>
          </div>
        </div>
        <div className="history-table">
          <div className="history-row table-head">
            <span>Mês</span>
            <span>Recebimento</span>
            <span>Variação mensal</span>
            <span />
          </div>
          {filtered.map((salary) => {
            const previous = data.salaries.find(
              (s) => s.month === shiftMonth(salary.month, -1),
            );
            const growth =
              previous && previous.amount
                ? ((salary.amount - previous.amount) / previous.amount) * 100
                : null;
            return (
              <div className="history-row" key={salary.id}>
                <div>
                  <span className="calendar-icon">
                    <CalendarDays size={16} />
                  </span>
                  <strong>{monthLabel(salary.month)}</strong>
                </div>
                <strong>{formatMoney(salary.amount)}</strong>
                <span
                  className={
                    !hidden && growth !== null && growth > 0
                      ? "positive"
                      : !hidden && growth !== null && growth < 0
                        ? "negative"
                        : "muted"
                  }
                >
                  {growth === null
                    ? "—"
                    : protect(growth === 0 ? "Sem alteração" : percent(growth))}
                </span>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Editar salário de ${monthLabel(salary.month)}`}
                    onClick={() => actions.editSalary(salary)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button muted"
                    aria-label={`Excluir salário de ${monthLabel(salary.month)}`}
                    onClick={() => actions.removeSalary(salary)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          {!filtered.length && (
            <div className="empty-state">
              <CalendarDays size={27} />
              <h3>Sem registros neste período</h3>
              <p>Escolha outro ano ou registre um salário.</p>
            </div>
          )}
        </div>
        <div className="budget-list-total">
          <span>
            {filtered.length} registros{" "}
            {year === "all" ? "no histórico" : `em ${year}`}
          </span>
          <strong>{formatMoney(annualTotal)}</strong>
        </div>
      </section>
    </>
  );
}

export function WealthPage({ data, month, actions }: PageProps) {
  const { money: formatMoney, hidden, protect } = usePrivacy();
  const [period, setPeriod] = useState("month");
  const stats = wealthStats(data, month);
  const pending = data.legacy.status === "pending";
  const confirmed = data.movements.length > 0 || !pending;
  const allocated = data.goals.reduce((total, g) => total + g.allocated, 0);
  const movements = [...data.movements]
    .filter((m) => period === "all" || m.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (
    !data.movements.length &&
    !data.goals.length &&
    data.legacy.status === "none"
  )
    return (
      <section className="panel reserve-start">
        <div className="empty-state">
          <Wallet size={27} aria-hidden="true" />
          <h2>Comece pelo que você já tem guardado</h2>
          <p>
            Informe um saldo inicial ou registre seu primeiro aporte. Você
            escolhe o nome do local onde guarda, sem conectar nenhum banco.
          </p>
          <div className="settings-actions">
            <button
              className="button primary"
              onClick={() => actions.editMovement(undefined, "opening")}
            >
              Informar saldo inicial
            </button>
            <button
              className="button secondary"
              onClick={() => actions.editMovement(undefined, "contribution")}
            >
              Registrar aporte
            </button>
          </div>
        </div>
        {data.accounts.map((account) => (
          <div className="account-row" key={account.id}>
            <span className="account-icon">
              <Landmark size={20} />
            </span>
            <div>
              <strong>{protect(account.name)}</strong>
              <span>Sem movimentações</span>
            </div>
            <button
              className="icon-button muted"
              aria-label={`Excluir local ${protect(account.name)}`}
              onClick={() => actions.removeAccount(account)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
    );
  return (
    <>
      <section className="wealth-overview">
        <div>
          <span className="overline">Reserva confirmada</span>
          <div className={`history-total ${!confirmed ? "unconfirmed" : ""}`}>
            {confirmed ? formatMoney(stats.total) : "A confirmar"}
          </div>
          <p>
            {confirmed
              ? allocated > 0
                ? `${formatMoney(allocated)} destinados a objetivos · ${formatMoney(stats.total - allocated)} disponíveis`
                : "Saldo de todas as contas."
              : "O saldo importado será incluído depois da revisão."}
          </p>
        </div>
        <div className="wealth-overview-actions">
          <button
            className="button primary"
            onClick={() => actions.editMovement()}
          >
            <Plus size={17} /> Registrar aporte
          </button>
        </div>
      </section>
      <section className="metrics-strip three compact">
        <Metric
          label="Total aportado"
          value={formatMoney(stats.contributed)}
          detail={`Retiradas: ${formatMoney(stats.withdrawn)}`}
        />
        <Metric
          label="Total de rendimentos"
          value={formatMoney(stats.returns)}
          detail={`Neste mês: ${formatMoney(stats.monthReturns)}`}
        />
        <Metric
          label="Guardado no mês"
          value={formatMoney(stats.monthSaved)}
          detail={`Aportes ${formatMoney(stats.monthContributed)} − retiradas ${formatMoney(stats.monthWithdrawn)}`}
          accent
        />
      </section>
      <div className="wealth-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Evolução da reserva</h2>
              <span className="subtle">Saldos e movimentações confirmados</span>
            </div>
          </div>
          <Chart
            points={wealthSeries(data)}
            title="Evolução mensal da reserva confirmada"
            height={224}
          />
          {stats.opening !== 0 && (
            <div className="chart-footnote">
              Inclui {formatMoney(stats.opening)} de saldo inicial.
            </div>
          )}
        </section>
        <section className="panel accounts-panel">
          <div className="panel-heading">
            <div>
              <h2>Locais de reserva</h2>
            </div>
          </div>
          {data.accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span className="account-icon">
                <Landmark size={20} />
              </span>
              <div>
                <strong>{protect(account.name)}</strong>
                <span>
                  {pending &&
                  !data.movements.some((m) => m.accountId === account.id)
                    ? "Saldo não confirmado"
                    : formatMoney(accountBalance(data, account.id))}
                </span>
              </div>
              {!data.movements.some((m) => m.accountId === account.id) &&
                !data.goals.some((g) => g.accountId === account.id) && (
                  <button
                    className="icon-button muted"
                    aria-label={`Excluir conta ${protect(account.name)}`}
                    onClick={() => actions.removeAccount(account)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
            </div>
          ))}
          <button className="panel-bottom-link" onClick={actions.addAccount}>
            Adicionar local <Plus size={15} />
          </button>
        </section>
      </div>
      <section className="panel movement-panel">
        <div className="panel-heading">
          <div>
            <h2>Movimentações</h2>
            <span className="subtle">Aportes, rendimentos e retiradas</span>
          </div>
          <Select
            aria-label="Filtrar movimentações"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="all">Todo o histórico</option>
            <option value="month">{monthLabel(month)}</option>
          </Select>
        </div>
        {movements.map((movement) => (
          <div className="movement-row" key={movement.id}>
            <span
              className={`movement-icon ${movement.kind === "withdrawal" ? "withdrawal" : ""}`}
            >
              {movement.kind === "withdrawal" ? (
                <ArrowUpRight size={18} />
              ) : movement.kind === "return" ? (
                <TrendingUp size={18} />
              ) : (
                <ArrowDownLeft size={18} />
              )}
            </span>
            <div className="movement-main">
              <strong>
                {movementLabels[movement.kind]}
                {movement.note && <span> · {protect(movement.note)}</span>}
              </strong>
              <span>
                {movementDateLabel(movement)} ·{" "}
                {protect(
                  data.accounts.find((a) => a.id === movement.accountId)
                    ?.name ?? "Conta",
                )}
              </span>
            </div>
            <strong
              className={
                hidden
                  ? "muted"
                  : movement.kind === "withdrawal" || movement.amount < 0
                    ? "negative"
                    : "positive"
              }
            >
              {!hidden &&
                (movement.kind === "withdrawal"
                  ? "− "
                  : movement.amount > 0
                    ? "+ "
                    : "")}
              {formatMoney(movement.amount)}
            </strong>
            <div className="row-actions">
              <button
                className="icon-button"
                aria-label={`Editar ${movementLabels[movement.kind]} de ${movementDateLabel(movement)}`}
                onClick={() => actions.editMovement(movement)}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-button muted"
                aria-label={`Excluir ${movementLabels[movement.kind]} de ${movementDateLabel(movement)}`}
                onClick={() => actions.removeMovement(movement)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!movements.length && (
          <div className="empty-state">
            <Wallet size={27} />
            <h3>
              Nenhuma movimentação{" "}
              {period === "month" ? "neste mês" : "confirmada"}
            </h3>
            <p>Registre aportes, retiradas e rendimentos.</p>
            <div className="settings-actions">
              {period === "month" && data.movements.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => setPeriod("all")}
                >
                  Ver todas as movimentações <ArrowRight size={15} />
                </button>
              )}
              <button
                className="text-button"
                onClick={() => actions.editMovement()}
              >
                Registrar movimentação <Plus size={15} />
              </button>
            </div>
          </div>
        )}
      </section>
      <details
        className="panel optional-panel goals-panel"
        open={data.goals.length > 0}
      >
        <summary>
          <span>Objetivos</span>
          <span className="optional-value">
            {data.goals.length
              ? `${data.goals.length} cadastrados`
              : "Opcional"}
          </span>
          <ChevronRight size={16} />
        </summary>
        <div className="panel-heading">
          <span className="subtle">Reserve parte do saldo para uma meta.</span>
          <button
            className="button secondary small"
            onClick={() => actions.editGoal()}
          >
            <Plus size={16} /> Novo objetivo
          </button>
        </div>
        {data.goals.length ? (
          <div className="goals-grid">
            {data.goals.map((goal) => (
              <div className="goal-card" key={goal.id}>
                <div className="goal-heading">
                  <span className="soft-icon">
                    <Target size={19} />
                  </span>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={`Editar objetivo ${protect(goal.name)}`}
                      onClick={() => actions.editGoal(goal)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button muted"
                      aria-label={`Excluir objetivo ${protect(goal.name)}`}
                      onClick={() => actions.removeGoal(goal)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3>{protect(goal.name)}</h3>
                <div className="goal-amount">
                  {formatMoney(goal.allocated)}
                  <span>de {formatMoney(goal.target)}</span>
                </div>
                {!hidden && (
                  <div
                    className="goal-progress"
                    role="progressbar"
                    aria-label={goal.name}
                    aria-valuenow={goal.allocated}
                    aria-valuemax={goal.target}
                    aria-valuemin={0}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, (goal.allocated / goal.target) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                <p>
                  {protect(
                    data.accounts.find((a) => a.id === goal.accountId)?.name ??
                      "Conta",
                  )}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="form-hint">
            A destinação usa o saldo existente, sem criar um novo aporte.
          </p>
        )}
      </details>
    </>
  );
}

export function SettingsPage({
  data, actions, persistent, canInstall, theme, account, storageMode,
}: PageProps) {
  const { protect } = usePrivacy();
  const installed = useInstalledApp();
  return (
    <div className="settings-layout">
      <section className="panel settings-block" aria-labelledby="settings-appearance-title">
        <div className="settings-section-heading">
          <Palette size={20} aria-hidden="true" />
          <div><h2 id="settings-appearance-title">Aparência</h2><p>Escolha o tema deste dispositivo.</p></div>
        </div>
        <ThemePicker {...theme} />
      </section>

      <section className="panel settings-block" aria-labelledby="settings-data-title">
        <div className="settings-section-heading">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <h2 id="settings-data-title">Conta e backup</h2>
            <p>{storageMode === "cloud"
              ? "Seus registros ficam salvos na sua conta, mesmo depois de fechar o app."
              : "Seus registros ficam salvos neste navegador, mesmo depois de fechar o app."}</p>
          </div>
        </div>
        {account && (
          <div className="settings-row">
            <div className="settings-row-copy">
              <h3>Sua conta</h3>
              <p className="settings-email">{protect(account.email)}</p>
              <p>Entre com a mesma conta para acessar seus registros em outro celular ou computador. As alterações aparecem quando houver internet.</p>
            </div>
            <button className="button secondary" onClick={actions.signOut}>Sair da conta</button>
          </div>
        )}
        <div className="settings-row settings-backup-row">
          <div className="settings-row-copy">
            <h3>Cópia de segurança</h3>
            <p>{storageMode === "cloud"
              ? "Seus registros já ficam salvos na conta. O backup é uma cópia extra e opcional, para guardar em um arquivo."
              : "Baixe um arquivo com seus registros para guardar uma cópia extra. Para recuperar uma cópia anterior, use Restaurar backup."}</p>
            <span className="settings-backup-date">{data.preferences.lastBackupAt
              ? `Último backup: ${new Date(data.preferences.lastBackupAt).toLocaleString("pt-BR")}`
              : "Você ainda não exportou uma cópia."}</span>
          </div>
          <div className="settings-row-actions">
            <button className="button primary" onClick={actions.backup}><Download size={16} /> Exportar backup</button>
            <button className="button secondary" onClick={actions.restore}>Restaurar backup</button>
          </div>
        </div>
        <p className="settings-detail-note">Guarde o arquivo em um lugar seguro: ele inclui os valores, mesmo quando estão ocultos no app. Restaurar um backup substitui os registros atuais e pede sua confirmação.</p>
        <details className="settings-storage-details">
          <summary>Sobre seus dados <ChevronRight size={16} aria-hidden="true" /></summary>
          <div>
            <p>{storageMode === "cloud"
              ? "Você pode continuar registrando sem internet neste dispositivo. Ao voltar a conexão, suas alterações são atualizadas na conta. Em um novo dispositivo, entre com internet antes de usar o app sem conexão."
              : "Os registros deste modo ficam apenas neste navegador. Para levá-los a outro celular ou computador, exporte um backup e restaure a cópia lá."}</p>
            <p>{storageMode === "cloud"
              ? "Se apagar os dados do navegador, você poderá recuperar o que já foi enviado à conta. Alterações feitas sem internet podem se perder; conecte-se antes de limpar."
              : "Apagar os dados deste navegador remove seus registros. Antes de limpar, exporte uma cópia de segurança."}</p>
            <p>{persistent
              ? "A proteção contra limpeza automática está ativada neste navegador. Ela não impede que você apague os dados manualmente."
              : "Você pode pedir ao navegador para manter seus registros quando ele precisar liberar espaço."}</p>
            {!persistent && <button className="text-button" onClick={actions.requestPersistence}>Proteger dados neste dispositivo <ArrowRight size={14} /></button>}
          </div>
        </details>
      </section>

      <section className="panel settings-block" aria-labelledby="settings-device-title">
        <div className="settings-section-heading">
          <Smartphone size={20} aria-hidden="true" />
          <div><h2 id="settings-device-title">App no seu dispositivo</h2><p>Tenha um ícone do Cash Tracker no celular ou computador.</p></div>
        </div>
        <div className="settings-row settings-install-row">
          <div className="settings-row-copy">
            <h3>{installed ? "Instalado neste dispositivo" : "Abra direto pelo ícone do app"}</h3>
            <p>{installed
              ? "Abra o Cash Tracker pelo ícone na tela inicial ou no computador. Você também pode continuar usando por esta janela."
              : "A instalação adiciona um ícone à tela inicial ou ao computador. Não precisa baixar pela loja de aplicativos."}</p>
            <p>{storageMode === "cloud"
              ? "Instalar não muda sua conta: entre com o mesmo e-mail para acessar seus registros."
              : "Antes de usar em outro navegador ou instalação, exporte um backup para levar seus registros com você."}</p>
          </div>
          <div className="settings-row-actions">
            {(installed || canInstall) && <button className="text-button" onClick={actions.showInstallGuide}>Ver instruções</button>}
            {!installed && <button className="button secondary" onClick={actions.install}>
              {canInstall ? "Instalar app" : "Como instalar"}<ArrowUpRight size={16} />
            </button>}
          </div>
        </div>
      </section>
    </div>
  );
}
