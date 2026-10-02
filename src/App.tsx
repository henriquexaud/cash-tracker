import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  currentMonth,
  monthLabel,
  copyBudget,
  formatMoney,
  salaryStats,
  shiftMonth,
  today,
  validateGoal,
  validateMovement,
} from "./domain/finance";
import { createInitialData } from "./domain/seed";
import type { AppData, Budget, Month } from "./domain/types";
import {
  exportBackup,
  loadData,
  parseBackup,
  saveData,
  validateBackup,
} from "./storage";
import { requestPersistence } from "./pwa";
import {
  AccountForm,
  BudgetItemForm,
  GoalForm,
  LegacyForm,
  MovementForm,
  ReservePlanForm,
  SalaryForm,
} from "./components/EntryForms";
import { Modal } from "./components/Modal";
import {
  DashboardPage,
  BudgetPage,
  HistoryPage,
  WealthPage,
  SettingsPage,
} from "./Pages";
import type { Actions, Page, PageProps } from "./ui-types";

const navigation: { id: Page; label: string; icon: typeof Wallet }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "budget", label: "Orçamento", icon: ListFilter },
  { id: "history", label: "Histórico", icon: TrendingUp },
  { id: "wealth", label: "Patrimônio", icon: Wallet },
  { id: "settings", label: "Configurações", icon: Settings2 },
];
const readPage = (): Page =>
  navigation.find((p) => `#${p.id}` === location.hash)?.id ?? "dashboard";
