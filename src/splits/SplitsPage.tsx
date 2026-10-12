import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronRight,
  HandCoins,
  LoaderCircle,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { formatMoney, monthLabel } from "../domain/finance";
import { categoryIcon } from "../components/categoryIcon";
import { Modal } from "../components/Modal";
import { DialogActions, SavingContext } from "../components/Saving";
import { usePrivacy } from "../privacy";
import { balances, debts, entryImpact, normalizeInviteCode, spending, timeline } from "./domain";
import type { SplitRepository } from "./repository";
import { ExpenseForm, NamesForm, SettleForm, capitalized, debtText, memberName } from "./SplitForms";
import type { SplitEntry, SplitGroup } from "./types";

const NAME_KEY = "cash-tracker-split-name";
// Expenses reuse the budget icons, chosen by description; settlements keep their own.
function EntryIcon({ entry }: { entry: SplitEntry }) {
  const Icon = entry.kind === "settlement" ? HandCoins : categoryIcon(entry.description, Receipt);
  return <Icon size={18} aria-hidden="true" />;
}
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );
const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** The history only offers a search once it no longer fits at a glance. */
const SEARCH_FROM = 6;
const list = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
// The current user is listed last, as "você".
const membersText = (group: SplitGroup, ids = group.members.map((member) => member.id)) =>
  list([...ids].sort((a, b) => Number(a === group.me) - Number(b === group.me)).map((id) => memberName(group, id)));

type Route = { group?: string; invite?: string };
function readRoute(): Route {
  const [, first, second] = location.hash.split("/");
  if (first === "join") return { invite: second ?? "" };
  return first ? { group: first } : {};
}

function rememberedName(email?: string) {
  try {
    const saved = window.localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    /* The field simply starts empty. */
  }
  return email?.includes("@") ? email.split("@")[0] : "";
}
function rememberName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* Only a convenience for the next group. */
  }
}

