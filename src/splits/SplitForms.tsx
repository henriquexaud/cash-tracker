import { useId, useState, type FormEvent } from "react";
import { formatMoney, today } from "../domain/finance";
import {
  EntryForm,
  Field,
  FormActions,
  FormError,
  MoneyField,
  moneyText,
  parsedAmount,
  useFormError,
} from "../components/EntryForms";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import {
  MAX_DESCRIPTION,
  MAX_GROUP_NAME,
  MAX_MEMBER_NAME,
  cleanName,
  entryShares,
  normalizeInviteCode,
  validateEntry,
  validateSettlement,
} from "./domain";
import type { SplitDebt, SplitEntry, SplitGroup } from "./types";

type SplitMode = "all" | "single" | "some";

export const memberName = (group: SplitGroup, id: string) =>
  id === group.me
    ? "você"
    : (group.members.find((member) => member.id === id)?.name ?? "alguém");
export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const debtText = (group: SplitGroup, debt: SplitDebt, money = formatMoney) =>
  `${capitalized(memberName(group, debt.from))} deve ${money(debt.amount)} a ${memberName(group, debt.to)}`;

function sharePreview(group: SplitGroup, entry: SplitEntry) {
  const amounts = entryShares(entry);
  const shares = group.members.flatMap((member): [string, number][] =>
    amounts.has(member.id) ? [[member.id, amounts.get(member.id)!]] : [],
  );
  const values = shares.map(([, value]) => value);
  if (shares.length === 1)
    return `${capitalized(memberName(group, shares[0][0]))} assume ${formatMoney(values[0])}.`;
  if (values.every((value) => value === values[0]))
    return `${formatMoney(values[0])} para cada um.`;
  if (shares.length > 6)
    return `De ${formatMoney(Math.min(...values))} a ${formatMoney(Math.max(...values))} por pessoa: os centavos que sobram ficam com quem pagou.`;
  return `${shares.map(([id, value]) => `${capitalized(memberName(group, id))} ${formatMoney(value)}`).join(" · ")}.`;
}

