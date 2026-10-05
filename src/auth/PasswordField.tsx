import { useId, useState, type InputHTMLAttributes, type Ref } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField({
  label,
  visibilityLabel = "senha",
  inputRef,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  label: string;
  visibilityLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const action = `${visible ? "Ocultar" : "Mostrar"} ${visibilityLabel}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          {...input}
          ref={inputRef}
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={action}
          aria-pressed={visible}
          title={action}
          disabled={input.disabled}
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <EyeOff size={18} aria-hidden="true" />
          ) : (
            <Eye size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
