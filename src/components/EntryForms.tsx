import { Select } from "./Select";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  formatMoney,
  parseMoney,
  today,
  validateGoal,
  validateMovement,
} from "../domain/finance";
import type {
  Account,
  AppData,
  BudgetItem,
  BudgetKind,
  Frequency,
  Goal,
  Movement,
  MovementKind,
  Salary,
} from "../domain/types";
import { Modal } from "./Modal";

const moneyText = (value: number) => formatMoney(value).replace(/R\$\s*/, "");
const parsedAmount = (value: string) => {
  if (!value.trim()) return null;
  const parsed = parseMoney(value);
  return typeof parsed === "number" && Number.isSafeInteger(parsed)
    ? parsed
    : null;
};
const newId = () => crypto.randomUUID();
const movementLabels: Record<MovementKind, string> = {
  contribution: "Aporte",
  withdrawal: "Retirada",
  return: "Rendimento",
  opening: "Saldo inicial",
};

function useFormError(id: string) {
  const [error, setError] = useState<string | null>(null);
  const showError = (message: string, field?: string) => {
    setError(message);
    requestAnimationFrame(() => {
      const target = document.getElementById(`${id}-${field ?? "error"}`);
      target?.closest("details")?.setAttribute("open", "");
      target?.focus();
    });
  };
  return [error, showError] as const;
}

function FormActions({
  onClose,
  label = "Salvar",
  disabled = false,
}: {
  onClose: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>
        Cancelar
      </button>
      <button
        type="submit"
        className="button primary"
        disabled={disabled}
      >
        {label}
      </button>
    </div>
  );
}

function FormError({ error, id }: { error: string | null; id: string }) {
  return error ? (
    <p className="form-error" role="alert" id={id} tabIndex={-1}>
      {error}
    </p>
  ) : null;
}

function Field({
  label,
  children,
  hint,
  id,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  id: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="form-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  id,
  hint,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} id={id} hint={hint}>
      <input
        className="input money-input"
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        data-autofocus={autoFocus ? "" : undefined}
      />
    </Field>
  );
}

export function SalaryForm({
  month,
  salary,
  initialAmount,
  onSave,
  onClose,
}: {
  month: string;
  salary?: Salary;
  initialAmount?: number;
  onSave: (salary: Salary) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(() => {
    const value = salary?.amount ?? initialAmount;
    return value === undefined ? "" : moneyText(value);
  });
  const [error, setError] = useFormError(id);
  const monthLabel = /^\d{4}-\d{2}$/.test(month)
    ? new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
      }).format(new Date(`${month}-15T12:00:00`))
    : month;

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parsedAmount(amount);
    if (value === null || value < 0)
      return setError(
        "Informe um salário maior ou igual a zero, com até duas casas decimais.",
        "amount",
      );
    onSave({ id: salary?.id ?? newId(), month, amount: value });
  }

  return (
    <Modal
      title={salary ? "Editar salário" : "Registrar salário"}
      description={monthLabel}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <MoneyField
            id={`${id}-amount`}
            label="Valor recebido (R$)"
            value={amount}
            onChange={setAmount}
            autoFocus
            hint="Registre o valor líquido recebido neste mês."
          />
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label="Salvar salário" />
      </form>
    </Modal>
  );
}