export function ExpenseForm({
  group,
  entry,
  onSave,
  onClose,
}: {
  group: SplitGroup;
  entry?: SplitEntry;
  onSave: (entry: SplitEntry) => void;
  onClose: () => void;
}) {
  const id = useId();
  const everyone = group.members.map((member) => member.id);
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry ? moneyText(entry.amount) : "");
  const [paidBy, setPaidBy] = useState(entry?.paidBy ?? group.me);
  const [mode, setMode] = useState<SplitMode>(
    !entry || entry.participants.length === everyone.length
      ? "all"
      : entry.participants.length === 1
        ? "single"
        : "some",
  );
  const [single, setSingle] = useState(entry?.participants.length === 1 ? entry.participants[0] : "");
  const [selected, setSelected] = useState(entry?.participants ?? everyone);
  const [error, setError, clearError] = useFormError(id);
  const others = group.members.filter((member) => member.id !== paidBy);
  const assumes = others.some((member) => member.id === single) ? single : others[0]?.id;
  const participants =
    mode === "all"
      ? everyone
      : mode === "single"
        ? assumes ? [assumes] : []
        : everyone.filter((member) => selected.includes(member));
  const value = parsedAmount(amount);
  const candidate: SplitEntry = {
    id: entry?.id ?? crypto.randomUUID(),
    kind: "expense",
    description: description.trim(),
    amount: value ?? 0,
    paidBy,
    participants,
    date: entry?.date ?? today(),
    createdAt: entry?.createdAt ?? new Date().toISOString(),
  };
  const preview =
    value !== null && value > 0 && participants.length ? sharePreview(group, candidate) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) return setError("Descreva a despesa.", "description");
    if (value === null || value <= 0)
      return setError("Informe um valor maior que zero, com até duas casas decimais.", "amount");
    const invalid = validateEntry(group, candidate);
    if (invalid) return setError(invalid);
    onSave(candidate);
  }

  return (
    <Modal title={entry ? "Editar despesa" : "Adicionar despesa"} description={group.name} onClose={onClose}>
      <EntryForm id={id} error={error} clearError={clearError} onSubmit={submit}>
        <div className="form-grid">
          <Field label="Descrição" id={`${id}-description`}>
            <input
              className="input"
              id={`${id}-description`}
              name="description"
              autoComplete="off"
              enterKeyHint="next"
              maxLength={MAX_DESCRIPTION}
              placeholder="Ex.: Mercado"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              data-autofocus=""
            />
          </Field>
          <MoneyField id={`${id}-amount`} label="Valor (R$)" value={amount} onChange={setAmount} enterKeyHint="done" />
          <Field label="Quem pagou" id={`${id}-payer`}>
            <Select id={`${id}-payer`} className="select" value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>
              {group.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {capitalized(memberName(group, member.id))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Como dividir" id={`${id}-mode`} hint={preview ?? undefined}>
            <Select id={`${id}-mode`} className="select" value={mode} onChange={(event) => setMode(event.target.value as SplitMode)}>
              <option value="all">{everyone.length === 2 ? "Meio a meio" : "Igualmente entre todos"}</option>
              <option value="single">Uma pessoa assume tudo</option>
              {everyone.length > 2 && <option value="some">Escolher quem participa</option>}
            </Select>
          </Field>
          {mode === "single" && others.length > 1 && (
            <Field label="Quem assume" id={`${id}-single`}>
              <Select id={`${id}-single`} className="select" value={assumes} onChange={(event) => setSingle(event.target.value)}>
                {others.map((member) => (
                  <option key={member.id} value={member.id}>
                    {capitalized(memberName(group, member.id))}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "some" && (
            <fieldset className="split-checks">
              <legend>Quem participa</legend>
              {group.members.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(member.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, member.id]
                          : current.filter((row) => row !== member.id),
                      )
                    }
                  />
                  <span>{capitalized(memberName(group, member.id))}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label={entry ? "Salvar despesa" : "Adicionar despesa"} />
      </EntryForm>
    </Modal>
  );
}

export function SettleForm({
  group,
  debt,
  onSave,
  onClose,
}: {
  group: SplitGroup;
  debt: SplitDebt;
  onSave: (entry: SplitEntry) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(moneyText(debt.amount));
  const [error, setError, clearError] = useFormError(id);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parsedAmount(amount);
    if (value === null || value <= 0)
      return setError("Informe um valor maior que zero, com até duas casas decimais.", "amount");
    if (value > debt.amount)
      return setError(`O acerto não pode ser maior que os ${formatMoney(debt.amount)} em aberto.`, "amount");
    const entry: SplitEntry = {
      id: crypto.randomUUID(),
      kind: "settlement",
      description: "",
      amount: value,
      paidBy: debt.from,
      participants: [debt.to],
      date: today(),
      createdAt: new Date().toISOString(),
    };
    const invalid = validateSettlement(group, entry);
    if (invalid) return setError(invalid, "amount");
    onSave(entry);
  }

  return (
    <Modal title="Acertar contas" description={`${debtText(group, debt)}.`} onClose={onClose}>
      <EntryForm id={id} error={error} clearError={clearError} onSubmit={submit}>
        <div className="form-grid">
          <MoneyField
            id={`${id}-amount`}
            label="Valor pago (R$)"
            value={amount}
            onChange={setAmount}
            enterKeyHint="done"
            autoFocus
            hint="Diminua o valor para um acerto parcial. O app apenas registra: nenhum pagamento é feito."
          />
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label="Registrar acerto" />
      </EntryForm>
    </Modal>
  );
}

/** One or two short text fields: create a group, join by code or add a participant. */
export function NamesForm({
  title,
  description,
  label,
  first,
  second,
  onSave,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  first: { label: string; value?: string; kind: "group" | "code" | "member"; hint?: string };
  second?: { label: string; value?: string; hint?: string };
  onSave: (first: string, second: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [one, setOne] = useState(first.value ?? "");
  const [two, setTwo] = useState(second?.value ?? "");
  const [error, setError, clearError] = useFormError(id);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value =
      first.kind === "code"
        ? normalizeInviteCode(one)
        : cleanName(one, first.kind === "group" ? MAX_GROUP_NAME : MAX_MEMBER_NAME);
    if (!value)
      return setError(
        first.kind === "code" ? "Informe o código do convite." : `Preencha o campo “${first.label}”.`,
        "first",
      );
    const name = second ? cleanName(two, MAX_MEMBER_NAME) : "";
    if (name === null) return setError("Informe como você quer aparecer no grupo.", "second");
    onSave(value, name);
  }

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <EntryForm id={id} error={error} clearError={clearError} onSubmit={submit}>
        <div className="form-grid">
          <Field label={first.label} id={`${id}-first`} hint={first.hint}>
            <input
              className="input"
              id={`${id}-first`}
              autoComplete="off"
              autoCapitalize={first.kind === "code" ? "characters" : undefined}
              spellCheck={first.kind === "code" ? false : undefined}
              maxLength={first.kind === "group" ? MAX_GROUP_NAME : MAX_MEMBER_NAME}
              value={one}
              onChange={(event) => setOne(event.target.value)}
              data-autofocus={first.value ? undefined : ""}
            />
          </Field>
          {second && (
            <Field label={second.label} id={`${id}-second`} hint={second.hint}>
              <input
                className="input"
                id={`${id}-second`}
                autoComplete="off"
                maxLength={MAX_MEMBER_NAME}
                value={two}
                onChange={(event) => setTwo(event.target.value)}
                data-autofocus={first.value ? "" : undefined}
              />
            </Field>
          )}
        </div>
        <FormError error={error} id={`${id}-error`} />
        <FormActions onClose={onClose} label={label} />
      </EntryForm>
    </Modal>
  );
}
