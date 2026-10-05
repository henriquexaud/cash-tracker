import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Modal } from "./Modal";

type Platform = "ios" | "android" | "desktop";
function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(navigator.userAgent) ? "android" : "desktop";
}
function isStandalone() {
  return typeof window !== "undefined" && (
    Boolean(window.matchMedia?.("(display-mode: standalone)").matches) ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}
export function useInstalledApp() {
  const [installed, setInstalled] = useState(isStandalone);
  useEffect(() => {
    const media = window.matchMedia?.("(display-mode: standalone)");
    const update = () => setInstalled(isStandalone());
    const installed = () => setInstalled(true);
    media?.addEventListener?.("change", update);
    window.addEventListener("appinstalled", installed);
    return () => {
      media?.removeEventListener?.("change", update);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return installed;
}

const platforms = [
  { id: "ios", label: "iPhone / iPad", icon: Smartphone },
  { id: "android", label: "Android", icon: Smartphone },
  { id: "desktop", label: "Computador", icon: Monitor },
] as const;
const instructions = {
  ios: {
    title: "Pelo Safari",
    steps: [
      ["Abra o Cash Tracker no Safari", "Use o endereço do app, fora de navegadores internos de outros aplicativos."],
      ["Toque em Compartilhar", "Procure o quadrado com a seta para cima. Se não estiver visível, abra o menu da página."],
      ["Adicione à Tela de Início", "Escolha Adicionar à Tela de Início e confirme em Adicionar. Se aparecer Abrir como App da Web, deixe ativado."],
    ],
    note: "O ícone do Cash Tracker aparecerá na sua tela de início.",
  },
  android: {
    title: "Pelo Chrome",
    steps: [
      ["Abra o Cash Tracker no Chrome", "Use o endereço do app diretamente no navegador."],
      ["Abra o menu de três pontos", "Escolha Instalar e criar atalho → Instalar. Em outras versões, procure Adicionar à tela inicial ou Instalar app."],
      ["Confirme a instalação", "Depois, abra o Cash Tracker pelo ícone na tela inicial ou na lista de aplicativos."],
    ],
    note: "Se a opção não aparecer, atualize o Chrome e abra o endereço fora de outros aplicativos.",
  },
  desktop: {
    title: "Pelo Chrome ou Edge",
    steps: [
      ["Abra o Cash Tracker no navegador", "Acesse o endereço do app no Chrome ou Edge."],
      ["Procure a opção de instalação", "Use o ícone de instalação na barra de endereço. No Chrome, você também pode usar o menu → Transmitir, salvar e compartilhar → Instalar esta página como um app."],
      ["Confirme e abra pelo atalho", "O app passa a abrir em uma janela própria. Você pode fixar o atalho na barra de tarefas ou no Dock."],
    ],
    note: "No Safari do Mac, use Compartilhar → Adicionar ao Dock.",
  },
} as const;

export function InstallGuide({ onClose, storageMode = "cloud" }: { onClose: () => void; storageMode?: "local" | "cloud" }) {
  const [platform, setPlatform] = useState<Platform>(currentPlatform);
  const current = instructions[platform];
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [platform]);
  return (
    <Modal title="Instalar o Cash Tracker" description="Adicione o ícone ao celular ou computador para abrir o app direto." onClose={onClose} className="install-guide">
      <div className="install-platforms" role="group" aria-label="Dispositivo para instalar">
        {platforms.map(({ id, label, icon: Icon }) => (
          <button type="button" key={id} aria-pressed={platform === id} onClick={() => setPlatform(id)}>
            <Icon size={17} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div ref={content} className="install-content">
        <h3 className="install-heading">{current.title}</h3>
        <ol className="install-steps">
          {current.steps.map(([title, text], index) => (
            <li key={title}><span aria-hidden="true">{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>
          ))}
        </ol>
        <p className="form-hint">{current.note}</p>
        <div className="install-data-note">
          {storageMode === "cloud"
            ? "Depois de instalar, abra com internet e entre com a mesma conta para acessar seus registros."
            : "Antes de usar em outra instalação, exporte um backup para levar seus registros com você."}
        </div>
      </div>
      <div className="modal-footer"><button type="button" className="button primary" onClick={onClose}>Entendi</button></div>
    </Modal>
  );
}