export function BudgetItemForm({
  item,
  onSave,
  onClose,
}: {
  item?: BudgetItem;
  onSave: (item: BudgetItem) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<BudgetKind>(item?.kind ?? "fixed");
  const [frequency, setFrequency] = useState<Frequency>(
    item?.frequency ?? "monthly",
  );
  const [amount, setAmount] = useState(item ? moneyText(item.unitAmount) : "");
  const [factor, setFactor] = useState(String(item?.factor ?? 1));
  const [error, setError] = useFormError(id);
  const unitAmount = parsedAmount(amount);
  const numericFactor = Number(factor.replace(",", "."));
  const monthlyAmount =
    unitAmount !== null &&
    unitAmount >= 0 &&
    Number.isSafeInteger(numericFactor) &&
    numericFactor > 0
      ? unitAmount * numericFactor
      : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Dê um nome ao gasto.", "name");
    if (unitAmount === null || unitAmount < 0)
      return setError(
        "Informe um valor válido, maior ou igual a zero.",
        "amount",
      );
    if (
      !factor.trim() ||
      !Number.isSafeInteger(numericFactor) ||
      numericFactor <= 0 ||
      monthlyAmount === null ||
      !Number.isSafeInteger(monthlyAmount)
    ) {
      return setError(
        "Informe uma quantidade inteira maior que zero, que resulte em um total válido.",
        "factor",
      );
    }
    onSave({
      id: item?.id ?? newId(),
      name: name.trim(),
      kind,
      frequency,
      unitAmount,
      factor: numericFactor,
    });
  }

  return (
    <Modal
      title={item ? "Editar gasto" : "Adicionar gasto"}
      description="Informe uma estimativa do que costuma gastar."
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Nome do gasto" id={`${id}-name`}>
            <input
              className="input"
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="Ex.: alimentação"
              data-autofocus={!item ? "" : undefined}
            />
          </Field>
          <MoneyField
            id={`${id}-amount`}
            label={
              frequency === "monthly"
                ? numericFactor === 1
                  ? "Valor mensal (R$)"
                  : "Valor por ocorrência (R$)"
                : frequency === "weekly"
                  ? "Valor por semana (R$)"
                  : "Valor por dia (R$)"
            }
            value={amount}
            onChange={setAmount}
            autoFocus={Boolean(item)}
          />
          <Field label="Tipo" id={`${id}-kind`}>
            <Select
              className="select"
              id={`${id}-kind`}
              value={kind}
              onChange={(event) => setKind(event.target.value as BudgetKind)}
            >
              <option value="fixed">Fixo</option>
              <option value="variable">Variável</option>
            </Select>
          </Field>
          <Field label="Frequência" id={`${id}-frequency`}>
            <Select
              className="select"
              id={`${id}-frequency`}
              value={frequency}
              onChange={(event) => {
                const next = event.target.value as Frequency;
                setFrequency(next);
                setFactor(
                  String(next === "daily" ? 30 : next === "weekly" ? 4 : 1),
                );
              }}
            >
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
              <option value="daily">Diária</option>
            </Select>
          </Field>
          <details
            className="form-optional"
            open={frequency !== "monthly" || (item?.factor ?? 1) > 1}
          >
            <summary>Repetições no mês</summary>
            <Field
              label="Quantidade"
              id={`${id}-factor`}
              hint="Use 30 para dias, 4 para semanas ou 1 para um valor mensal. Ajuste se precisar."
            >
              <input
                className="input"
                id={`${id}-factor`}
                type="text"
                inputMode="numeric"
                value={factor}
                onChange={(event) => setFactor(event.target.value)}
                aria-describedby={`${id}-factor-hint`}
              />
            </Field>
          </details>
        </div>
        <div className="money-preview">
          <span>Total mensal</span>
          <strong>
            {monthlyAmount !== null && Number.isSafeInteger(monthlyAmount)
              ? formatMoney(monthlyAmount)
              : "—"}
          </strong>
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label="Salvar gasto" />
      </form>
    </Modal>
  );
}

export function ReservePlanForm({
  value,
  onSave,
  onClose,
}: {
  value: number;
  onSave: (value: number) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(moneyText(value));
  const [error, setError] = useFormError(id);
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = parsedAmount(amount);
    if (next === null || next < 0)
      return setError("Informe um valor maior ou igual a zero.", "amount");
    onSave(next);
  }

  return (
    <Modal
      title="Planejar quanto guardar"
      description="Este valor entra no cálculo do dinheiro livre previsto do mês."
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <MoneyField
            id={`${id}-amount`}
            label="Valor planejado (R$)"
            value={amount}
            onChange={setAmount}
            autoFocus
            hint="Ao guardar o dinheiro, registre um aporte na tela Reserva. O aporte não será descontado novamente do orçamento."
          />
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label="Salvar planejamento" />
      </form>
    </Modal>
  );
}

