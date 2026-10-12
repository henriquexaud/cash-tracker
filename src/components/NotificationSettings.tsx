import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import type { AppData } from "../domain/types";
import {
  completedMonth,
  notificationPermission,
  pushSupported,
  readPrefs,
  requestNotificationPermission,
  savePrefs,
  syncPush,
  type NotificationPrefs,
  type PushServer,
  type PushStatus,
} from "../notifications";

const days = Array.from({ length: 31 }, (_, index) => index + 1);
const DEFAULT_DAY = 5;

function Switch({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function NotificationSettings({ data, push }: { data: AppData; push?: PushServer }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [permission, setPermission] = useState(notificationPermission);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const active = prefs.reminderDay !== null || prefs.splits;
  const apply = async (next: NotificationPrefs, ask: boolean) => {
    // The permission request must be the first step of the click that enabled an option.
    const granted = ask && permission === "default"
      ? await requestNotificationPermission()
      : permission;
    setPermission(granted);
    if (push) setStatus(await syncPush(push, next, completedMonth(data, new Date())));
  };
  const change = (next: NotificationPrefs) => {
    setPrefs(next);
    savePrefs(next);
    void apply(next, next.reminderDay !== null || next.splits);
  };
  useEffect(() => {
    if (active) void apply(prefs, false);
  }, []);
  const supported = push ? pushSupported() : permission !== "unsupported";
  const retry = (label: string) => (
    <button className="text-button" onClick={() => void apply(prefs, true)}>{label}</button>
  );
  return (
    <section className="panel settings-block" aria-labelledby="settings-notifications-title">
      <div className="settings-section-heading">
        <Bell size={20} aria-hidden="true" />
        <div>
          <h2 id="settings-notifications-title">Notificações</h2>
          <p>{push
            ? "Avisos neste dispositivo, mesmo com o app fechado."
            : "Lembrete neste dispositivo, enquanto o app estiver aberto."}</p>
        </div>
      </div>
      {!supported ? (
        <p className="settings-detail-note">
          Este navegador não oferece notificações. No iPhone ou iPad, instale o app na tela inicial para ativá-las.
        </p>
      ) : (
        <>
          <div className="notification-option">
            <div className="notification-option-head">
              <div className="settings-row-copy">
                <h3>Lembrete do mês</h3>
                <p>Um aviso para lançar o salário e montar o orçamento.</p>
              </div>
              <Switch
                label="Lembrete do mês"
                checked={prefs.reminderDay !== null}
                onChange={(on) => change({ ...prefs, reminderDay: on ? DEFAULT_DAY : null })}
              />
            </div>
            {prefs.reminderDay !== null && (
              <>
                <div className="day-picker" role="group" aria-label="Dia do lembrete">
                  {days.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className="day-option"
                      aria-label={`Dia ${day}`}
                      aria-pressed={prefs.reminderDay === day}
                      onClick={() => change({ ...prefs, reminderDay: day })}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <span className="form-hint notification-hint">
                  Todo dia {prefs.reminderDay}
                  {prefs.reminderDay > 28 ? ", ou no último dia dos meses mais curtos." : "."}
                </span>
              </>
            )}
          </div>
          {push && (
            <div className="notification-option">
              <div className="notification-option-head">
                <div className="settings-row-copy">
                  <h3>Divisões</h3>
                  <p>Um aviso quando alguém adicionar, editar ou excluir uma despesa ou um acerto nos seus grupos, com os valores.</p>
                </div>
                <Switch
                  label="Avisos de Divisões"
                  checked={prefs.splits}
                  onChange={(on) => change({ ...prefs, splits: on })}
                />
              </div>
            </div>
          )}
          {active && permission === "denied" && (
            <p className="settings-detail-note" role="status">
              As notificações estão bloqueadas para o Cash Tracker. Libere-as nas permissões do site ou do app para receber os avisos.
            </p>
          )}
          {active && permission === "default" && (
            <p className="settings-detail-note" role="status">
              Falta permitir as notificações neste dispositivo. {retry("Permitir notificações")}
            </p>
          )}
          {active && permission === "granted" && status === "unavailable" && (
            <p className="settings-detail-note" role="status">
              Os avisos com o app fechado não estão disponíveis nesta versão do app.
            </p>
          )}
          {active && permission === "granted" && status === "failed" && (
            <p className="settings-detail-note" role="status">
              Não foi possível ativar os avisos agora. Confira a internet. {retry("Tentar novamente")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