const lock = async <T,>(task: () => Promise<T>): Promise<T> =>
  navigator.locks
    ? await navigator.locks.request("cash-tracker-data", task)
    : await task();

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function downloadBackup(data: AppData, prefix = "cash-tracker") {
  const blob = new Blob([exportBackup(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>(readPage);
  const [month, setMonth] = useState<Month>(currentMonth);
  const [modal, setModal] = useState<ReactNode>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(
    !!navigator.serviceWorker?.controller,
  );
  const [persistent, setPersistent] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const [updateReady, setUpdateReady] = useState(false);
  const updateRegistration = useRef<ServiceWorkerRegistration | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const recoveryInput = useRef<HTMLInputElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const savingRef = useRef(false);

  const initialize = async () => {
    setLoadError("");
    try {
      const result = await lock(async () => {
        const existing = await loadData();
        if (existing) return existing;
        const seed = createInitialData();
        await saveData(seed);
        return seed;
      });
      setData(result);
      if (navigator.storage?.persisted)
        setPersistent(await navigator.storage.persisted());
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir seus dados neste dispositivo.",
      );
    }
  };

  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    const onHash = () => {
      setPage(readPage());
      setModal(null);
      window.scrollTo({ top: 0 });
    };
    const onOnline = () => setOnline(navigator.onLine);
    const offline = () => setOfflineReady(true);
    const update = (e: Event) => {
      updateRegistration.current = (
        e as CustomEvent<ServiceWorkerRegistration>
      ).detail;
      setUpdateReady(true);
    };
    const install = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPrompt);
    };
    const installed = () => setInstallPrompt(null);
    const refresh = async () => {
      if (savingRef.current) return;
      try {
        const result = await loadData();
        if (result) setData(result);
      } catch {
        /* Keep currently loaded data; next save still reports a storage error. */
      }
    };
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("cash-tracker-changes");
      channel.current.onmessage = () => void refresh();
    }
    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    window.addEventListener("focus", refresh);
    window.addEventListener("cash-tracker-offline-ready", offline);
    window.addEventListener("cash-tracker-update", update);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", installed);
    return () => {
      channel.current?.close();
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("cash-tracker-offline-ready", offline);
      window.removeEventListener("cash-tracker-update", update);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const mutate = async (
    transform: (current: AppData) => AppData,
    message: string,
  ) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = await lock(async () => {
        const current = await loadData();
        if (!current)
          throw new Error(
            "Os dados locais não foram encontrados. Reabra o aplicativo antes de continuar.",
          );
        const candidate = transform(structuredClone(current));
        validateBackup(candidate);
        await saveData(candidate);
        return candidate;
      });
      setData(next);
      channel.current?.postMessage("saved");
      setNotice({ text: message });
      return true;
    } catch (error) {
      setNotice({
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar. Seus dados anteriores foram preservados.",
        error: true,
      });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const close = () => setModal(null);
  const commit = async (
    transform: (current: AppData) => AppData,
    message: string,
  ) => {
    if (await mutate(transform, message)) close();
  };
  const navigate = (target: Page) => {
    location.hash = target;
    setPage(target);
    window.scrollTo({ top: 0 });
  };
  const confirm = (
    title: string,
    description: string,
    onConfirm: () => void,
    label = "Excluir",
    destructive = true,
  ) => {
    setModal(
      <Modal title={title} onClose={close}>
        <p className="modal-description">{description}</p>
        <div className="modal-footer">
          <button className="button secondary" onClick={close}>
            Cancelar
          </button>
          <button
            className={`button ${destructive ? "danger" : "primary"}`}
            onClick={onConfirm}
          >
            {label}
          </button>
        </div>
      </Modal>,
    );
  };
  const getBudget = (current: AppData): Budget =>
    current.budgets.find((b) => b.month === month) ?? {
      month,
      items: current.budgetTemplate.map((i) => ({ ...i })),
      reservePlan: 0,
    };
  const replaceBudget = (current: AppData, budget: Budget) => ({
    ...current,
    budgets: [
      ...current.budgets.filter((b) => b.month !== budget.month),
      budget,
    ],
  });

  if (!data)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <TrendingUp size={23} />
        </div>
        <h1>Cash Tracker</h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <div className="settings-actions">
              <button
                className="button primary"
                onClick={() => void initialize()}
              >
                Tentar novamente
              </button>
              <button
                className="button secondary"
                onClick={() => recoveryInput.current?.click()}
              >
                Restaurar um backup
              </button>
            </div>
            <p className="muted">
              Use uma janela normal do navegador e permita o armazenamento
              local.
            </p>
            <input
              hidden
              ref={recoveryInput}
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 20 * 1024 * 1024)
                    throw new Error(
                      "Esse arquivo é muito grande para um backup do Cash Tracker.",
                    );
                  const restored = parseBackup(await file.text());
                  setModal(
                    <Modal title="Recuperar seus dados?" onClose={close}>
                      <p className="modal-description">
                        Este backup contém {restored.salaries.length} salários e{" "}
                        {restored.movements.length} movimentações. Ele
                        substituirá os dados locais que não puderam ser abertos.
                      </p>
                      <div className="modal-footer">
                        <button className="button secondary" onClick={close}>
                          Cancelar
                        </button>
                        <button
                          className="button primary"
                          onClick={() =>
                            void (async () => {
                              try {
                                await lock(async () => {
                                  try {
                                    const existing = await loadData();
                                    if (existing)
                                      downloadBackup(
                                        existing,
                                        "cash-tracker-antes-da-recuperacao",
                                      );
                                  } catch {
                                    /* Explicit recovery of an unreadable state; never initialize a seed here. */
                                  }
                                  await saveData(restored);
                                });
                                setData(restored);
                                setLoadError("");
                                close();
                                channel.current?.postMessage("saved");
                                setNotice({
                                  text: "Backup restaurado. Seus dados foram recuperados.",
                                });
                              } catch (error) {
                                close();
                                setLoadError(
                                  error instanceof Error
                                    ? error.message
                                    : "Não foi possível recuperar os dados.",
                                );
                              }
                            })()
                          }
                        >
                          Restaurar e recuperar
                        </button>
                      </div>
                    </Modal>,
                  );
                } catch (error) {
                  setLoadError(
                    error instanceof Error
                      ? error.message
                      : "O backup não é válido.",
                  );
                }
              }}
            />
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Abrindo seu histórico…</p>
          </>
        )}
        {modal}
      </div>
    );

  const actions: Actions = {
    navigate,
    editSalary: (salary, target = salary?.month ?? month) =>
      setModal(
        <SalaryForm
          salary={salary ?? data.salaries.find((s) => s.month === target)}
          month={target}
          onClose={close}
          onSave={(s) =>
            void commit(
              (current) => ({
                ...current,
                salaries: [
                  ...current.salaries.filter((row) => row.month !== s.month),
                  s,
                ].sort((a, b) => a.month.localeCompare(b.month)),
              }),
              "Salário registrado.",
            )
          }
        />,
      ),
    removeSalary: (salary) =>
      confirm(
        "Excluir salário?",
        `O registro de ${monthLabel(salary.month)} será removido do seu histórico.`,
        () =>
          void commit(
            (current) => ({
              ...current,
              salaries: current.salaries.filter((s) => s.id !== salary.id),
            }),
            "Salário excluído.",
          ),
      ),
    editBudgetItem: (item) =>
      setModal(
        <BudgetItemForm
          item={item}
          onClose={close}
          onSave={(newItem) =>
            void commit(
              (current) => {
                const budget = getBudget(current);
                return replaceBudget(current, {
                  ...budget,
                  items: item
                    ? budget.items.map((i) => (i.id === item.id ? newItem : i))
                    : [...budget.items, newItem],
                });
              },
              `Orçamento salvo para ${monthLabel(month, true)}.`,
            )
          }
        />,
      ),
    removeBudgetItem: (item) =>
      confirm(
        "Excluir item do orçamento?",
        `${item.name} será removido apenas de ${monthLabel(month)}.`,
        () =>
          void commit((current) => {
            const budget = getBudget(current);
            return replaceBudget(current, {
              ...budget,
              items: budget.items.filter((i) => i.id !== item.id),
            });
          }, "Item removido deste mês."),
      ),
    editReservePlan: () =>
      setModal(
        <ReservePlanForm
          value={getBudget(data).reservePlan}
          onClose={close}
          onSave={(value) =>
            void commit(
              (current) =>
                replaceBudget(current, {
                  ...getBudget(current),
                  reservePlan: value,
                }),
              "Reserva planejada atualizada.",
            )
          }
        />,
      ),
    startBudget: (source) => {
      const apply = () =>
        void commit(
          (current) => {
            const previous = current.budgets.find(
              (b) => b.month === shiftMonth(month, -1),
            );
            if (source === "previous" && !previous)
              throw new Error(
                "O mês anterior não possui orçamento registrado.",
              );
            const budget =
              source === "previous"
                ? copyBudget(previous!, month)
                : {
                    month,
                    items:
                      source === "template"
                        ? current.budgetTemplate.map((i) => ({ ...i }))
                        : [],
                    reservePlan: 0,
                  };
            return replaceBudget(current, budget);
          },
          `Orçamento de ${monthLabel(month, true)} iniciado.`,
        );
      if (data.budgets.some((b) => b.month === month))
        confirm(
          "Substituir orçamento deste mês?",
          `Os itens e a reserva planejada de ${monthLabel(month)} serão substituídos. Os outros meses serão preservados.`,
          apply,
          "Substituir",
          false,
        );
      else apply();
    },
    editMovement: (movement, kind = "contribution") =>
      setModal(
        <MovementForm
          data={data}
          movement={movement}
          initialKind={kind}
          initialDate={month === currentMonth() ? today() : `${month}-01`}
          onClose={close}
          onSave={(m) =>
            void commit((current) => {
              const isLegacy = current.legacy.resolution?.movementId === m.id;
              if (isLegacy && m.kind !== "opening")
                throw new Error(
                  "O saldo confirmado da planilha deve permanecer como saldo inicial.",
                );
              const error = validateMovement(current, m, movement?.id);
              if (error) throw new Error(error);
              return {
                ...current,
                movements: [
                  ...current.movements.filter((row) => row.id !== m.id),
                  m,
                ],
                legacy: isLegacy
                  ? {
                      ...current.legacy,
                      resolution: {
                        amount: m.amount,
                        date: m.date,
                        accountId: m.accountId,
                        movementId: m.id,
                      },
                    }
                  : current.legacy,
              };
            }, "Movimentação registrada.")
          }
        />,
      ),
    removeMovement: (movement) =>
      confirm(
        "Excluir movimentação?",
        `O lançamento de ${formatMoney(movement.amount)} será removido. O patrimônio será recalculado.`,
        () =>
          void commit((current) => {
            const next = {
              ...current,
              movements: current.movements.filter((m) => m.id !== movement.id),
            };
            if (current.legacy.resolution?.movementId === movement.id)
              next.legacy = {
                ...current.legacy,
                status: "pending",
                resolution: undefined,
              };
            return next;
          }, "Movimentação excluída."),
      ),
    editGoal: (goal) =>
      setModal(
        <GoalForm
          data={data}
          goal={goal}
          onClose={close}
          onSave={(g) =>
            void commit((current) => {
              const error = validateGoal(current, g, goal?.id);
              if (error) throw new Error(error);
              return {
                ...current,
                goals: [...current.goals.filter((row) => row.id !== g.id), g],
              };
            }, "Objetivo atualizado.")
          }
        />,
      ),
    removeGoal: (goal) =>
      confirm(
        "Excluir objetivo?",
        `A destinação para ${goal.name} será removida. O dinheiro continuará no patrimônio.`,
        () =>
          void commit(
            (current) => ({
              ...current,
              goals: current.goals.filter((g) => g.id !== goal.id),
            }),
            "Objetivo excluído.",
          ),
      ),
    addAccount: () =>
      setModal(
        <AccountForm
          onClose={close}
          onSave={(account) =>
            void commit(
              (current) => ({
                ...current,
                accounts: [...current.accounts, account],
              }),
              "Local de patrimônio adicionado.",
            )
          }
        />,
      ),
    removeAccount: (account) =>
      confirm(
        "Excluir local?",
        `O local ${account.name} será removido se não possuir movimentações nem objetivos.`,
        () =>
          void commit((current) => {
            if (
              current.movements.some((m) => m.accountId === account.id) ||
              current.goals.some((g) => g.accountId === account.id)
            )
              throw new Error(
                "Esse local possui registros. Remova ou ajuste os registros antes de excluí-lo.",
              );
            return {
              ...current,
              accounts: current.accounts.filter((a) => a.id !== account.id),
            };
          }, "Local excluído."),
      ),
    reviewLegacy: () =>
      setModal(
        <LegacyForm
          data={data}
          onClose={close}
          onSave={(movement) =>
            void commit((current) => {
              if (current.legacy.status !== "pending")
                throw new Error(
                  "O saldo da planilha já foi confirmado. Edite o saldo inicial no patrimônio.",
                );
              const error = validateMovement(current, movement);
              if (error) throw new Error(error);
              return {
                ...current,
                movements: [...current.movements, movement],
                legacy: {
                  ...current.legacy,
                  status: "resolved",
                  resolution: {
                    amount: movement.amount,
                    date: movement.date,
                    accountId: movement.accountId,
                    movementId: movement.id,
                  },
                },
              };
            }, "Saldo inicial confirmado. Os registros antigos foram preservados.")
          }
        />,
      ),
    backup: () =>
      void (async () => {
        const at = new Date().toISOString();
        const succeeded = await mutate((current) => {
          const next = {
            ...current,
            preferences: { ...current.preferences, lastBackupAt: at },
          };
          downloadBackup(next);
          return next;
        }, "Backup completo exportado.");
        if (!succeeded)
          setNotice({
            text: "Não foi possível concluir a exportação. Tente novamente.",
            error: true,
          });
      })(),
    restore: () => restoreInput.current?.click(),
    requestPersistence: () =>
      void requestPersistence()
        .then((result) => {
          setPersistent(result);
          setNotice({
            text: result
              ? "Armazenamento persistente ativado."
              : "O navegador gerencia a proteção dos dados. Mantenha seus backups atualizados.",
          });
        })
        .catch(() =>
          setNotice({
            text: "Não foi possível solicitar proteção do armazenamento.",
            error: true,
          }),
        ),
    install: () => {
      if (installPrompt)
        void installPrompt
          .prompt()
          .then(() => installPrompt.userChoice)
          .then(() => setInstallPrompt(null));
      else
        setModal(
          <Modal title="Instalar o Cash Tracker" onClose={close}>
            <p className="modal-description">
              No iPhone, abra no Safari, toque em Compartilhar e selecione{" "}
              <strong>Adicionar à Tela de Início</strong>. No computador ou
              Android, use a opção de instalação no menu do navegador.
            </p>
            <p className="form-hint">
              A versão publicada precisa ser acessada por HTTPS. Depois da
              primeira carga, o aplicativo funciona offline neste dispositivo.
            </p>
            <div className="modal-footer">
              <button className="button primary" onClick={close}>
                Entendi
              </button>
            </div>
          </Modal>,
        );
    },
  };

  const props: PageProps = {
    data,
    month,
    setMonth,
    actions,
    offlineReady,
    persistent,
    canInstall: !!installPrompt,
  };
  const CurrentPage = {
    dashboard: DashboardPage,
    budget: BudgetPage,
    history: HistoryPage,
    wealth: WealthPage,
    settings: SettingsPage,
  }[page];
  const monthChange = (newMonth: string) => {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(newMonth)) {
      setMonth(newMonth);
      close();
    }
  };

  return (
    <div className="app-shell" aria-busy={saving}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#dashboard"
          aria-label="Cash Tracker, visão geral"
        >
          <span className="brand-mark">
            <TrendingUp size={23} strokeWidth={2.4} />
          </span>
          <span>
            cash<span className="brand-light">tracker</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Navegação principal">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-link ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-backup" onClick={actions.backup}>
            <ArrowDownToLine size={15} /> Exportar backup{" "}
          </button>
          <p>Dados salvos neste dispositivo.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a className="topbar-brand" href="#dashboard">
            Cash Tracker
          </a>
          <div className="topbar-actions">
            <span className="save-status">
              <span className={`status-dot ${!online ? "offline" : ""}`} />
              {saving
                ? "Salvando…"
                : online
                  ? "Salvo neste dispositivo"
                  : "Você está offline"}
            </span>
            <button
              className="icon-button topbar-help"
              title="Sobre seus dados locais"
              aria-label="Sobre seus dados locais"
              onClick={() => navigate("settings")}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main id="main-content" className={`main-content page-${page}`}>
          <div className="page-heading">
            <div>
              <h1>
                {
                  {
                    dashboard: "Visão geral",
                    budget: "Orçamento",
                    history: "Histórico",
                    wealth: "Patrimônio",
                    settings: "Configurações",
                  }[page]
                }
              </h1>
              <p>
                {
                  {
                    dashboard: "Salário, orçamento e dinheiro guardado.",
                    budget: "Planeje seus gastos e sua reserva mensal.",
                    history:
                      "Salários e orçamentos, desde os primeiros registros.",
                    wealth: "Contas, aportes, rendimentos e objetivos.",
                    settings: "Backup, instalação e dados locais.",
                  }[page]
                }
              </p>
            </div>
            {page !== "settings" && (
              <div className="month-picker">
                <button
                  className="icon-button"
                  aria-label="Mês anterior"
                  disabled={month === "1900-01"}
                  onClick={() => monthChange(shiftMonth(month, -1))}
                >
                  <ChevronLeft size={17} />
                </button>
                <label className="month-display">
                  <span>{monthLabel(month)}</span>
                  <input
                    type="month"
                    min="1900-01"
                    max="9999-12"
                    value={month}
                    aria-label="Mês selecionado"
                    onChange={(e) => monthChange(e.target.value)}
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label="Próximo mês"
                  disabled={month === "9999-12"}
                  onClick={() => monthChange(shiftMonth(month, 1))}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
          </div>
          {updateReady && (
            <div className="inline-notice">
              <CheckCheck size={17} />
              <span>Uma nova versão está disponível.</span>
              <button
                className="text-button"
                onClick={() => {
                  const registration = updateRegistration.current;
                  if (!registration?.waiting) {
                    location.reload();
                    return;
                  }
                  registration.waiting.postMessage("SKIP_WAITING");
                }}
              >
                Atualizar
              </button>
            </div>
          )}
          <CurrentPage {...props} />
        </main>
      </div>
      {modal}
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{notice.text}</span>
          <button aria-label="Fechar aviso" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      <input
        ref={restoreInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Selecionar backup"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 20 * 1024 * 1024)
              throw new Error(
                "Esse arquivo é muito grande para um backup do Cash Tracker.",
              );
            const restored = parseBackup(await file.text());
            const stats = salaryStats(restored.salaries);
            setModal(
              <Modal title="Restaurar este backup?" onClose={close}>
                <p className="modal-description">
                  O arquivo contém{" "}
                  <strong>{restored.salaries.length} salários</strong>,{" "}
                  <strong>{restored.budgets.length} orçamentos</strong> e{" "}
                  <strong>{restored.movements.length} movimentações</strong>.
                  Total recebido: <strong>{formatMoney(stats.total)}</strong>.
                </p>
                <div className="form-hint">
                  O backup substituirá os dados deste dispositivo. Uma cópia dos
                  dados atuais será exportada antes da substituição.
                </div>
                <div className="modal-footer">
                  <button className="button secondary" onClick={close}>
                    Cancelar
                  </button>
                  <button
                    className="button primary"
                    onClick={() =>
                      void commit((current) => {
                        downloadBackup(
                          current,
                          "cash-tracker-antes-da-restauracao",
                        );
                        return restored;
                      }, "Backup restaurado com sucesso.")
                    }
                  >
                    Salvar cópia e restaurar
                  </button>
                </div>
              </Modal>,
            );
          } catch (error) {
            setNotice({
              text:
                error instanceof Error
                  ? error.message
                  : "O arquivo de backup não é válido.",
              error: true,
            });
          }
        }}
      />
      {saving && (
        <div className="saving-indicator" aria-label="Salvando">
          <LoaderCircle size={16} className="spin" />
        </div>
      )}
    </div>
  );
}