export function MovementForm({
  data,
  movement,
  initialKind = "contribution",
  initialDate,
  onSave,
  onClose,
}: {
  data: AppData;
  movement?: Movement;
  initialKind?: MovementKind;
  initialDate?: string;
  onSave: (movement: Movement) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [accountId, setAccountId] = useState(
    movement?.accountId ?? data.accounts[0]?.id ?? "",
  );
  const monthlyDate = movement?.datePrecision === "month";
  const [date, setDate] = useState(
    monthlyDate
      ? movement.date.slice(0, 7)
      : (movement?.date ?? initialDate ?? today()),
  );
  const [kind, setKind] = useState<MovementKind>(movement?.kind ?? initialKind);
  const suggestedAmount = (kind: MovementKind, date: string) => {
    const plan = data.budgets.find((budget) => budget.month === date.slice(0, 7))?.reservePlan;
    return kind === "contribution" && plan ? moneyText(plan) : "";
  };
  const [amount, setAmount] = useState(
    () => movement ? moneyText(movement.amount) : suggestedAmount(kind, date),
  );
  const [amountEdited, setAmountEdited] = useState(false);
  const [note, setNote] = useState(movement?.note ?? "");
  const [error, setError] = useFormError(id);
  const isLegacyOpening = Boolean(
    movement && movement.id === data.legacy.resolution?.movementId,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parsedAmount(amount);
    if (value === null)
      return setError(
        "Informe um valor válido, com até duas casas decimais.",
        "amount",
      );
    const candidate: Movement = {
      id: movement?.id ?? newId(),
      accountId,
      date: monthlyDate ? `${date}-01` : date,
      ...(monthlyDate ? { datePrecision: "month" as const } : {}),
      kind,
      amount: value,
      note: note.trim(),
    };
    const issue = validateMovement(data, candidate, movement?.id);
    if (issue) return setError(issue);
    onSave(candidate);
  }

  const hint =
    kind === "withdrawal"
      ? "Digite o valor positivo que saiu da conta."
      : kind === "return"
        ? "Rendimento recebido nesta conta. Use um valor negativo para registrar uma perda."
        : kind === "opening"
          ? "Saldo que já existia antes de começar os registros nesta conta. Cadastre antes dos aportes e rendimentos."
          : "Valor novo que você guardou nesta conta.";

  return (
    <Modal
      title={
        movement
          ? "Editar movimentação"
          : `Registrar ${movementLabels[kind].toLowerCase()}`
      }
      description={
        data.accounts.length === 1 ? data.accounts[0].name : undefined
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <MoneyField
            id={`${id}-amount`}
            label="Valor (R$)"
            value={amount}
            onChange={(value) => {
              setAmount(value);
              setAmountEdited(true);
            }}
            hint={hint}
            autoFocus
          />
          <Field
            label="Tipo de movimentação"
            id={`${id}-kind`}
            hint={
              isLegacyOpening
                ? "Este registro é o saldo inicial confirmado da planilha. Seu tipo permanece como saldo inicial."
                : undefined
            }
          >
            <Select
              className="select"
              id={`${id}-kind`}
              value={kind}
              onChange={(event) => {
                const next = event.target.value as MovementKind;
                setKind(next);
                if (!movement && !amountEdited) setAmount(suggestedAmount(next, date));
              }}
              disabled={isLegacyOpening}
              aria-describedby={isLegacyOpening ? `${id}-kind-hint` : undefined}
            >
              {Object.entries(movementLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {data.accounts.length !== 1 && (
            <Field label="Local de reserva" id={`${id}-account`}>
              <Select
                className="select"
                id={`${id}-account`}
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {!data.accounts.length && (
                  <option value="">Nenhuma conta cadastrada</option>
                )}
                {data.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label={monthlyDate ? "Mês" : "Data"}
            id={`${id}-date`}
            hint={
              monthlyDate
                ? "A planilha confirma o mês deste lançamento, sem informar o dia."
                : undefined
            }
          >
            <input
              className="input"
              type={monthlyDate ? "month" : "date"}
              id={`${id}-date`}
              value={date}
              onChange={(event) => {
                const next = event.target.value;
                setDate(next);
                if (!movement && !amountEdited) setAmount(suggestedAmount(kind, next));
              }}
              aria-describedby={monthlyDate ? `${id}-date-hint` : undefined}
            />
          </Field>
          <details className="form-optional" open={Boolean(movement?.note)}>
            <summary>Observação (opcional)</summary>
            <Field label="Observação" id={`${id}-note`}>
              <textarea
                className="input"
                id={`${id}-note`}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex.: aporte de outubro"
              />
            </Field>
          </details>
        </div>
        {!data.accounts.length && (
          <p className="form-hint">
            Cadastre uma conta na tela Reserva antes de registrar movimentações.
          </p>
        )}
        <FormError error={error} id={`${id}-error`} />
        <FormActions
          onClose={onClose}
          label={`Salvar ${movementLabels[kind].toLowerCase()}`}
          disabled={!data.accounts.length}
        />
      </form>
    </Modal>
  );
}

export function GoalForm({
  data,
  goal,
  onSave,
  onClose,
}: {
  data: AppData;
  goal?: Goal;
  onSave: (goal: Goal) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(goal?.name ?? "");
  const [accountId, setAccountId] = useState(
    goal?.accountId ?? data.accounts[0]?.id ?? "",
  );
  const [target, setTarget] = useState(goal ? moneyText(goal.target) : "");
  const [allocated, setAllocated] = useState(moneyText(goal?.allocated ?? 0));
  const [error, setError] = useFormError(id);
  const balance = data.movements
    .filter((movement) => movement.accountId === accountId)
    .reduce(
      (sum, movement) =>
        sum +
        (movement.kind === "withdrawal" ? -movement.amount : movement.amount),
      0,
    );
  const otherAllocated = data.goals
    .filter((item) => item.accountId === accountId && item.id !== goal?.id)
    .reduce((sum, item) => sum + item.allocated, 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Dê um nome ao objetivo.", "name");
    const targetAmount = parsedAmount(target);
    const allocatedAmount = parsedAmount(allocated);
    if (targetAmount === null || targetAmount <= 0)
      return setError("Informe uma meta maior que zero.", "target");
    if (allocatedAmount === null || allocatedAmount < 0)
      return setError(
        "Informe um valor reservado maior ou igual a zero.",
        "allocated",
      );
    const candidate: Goal = {
      id: goal?.id ?? newId(),
      name: name.trim(),
      accountId,
      target: targetAmount,
      allocated: allocatedAmount,
    };
    const issue = validateGoal(data, candidate, goal?.id);
    if (issue) return setError(issue);
    onSave(candidate);
  }

  return (
    <Modal
      title={goal ? "Editar objetivo" : "Criar objetivo"}
      description="Destine parte do saldo de uma conta a um objetivo. O dinheiro continua na mesma conta."
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Nome do objetivo" id={`${id}-name`}>
            <input
              className="input"
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="Ex.: reserva de emergência"
              data-autofocus
            />
          </Field>
          <Field label="Conta do dinheiro reservado" id={`${id}-account`}>
            <Select
              className="select"
              id={`${id}-account`}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {!data.accounts.length && (
                <option value="">Nenhuma conta cadastrada</option>
              )}
              {data.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <MoneyField
            id={`${id}-target`}
            label="Meta (R$)"
            value={target}
            onChange={setTarget}
          />
          <MoneyField
            id={`${id}-allocated`}
            label="Valor já reservado (R$)"
            value={allocated}
            onChange={setAllocated}
            hint="Este valor destina dinheiro que já existe na conta e não cria um novo aporte."
          />
        </div>
        <div className="money-preview">
          <span>Disponível para este objetivo</span>
          <strong>{formatMoney(Math.max(0, balance - otherAllocated))}</strong>
        </div>
        {!data.accounts.length && (
          <p className="form-hint">
            Cadastre uma conta na tela Reserva antes de criar objetivos.
          </p>
        )}
        <FormError error={error} id={`${id}-error`} />
        <FormActions
          onClose={onClose}
          label="Salvar objetivo"
          disabled={!data.accounts.length}
        />
      </form>
    </Modal>
  );
}

export function AccountForm({
  onSave,
  onClose,
  description = "Dê um nome ao local onde seu dinheiro está guardado. O registro é manual.",
}: {
  onSave: (account: Account) => void;
  onClose: () => void;
  description?: string;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useFormError(id);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Informe o nome do local.", "name");
    onSave({ id: newId(), name: name.trim() });
  }

  return (
    <Modal
      title="Adicionar local de reserva"
      description={description}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Nome do local" id={`${id}-name`}>
            <input
              className="input"
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="Ex.: conta corrente ou reserva"
              data-autofocus
            />
          </Field>
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label="Salvar local" />
      </form>
    </Modal>
  );
}

export function LegacyForm({
  data,
  onSave,
  onClose,
}: {
  data: AppData;
  onSave: (movement: Movement) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [error, setError] = useFormError(id);
  const accountHasMovements = data.movements.some(
    (movement) => movement.accountId === accountId,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (accountHasMovements || data.legacy.status === "resolved") return;
    const value = parsedAmount(amount);
    if (value === null || value < 0)
      return setError(
        "Preencha o saldo exato conferido, maior ou igual a zero.",
        "amount",
      );
    const candidate: Movement = {
      id: newId(),
      accountId,
      date,
      kind: "opening",
      amount: value,
      note: "Saldo inicial conferido a partir da planilha. Movimentações antigas preservadas na importação, sem datas atribuídas.",
    };
    const issue = validateMovement(data, candidate);
    if (issue) return setError(issue);
    onSave(candidate);
  }

  return (
    <Modal
      title="Conferir reserva da planilha"
      description="Os valores antigos foram preservados. Confirme o saldo atual para começar a acompanhar sua conta."
      onClose={onClose}
      className="modal-wide"
    >
      <form onSubmit={submit} noValidate>
        <div className="legacy-review">
          <p className="form-hint">
            As movimentações não têm datas identificadas e os possíveis
            rendimentos não reconciliam com o total exibido. Ainda não entram no
            reserva.
          </p>
          <div className="money-preview">
            <span>Saldo das movimentações antigas</span>
            <strong>{formatMoney(data.legacy.displayedNet)}</strong>
          </div>
          <div className="money-preview">
            <span>Total guardado exibido na imagem</span>
            <strong>{data.legacy.displayedSaved}</strong>
          </div>
          <details>
            <summary>Ver os valores preservados da planilha</summary>
            <p className="form-hint">
              <strong>Entradas e saídas, na ordem da imagem:</strong>
              <br />
              {data.legacy.movements
                .map((value) => formatMoney(value))
                .join(" · ")}
            </p>
            <p className="form-hint">
              <strong>Possíveis rendimentos:</strong>
              <br />
              {data.legacy.possibleReturns
                .map((value) => formatMoney(value))
                .join(" · ")}
            </p>
            {data.legacy.notes.map((note, index) => (
              <p className="form-hint" key={index}>
                {note}
              </p>
            ))}
          </details>
        </div>
        <div className="form-grid">
          <MoneyField
            id={`${id}-amount`}
            label="Saldo exato conferido (R$)"
            value={amount}
            onChange={setAmount}
            autoFocus
            hint="Confira o saldo no banco e preencha todos os centavos."
          />
          <Field label="Data desse saldo" id={`${id}-date`}>
            <input
              className="input"
              type="date"
              id={`${id}-date`}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Conta" id={`${id}-account`}>
            <Select
              className="select"
              id={`${id}-account`}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {!data.accounts.length && (
                <option value="">Nenhuma conta cadastrada</option>
              )}
              {data.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="form-hint">
          O saldo confirmado será registrado uma vez como saldo inicial. Os
          valores antigos continuarão disponíveis para consulta, sem somá-los
          novamente.
        </p>
        {accountHasMovements && (
          <p className="form-error" role="alert">
            Esta conta já tem movimentações. O saldo inicial precisa vir antes
            dos aportes e rendimentos. Copie os lançamentos que deseja manter,
            remova-os e confirme o saldo; depois, registre-os novamente.
          </p>
        )}
        {!data.accounts.length && (
          <p className="form-hint">
            Cadastre uma conta na tela Reserva antes de confirmar o saldo.
          </p>
        )}
        <FormError error={error} id={`${id}-error`} />
        <FormActions
          onClose={onClose}
          label="Confirmar saldo inicial"
          disabled={
            !data.accounts.length ||
            accountHasMovements ||
            data.legacy.status === "resolved"
          }
        />
      </form>
    </Modal>
  );
}
