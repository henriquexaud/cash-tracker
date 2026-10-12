import { describe, expect, it } from "vitest";
import {
  Beer,
  Building2,
  Bus,
  Car,
  Cloud,
  Droplets,
  Dumbbell,
  Flame,
  Fuel,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Pill,
  Play,
  Receipt,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Tv,
  Utensils,
  Wifi,
  Zap,
} from "lucide-react";
import { categoryIcon } from "./categoryIcon";

describe("categoryIcon", () => {
  it("mantém os ícones dos nomes já reconhecidos", () => {
    const known = [
      ["Alimentação", Utensils], ["Saúde", HeartPulse], ["Mercado", ShoppingBasket], ["Uber", Car],
      ["Condomínio", Building2], ["Academia", Dumbbell], ["Luz", Zap], ["Celular", Smartphone],
      ["Internet", Wifi], ["iCloud", Cloud], ["YouTube Premium", Play], ["ChatGPT", Laptop],
    ] as const;
    for (const [name, icon] of known) expect(categoryIcon(name), name).toBe(icon);
  });

  it("ignora acentos e maiúsculas", () => {
    expect(categoryIcon("SAUDE")).toBe(HeartPulse);
    expect(categoryIcon("farmácia")).toBe(Pill);
    expect(categoryIcon("Conta de Água")).toBe(Droplets);
  });

  it("casa no início da palavra, não no meio", () => {
    expect(categoryIcon("Aluzinho")).toBe(House);
    expect(categoryIcon("Gastos gerais")).toBe(House);
    expect(categoryIcon("Gás")).toBe(Flame);
    expect(categoryIcon("Barbeiro")).toBe(Scissors);
    expect(categoryIcon("Bar")).toBe(Beer);
    expect(categoryIcon("Supermercado")).toBe(ShoppingBasket);
  });

  it("prefere o termo mais específico", () => {
    expect(categoryIcon("Uber Eats")).toBe(Utensils);
    expect(categoryIcon("Amazon Prime")).toBe(Tv);
    expect(categoryIcon("Amazon")).toBe(ShoppingBag);
    expect(categoryIcon("Mercado Livre")).toBe(ShoppingBag);
    expect(categoryIcon("Seguro do carro")).toBe(ShieldCheck);
    expect(categoryIcon("Financiamento do carro")).toBe(Car);
    expect(categoryIcon("Financiamento")).toBe(Landmark);
    expect(categoryIcon("Gasolina")).toBe(Fuel);
    expect(categoryIcon("Transporte")).toBe(Bus);
  });

  it("usa o ícone padrão indicado quando nada casa", () => {
    expect(categoryIcon("Diversos")).toBe(House);
    expect(categoryIcon("Diversos", Receipt)).toBe(Receipt);
    expect(categoryIcon("", Receipt)).toBe(Receipt);
  });
});
