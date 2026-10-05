import { LayoutDashboard, ListFilter, Wallet } from "lucide-react";
import type { AppData } from "../domain/types";
import { Modal } from "./Modal";

const guideKey = (identity: string) => `cash-tracker-guide-v1-${identity}`;

export function shouldShowGuide(data: AppData, identity: string) {
  const empty =
    !data.salaries.length &&
    !data.budgets.length &&
    !data.budgetTemplate.length &&
    !data.accounts.length &&
    !data.movements.length &&
    !data.goals.length &&
    data.legacy.status === "none";
  if (!empty) return false;
  try {
    return window.localStorage.getItem(guideKey(identity)) !== "seen";
  } catch {
    return true;
  }
}

export function rememberGuide(identity: string) {
  try {
    window.localStorage.setItem(guideKey(identity), "seen");
  } catch {
    // Dismissal still works for this session if storage is unavailable.
  }
}

export function QuickGuide({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <Modal
      title="Seu mês, em três passos"
      onClose={onClose}
      className="quick-guide"
    >
      <ol className="guide-steps">
        <li>
          <LayoutDashboard size={21} aria-hidden="true" />
          <div>
            <h3>Visão geral</h3>
            <p>Registre o salário recebido e veja o resumo do mês.</p>
          </div>
        </li>
        <li>
          <ListFilter size={21} aria-hidden="true" />
          <div>
            <h3>Orçamento</h3>
            <p>
              Estime seus gastos. No próximo mês, você pode copiar e ajustar.
            </p>
          </div>
        </li>
        <li>
          <Wallet size={21} aria-hidden="true" />
          <div>
            <h3>Reserva</h3>
            <p>
              Registre o que guardou de fato. O que sobrou no orçamento não vira
              aporte automaticamente.
            </p>
          </div>
        </li>
      </ol>
      <p className="form-hint">
        O Histórico reúne os meses anteriores. Nas Configurações, você encontra
        o backup e este guia.
      </p>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Explorar o app
        </button>
        <button className="button primary" onClick={onStart}>
          Registrar salário
        </button>
      </div>
    </Modal>
  );
}
