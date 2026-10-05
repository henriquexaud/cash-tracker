import { createContext, useContext } from "react";

export const SavingContext = createContext(false);
export const useSaving = () => useContext(SavingContext);

export function DialogActions({ onClose, onConfirm, label, destructive = false, busyLabel = "Salvando…" }: {
  onClose: () => void;
  onConfirm: () => void;
  label: string;
  destructive?: boolean;
  busyLabel?: string;
}) {
  const saving = useSaving();
  return (
    <div className="modal-footer">
      <button className="button secondary" disabled={saving} onClick={onClose}>Cancelar</button>
      <button className={`button ${destructive ? "danger" : "primary"}`} disabled={saving} onClick={onConfirm}>
        {saving ? busyLabel : label}
      </button>
    </div>
  );
}