export function SplitsPage({
  repository,
  email,
  notify,
}: {
  repository: SplitRepository;
  email?: string;
  notify: (text: string, error?: boolean) => void;
}) {
  const { money } = usePrivacy();
  const [groups, setGroups] = useState<SplitGroup[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [route, setRoute] = useState(readRoute);
  const [modal, setModal] = useState<ReactNode>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const live = useRef(true);

  const refresh = async () => {
    try {
      const next = await repository.load();
      if (!live.current) return;
      setGroups(next);
      setLoadError("");
    } catch (error) {
      if (live.current)
        setLoadError(error instanceof Error ? error.message : "Não foi possível carregar as divisões.");
    }
  };
  useEffect(() => {
    live.current = true;
    void refresh();
    const onHash = () => {
      setRoute(readRoute());
      setSearch("");
      if (!savingRef.current) setModal(null);
    };
    const onFocus = () => {
      if (!savingRef.current && !document.hidden) void refresh();
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      live.current = false;
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [repository]);

  const close = () => {
    if (!savingRef.current) setModal(null);
  };
  /** Runs one change at a time, then shows the state every participant now sees. */
  const run = async <T,>(task: () => Promise<T>, message: string): Promise<T | undefined> => {
    if (savingRef.current) return undefined;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await task();
      await refresh();
      if (live.current) setModal(null);
      notify(message);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente.", true);
      return undefined;
    } finally {
      savingRef.current = false;
      if (live.current) setSaving(false);
    }
  };
  const open = (id: string | undefined) => {
    if (id) location.hash = `splits/${id}`;
  };

  const createGroup = () =>
    setModal(
      <NamesForm
        title="Criar grupo"
        label="Criar grupo"
        first={{ label: "Nome do grupo", kind: "group", hint: "Ex.: Casa, Viagem, Almoço do time." }}
        second={{ label: "Seu nome no grupo", value: rememberedName(email) }}
        onClose={close}
        onSave={(name, mine) =>
          void run(() => repository.createGroup(name, mine), "Grupo criado.").then((id) => {
            if (id) rememberName(mine);
            open(id);
          })
        }
      />,
    );
  const joinGroup = (code = "") =>
    setModal(
      <NamesForm
        title="Entrar em um grupo"
        description="Use o código ou o link que você recebeu de quem já participa."
        label="Entrar no grupo"
        first={{ label: "Código do convite", kind: "code", value: code }}
        second={{ label: "Seu nome no grupo", value: rememberedName(email) }}
        onClose={close}
        onSave={(invite, mine) =>
          void run(() => repository.joinGroup!(invite, mine), "Você entrou no grupo.").then((id) => {
            if (id) rememberName(mine);
            open(id);
          })
        }
      />,
    );

  // An invite link opens the join form once, then leaves the address clean.
  const invite = route.invite;
  useEffect(() => {
    if (invite === undefined || !groups) return;
    history.replaceState(history.state, "", "#splits");
    setRoute({});
    if (repository.joinGroup) joinGroup(normalizeInviteCode(invite));
    else notify("Convites funcionam apenas com conta. Neste modo, adicione participantes pelo nome.", true);
  }, [invite, !groups]);

  const group = groups?.find((row) => row.id === route.group);
  const content = () => {
    if (!groups)
      return (
        <section className="panel">
          <div className="empty-state">
            {loadError ? (
              <>
                <p role="alert">{loadError}</p>
                <button className="button primary" onClick={() => void refresh()}>
                  Tentar novamente
                </button>
              </>
            ) : (
              <>
                <LoaderCircle className="spin" aria-hidden="true" />
                <p role="status">Abrindo suas divisões…</p>
              </>
            )}
          </div>
        </section>
      );
    if (route.group && !group)
      return (
        <section className="panel">
          <div className="empty-state">
            <Users size={27} aria-hidden="true" />
            <h3>Grupo não encontrado</h3>
            <p>Ele pode ter sido aberto com outra conta. Só participantes acessam um grupo.</p>
            <a className="text-button" href="#splits">
              <ArrowLeft size={15} /> Ver meus grupos
            </a>
          </div>
        </section>
      );
    return group ? groupView(group) : listView(groups);
  };

  const position = (value: number, you = "Você") =>
    value > 0 ? `${you} recebe ${money(value)}` : value < 0 ? `${you} deve ${money(-value)}` : "Tudo acertado";
  const tone = (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "");

  const listView = (rows: SplitGroup[]) => {
    const overall = rows.reduce((sum, row) => sum + (balances(row).get(row.me) ?? 0), 0);
    return (
      <section className="panel">
        <div className="panel-heading split-heading">
          <div>
            <h2>Seus grupos</h2>
            <span className="subtle">Nada daqui entra no seu orçamento ou na sua reserva.</span>
          </div>
          <div className="settings-actions">
            {repository.joinGroup && (
              <button className="button secondary" onClick={() => joinGroup()}>
                Entrar com código
              </button>
            )}
            <button className="button primary" onClick={createGroup}>
              <Plus size={17} /> Criar grupo
            </button>
          </div>
        </div>
        {rows.length > 1 && (
          <p className="split-clear">
            Somando os grupos: <strong className={`split-balance ${tone(overall)}`}>{overall ? position(overall, "você") : "tudo acertado"}</strong>
          </p>
        )}
        {rows.map((row) => {
          const mine = balances(row).get(row.me) ?? 0;
          return (
            <a className="split-group-row" key={row.id} href={`#splits/${row.id}`}>
              <span className="account-icon">
                <Users size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>{row.name}</strong>
                <span>{row.members.length > 1 ? capitalized(membersText(row)) : "Só você por enquanto"}</span>
              </div>
              <span className={`split-balance ${tone(mine)}`}>{position(mine)}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </a>
          );
        })}
        {!rows.length && (
          <div className="empty-state">
            <Users size={27} aria-hidden="true" />
            <h3>Divida despesas com outras pessoas</h3>
            <p>
              Crie um grupo, registre quem pagou e veja quem deve a quem.
              {repository.joinGroup && " Se alguém te convidou, entre com o código."}
            </p>
          </div>
        )}
      </section>
    );
  };

  const invitePeople = (current: SplitGroup) => {
    if (repository.addMember)
      return setModal(
        <NamesForm
          title="Adicionar participante"
          description="Neste modo, sem contas, os participantes são identificados pelo nome."
          label="Adicionar"
          first={{ label: "Nome", kind: "member" }}
          onClose={close}
          onSave={(name) => void run(() => repository.addMember!(current.id, name), "Participante adicionado.")}
        />,
      );
    const link = `${location.origin}${location.pathname}#splits/join/${current.inviteCode}`;
    setModal(
      <Modal
        title="Convidar para o grupo"
        description="Quem tiver este código entra no grupo e vê as despesas. Envie apenas para quem participa."
        onClose={close}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="split-invite-code">Código do convite</label>
            <input id="split-invite-code" className="input split-code" readOnly value={current.inviteCode ?? ""} onFocus={(event) => event.currentTarget.select()} />
          </div>
          <div className="field">
            <label htmlFor="split-invite-link">Link</label>
            <input id="split-invite-link" className="input" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="button secondary" onClick={close}>
            Fechar
          </button>
          <button
            className="button primary"
            data-autofocus=""
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => notify("Link do convite copiado."))
                .catch(() => notify("Não foi possível copiar. Selecione o link e copie manualmente.", true))
            }
          >
            Copiar link
          </button>
        </div>
      </Modal>,
    );
  };

  const entryTitle = (current: SplitGroup, entry: SplitEntry) =>
    entry.kind === "settlement"
      ? `${capitalized(memberName(current, entry.paidBy))} pagou ${memberName(current, entry.participants[0])}`
      : entry.description;
  const entryDetail = (current: SplitGroup, entry: SplitEntry) =>
    entry.kind === "settlement"
      ? "Acerto de contas"
      : `${capitalized(memberName(current, entry.paidBy))} pagou · ${
          entry.participants.length === current.members.length
            ? "dividido entre todos"
            : entry.participants.length === 1
              ? `por conta de ${memberName(current, entry.participants[0])}`
              : `dividido entre ${membersText(current, entry.participants)}`
        }`;

  const entryRow = (current: SplitGroup, entry: SplitEntry) => {
    const impact = entryImpact(entry, current.me);
    const save = (next: SplitEntry, message: string) =>
      void run(() => repository.saveEntry(current.id, next), message);
    return (
      <div className="movement-row" key={entry.id}>
        <span className="movement-icon">
          <EntryIcon entry={entry} />
        </span>
        <div className="movement-main">
          <strong>{entryTitle(current, entry)}</strong>
          <span>
            {dateLabel(entry.date)} · {entryDetail(current, entry)}
          </span>
        </div>
        <div className="split-entry-value">
          <strong>{money(entry.amount)}</strong>
          {entry.kind === "expense" && (
            <span className={tone(impact)}>
              {impact ? position(impact, "você") : "não envolve você"}
            </span>
          )}
        </div>
        <div className="row-actions">
          {entry.kind === "expense" && (
            <button
              className="icon-button"
              aria-label={`Editar ${entry.description}`}
              onClick={() =>
                setModal(
                  <ExpenseForm group={current} entry={entry} onClose={close} onSave={(next) => save(next, "Despesa atualizada.")} />,
                )
              }
            >
              <Pencil size={15} />
            </button>
          )}
          <button
            className="icon-button muted"
            aria-label={`Excluir ${entry.kind === "settlement" ? `acerto: ${entryTitle(current, entry)}` : entry.description}`}
            onClick={() =>
              setModal(
                <Modal title={entry.kind === "settlement" ? "Excluir acerto?" : "Excluir despesa?"} onClose={close}>
                  <p className="modal-description">
                    {entryTitle(current, entry)}, {formatMoney(entry.amount)}, será removido para todos do grupo. Os saldos serão recalculados.
                  </p>
                  <DialogActions
                    onClose={close}
                    label="Excluir"
                    destructive
                    onConfirm={() =>
                      void run(
                        () => repository.removeEntry(current.id, entry.id),
                        entry.kind === "settlement" ? "Acerto excluído." : "Despesa excluída.",
                      )
                    }
                  />
                </Modal>,
              )
            }
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  const groupView = (current: SplitGroup) => {
    const owed = debts(current);
    const entries = timeline(current);
    const alone = current.members.length < 2;
    const total = spending(current.entries, current.me);
    const mine = balances(current).get(current.me) ?? 0;
    const query = entries.length >= SEARCH_FROM ? plain(search.trim()) : "";
    const shown = query ? entries.filter((entry) => plain(entryTitle(current, entry)).includes(query)) : entries;
    const months = [...new Set(shown.map((entry) => entry.date.slice(0, 7)))];
    const save = (entry: SplitEntry, message: string) =>
      void run(() => repository.saveEntry(current.id, entry), message);
    return (
      <>
        <a className="text-button split-back" href="#splits">
          <ArrowLeft size={15} aria-hidden="true" /> Todos os grupos
        </a>
        <section className="panel split-summary">
          <div className="panel-heading split-heading">
            <div>
              <h2>{current.name}</h2>
              <span className="subtle">{alone ? "Só você por enquanto" : capitalized(membersText(current))}</span>
            </div>
            <div className="settings-actions">
              <button className="button secondary" onClick={() => invitePeople(current)}>
                <UserPlus size={17} /> {repository.addMember ? "Adicionar participante" : "Convidar"}
              </button>
              <button
                className="button primary"
                disabled={alone}
                onClick={() =>
                  setModal(<ExpenseForm group={current} onClose={close} onSave={(entry) => save(entry, "Despesa adicionada.")} />)
                }
              >
                <Plus size={17} /> Adicionar despesa
              </button>
            </div>
          </div>
          {total.spent > 0 && (
            <dl className="split-totals">
              <div>
                <dt>Gasto do grupo</dt>
                <dd>{money(total.spent)}</dd>
              </div>
              <div>
                <dt>Sua parte</dt>
                <dd>{money(total.share)}</dd>
              </div>
              <div>
                <dt>Seu saldo</dt>
                <dd className={tone(mine)}>{position(mine)}</dd>
              </div>
            </dl>
          )}
          {alone ? (
            <p className="split-clear">
              {repository.addMember
                ? "Adicione ao menos mais uma pessoa para começar a dividir."
                : "Convide ao menos mais uma pessoa para começar a dividir."}
            </p>
          ) : owed.length ? (
            <ul className="split-debts" aria-label="Quem deve a quem">
              {owed.map((debt) => (
                <li key={`${debt.from}:${debt.to}`}>
                  <span>{debtText(current, debt, money)}</span>
                  <button
                    className="text-button"
                    aria-label={`Acertar: ${debtText(current, debt, money)}`}
                    onClick={() =>
                      setModal(
                        <SettleForm group={current} debt={debt} onClose={close} onSave={(entry) => save(entry, "Acerto registrado.")} />,
                      )
                    }
                  >
                    Acertar
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="split-clear">
              {entries.length ? "Tudo acertado. Ninguém deve nada." : "Nenhuma despesa ainda. Ninguém deve nada."}
            </p>
          )}
        </section>
        <section className="panel movement-panel">
          <div className="panel-heading">
            <div>
              <h2>Histórico</h2>
              <span className="subtle">Despesas e acertos, dos mais recentes aos mais antigos</span>
            </div>
          </div>
          {entries.length >= SEARCH_FROM && (
            <input
              className="input split-search"
              type="search"
              aria-label="Buscar no histórico"
              placeholder="Buscar pela descrição"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {months.map((month) => {
            const rows = shown.filter((entry) => entry.date.startsWith(month));
            return (
              <Fragment key={month}>
                <h3 className="split-month">
                  <span>{capitalized(monthLabel(month))}</span>
                  <span>{money(spending(rows, current.me).spent)}</span>
                </h3>
                {rows.map((entry) => entryRow(current, entry))}
              </Fragment>
            );
          })}
          {!!entries.length && !shown.length && (
            <p className="split-clear" role="status">
              Nenhum lançamento com “{search.trim()}”.
            </p>
          )}
          {!entries.length && (
            <div className="empty-state">
              <Receipt size={27} aria-hidden="true" />
              <h3>Nenhum lançamento</h3>
              <p>As despesas e os acertos do grupo aparecem aqui.</p>
            </div>
          )}
        </section>
      </>
    );
  };

  return (
    <SavingContext.Provider value={saving}>
      {groups && loadError && (
        <div className="inline-notice" role="alert">
          <span>{loadError}</span>
          <button className="text-button" onClick={() => void refresh()}>
            Tentar novamente
          </button>
        </div>
      )}
      {content()}
      {modal}
    </SavingContext.Provider>
  );
}
