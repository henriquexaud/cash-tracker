import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LayoutDashboard, ListFilter, Wallet } from "lucide-react";
import { Modal } from "./Modal";

const steps = [
  {
    label: "Recebido", icon: LayoutDashboard,
    title: "Comece pelo dinheiro que entrou",
    description: "Na Visão geral, registre o salário recebido e escolha o mês que quer acompanhar.",
    highlights: ["Recebido no mês", "Gastos aproximados", "Guardado no mês"],
    points: [
      ["Registre o valor recebido", "Use Registrar salário. Se precisar corrigir, edite o mesmo registro."],
      ["Acompanhe um mês por vez", "As setas mudam o período. O Histórico reúne os salários e orçamentos anteriores."],
    ],
    note: "Você preenche os registros manualmente. O app não se conecta ao seu banco.",
  },
  {
    label: "Orçamento", icon: ListFilter,
    title: "Planeje sem registrar cada compra",
    description: "Em Orçamento, faça uma estimativa dos gastos do mês. Ela serve para entender quanto deve sobrar.",
    highlights: ["Gastos previstos", "Reserva planejada", "Livre previsto"],
    points: [
      ["Adicione os gastos da sua rotina", "Use valores mensais, semanais ou diários. O app calcula o total aproximado."],
      ["Ajuste e reaproveite", "No mês seguinte, copie o orçamento anterior e mude apenas o que for necessário."],
    ],
    note: "A reserva planejada é uma intenção. Ela só vira dinheiro guardado quando você registra um aporte.",
  },
  {
    label: "Reserva", icon: Wallet,
    title: "Registre o que guardou de verdade",
    description: "Em Reserva, escolha onde guarda seu dinheiro e acompanhe os valores que realmente entraram ou saíram.",
    highlights: ["Saldo inicial", "Aportes e retiradas", "Saldo guardado"],
    points: [
      ["Comece com o saldo que já tem", "Informe o saldo inicial de cada local. Depois, registre aportes, retiradas e rendimentos."],
      ["Dê um destino à sua reserva", "Objetivos separam parte do saldo para uma meta. O dinheiro continua no mesmo local."],
    ],
    note: "Seus registros ficam na sua conta. Após o primeiro acesso, você pode editar offline e sincronizar ao reconectar.",
  },
] as const;

export function SettingsGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const current = steps[step];
  const Icon = current.icon;
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  return (
    <Modal title="Como usar o Cash Tracker" onClose={onClose} className="settings-guide">
      <nav className="guide-navigation" aria-label="Etapas do guia">
        {steps.map((item, index) => (
          <button type="button" key={item.label} aria-label={`Etapa ${index + 1}: ${item.label}`} aria-current={step === index ? "step" : undefined}
            onClick={() => setStep(index)}>
            <span aria-hidden="true">{index + 1}</span>{item.label}
          </button>
        ))}
      </nav>
      <div ref={content} className="guide-page">
        <span className="guide-page-icon"><Icon size={26} aria-hidden="true" /></span>
        <p className="guide-page-count" role="status">Etapa {step + 1} de {steps.length}</p>
        <h3 ref={heading} tabIndex={-1} data-autofocus>{current.title}</h3>
        <p className="guide-description">{current.description}</p>
        <div className="guide-highlights" aria-label="O que você acompanha">
          {current.highlights.map((label) => <span key={label}>{label}</span>)}
        </div>
        <ul className="guide-points">
          {current.points.map(([title, text]) => (
            <li key={title}><Check size={17} aria-hidden="true" /><div><strong>{title}</strong><p>{text}</p></div></li>
          ))}
        </ul>
        <p className="guide-note">{current.note}</p>
      </div>
      <div className="modal-footer guide-footer">
        <button type="button" className="button secondary" onClick={step ? () => setStep(step - 1) : onClose}>
          {step ? <><ArrowLeft size={16} /> Anterior</> : "Fechar guia"}
        </button>
        <button type="button" className="button primary" onClick={step === steps.length - 1 ? onClose : () => setStep(step + 1)}>
          {step === steps.length - 1 ? <>Concluir <Check size={16} /></> : <>Próximo <ArrowRight size={16} /></>}
        </button>
      </div>
    </Modal>
  );
}
