import { describe, expect, it } from "vitest";
import { groceryStore, grocerySummary } from "./grocery";
import type { SplitEntry } from "./types";

let next = 0;
const expense = (description: string, amount: number, date: string, kind: SplitEntry["kind"] = "expense"): SplitEntry => ({
  id: `e${++next}`,
  kind,
  description,
  amount,
  paidBy: "ana",
  participants: kind === "expense" ? ["ana", "bia"] : ["bia"],
  date,
  createdAt: `${date}T10:00:${String(next % 60).padStart(2, "0")}Z`,
});

describe("groceryStore", () => {
  it("reconhece as formas usadas e agrupa pelo estabelecimento", () => {
    expect(groceryStore("Mercado Tauste")).toEqual({ key: "tauste", name: "Tauste" });
    expect(groceryStore("Supermercado - Tauste")).toEqual({ key: "tauste", name: "Tauste" });
    expect(groceryStore("supermercado tauste")).toEqual({ key: "tauste", name: "Tauste" });
    expect(groceryStore("Supermercado Assai")).toEqual({ key: "assai", name: "Assai" });
    expect(groceryStore("SUPERMERCADO ASSAÍ")?.key).toBe("assai");
    expect(groceryStore("Super Mercado Assaí")).toEqual({ key: "assai", name: "Assaí" });
    expect(groceryStore("Mercado do Zé")).toEqual({ key: "ze", name: "Zé" });
  });

  it("reconhece redes conhecidas sem a palavra mercado e ignora o restante da descrição", () => {
    expect(groceryStore("Assaí Atacadista")).toEqual({ key: "assai", name: "Assaí" });
    expect(groceryStore("Assaí compra do mês")).toEqual({ key: "assai", name: "Assaí" });
    expect(groceryStore("Pão de Açúcar")?.key).toBe("pao de acucar");
  });

  it("aceita mercado sem estabelecimento", () => {
    expect(groceryStore("Mercado")).toEqual({ key: "", name: "" });
    expect(groceryStore("Supermercado - ")).toEqual({ key: "", name: "" });
  });

  it("não confunde com outras despesas", () => {
    for (const description of ["Mercado Livre", "Pagamento Mercado Pago", "Jantar", "Uber", "Mercadoria loja", "Supermarket"])
      expect(groceryStore(description), description).toBeNull();
  });
});

describe("grocerySummary", () => {
  it("soma o mês, o mês anterior, a média dos meses completos e cada estabelecimento", () => {
    const entries = [
      expense("Mercado Tauste", 30000, "2026-09-03"),
      expense("Supermercado Assai", 50000, "2026-09-20"),
      expense("Supermercado - Tauste", 40000, "2026-10-05"),
      expense("Jantar", 99999, "2026-10-06"),
      expense("Assaí", 20000, "2026-11-02"),
      expense("Acerto", 12345, "2026-11-03", "settlement"),
      expense("Mercado Tauste", 70000, "2026-12-01"),
    ];
    expect(grocerySummary(entries, "2026-11")).toEqual({
      month: "2026-11",
      thisMonth: 20000,
      lastMonth: 40000,
      average: 60000,
      averageMonths: 2,
      since: "2026-09",
      stores: [
        { key: "tauste", name: "Tauste", total: 70000, count: 2 },
        { key: "assai", name: "Assaí", total: 70000, count: 2 },
      ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    });
  });

  it("conta meses sem mercado como zero e limita a média à janela", () => {
    const entries = [
      expense("Mercado", 100000, "2025-01-10"),
      expense("Mercado", 60000, "2026-08-10"),
      expense("Mercado", 30000, "2026-10-10"),
    ];
    const summary = grocerySummary(entries, "2026-11", 3)!;
    expect(summary.since).toBe("2026-08");
    expect(summary.averageMonths).toBe(3);
    expect(summary.average).toBe(30000);
    expect(summary.stores).toEqual([{ key: "", name: "", total: 90000, count: 2 }]);
  });

  it("sem meses completos não inventa média", () => {
    const summary = grocerySummary([expense("Mercado Tauste", 25000, "2026-11-01")], "2026-11")!;
    expect(summary.average).toBeNull();
    expect(summary.averageMonths).toBe(0);
    expect(summary.thisMonth).toBe(25000);
  });

  it("sem despesas de mercado não há resumo", () => {
    expect(grocerySummary([expense("Jantar", 1000, "2026-11-01")], "2026-11")).toBeNull();
    expect(grocerySummary([expense("Mercado", 1000, "2026-12-01")], "2026-11")).toBeNull();
    expect(grocerySummary([], "2026-11")).toBeNull();
  });
});
