import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeSettings } from "../theme";

const options = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

export function ThemePicker({
  preference,
  resolvedTheme,
  setPreference,
}: ThemeSettings) {
  return (
    <>
      <div className="theme-picker" role="group" aria-label="Tema do aplicativo">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className="theme-option"
            aria-pressed={preference === value}
            onClick={() => setPreference(value)}
          >
            <span className="theme-option-icon">
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <span className="theme-option-name">{label}</span>
          </button>
        ))}
      </div>
      <span className="form-hint theme-status" role="status">
        {preference === "system"
          ? `Segue a aparência do dispositivo. Agora: ${resolvedTheme === "dark" ? "escuro" : "claro"}.`
          : `Tema ${resolvedTheme === "dark" ? "escuro" : "claro"} ativado.`}
        {" "}Preferência deste dispositivo.
      </span>
    </>
  );
}
