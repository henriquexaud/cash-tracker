# Arquitetura e regras

## Mapa do código

| Caminho | Responsabilidade |
|---|---|
| `src/main.tsx`, `src/config.ts` | Tema inicial, privacidade, seleção local/cloud e registro da PWA. |
| `src/App.tsx` | Navegação por hash, mês selecionado, carregamento, mutações, modais, backup e avisos. |
| `src/Pages.tsx`, `src/components/` | Cinco telas, gráficos, histórico, formulários e controles. |
| `src/domain/types.ts`, `finance.ts`, `empty.ts` | Modelo, centavos, cálculos/validações e estado inicial vazio. |
| `src/repository.ts`, `src/storage.ts` | Contrato do repositório, IndexedDB local e formato de backup. |
| `src/auth/` | Login/recuperação, identidade offline e repositório cloud. |
| `src/sync/` | Cache por conta, revisões por registro e materialização da mesclagem. |
| `src/privacy.tsx`, `src/theme.ts`, `src/styles.css` | Preferências do dispositivo, apresentação e responsividade. |
| `public/sw.js`, `vite.config.ts` | Shell offline, atualização e injeção do precache no build. |
| `supabase/schema.sql`, `security.test.sql` | Documento privado por usuário, RPC de mesclagem e teste SQL. |
| `scripts/` | Harness local e inspeção dos artefatos; não entra no bundle. |

## Modelo financeiro

`AppData` mantém `schemaVersion: 1`, salários, orçamentos mensais, base compatível com backups antigos, locais, movimentações, objetivos, legado e data do último backup. Mês usa `AAAA-MM`; data usa `AAAA-MM-DD`. Valores são inteiros em centavos.

- Há um salário por mês. Valor zero é válido.
- Gasto previsto = `unitAmount × factor`. A frequência é um rótulo; o fator explícito determina o total. Os defaults de 4 semanas/30 dias são estimativas ajustáveis.
- Livre previsto = salário − gastos aproximados − reserva planejada. Sem orçamento confirmado, uma base existente pode ser mostrada como estimativa, sem criar um registro mensal.
- Reserva = saldos iniciais + aportes + rendimentos − retiradas. O total de saldo é de todo o histórico, incluindo lançamentos futuros; “guardado no mês” filtra o mês selecionado e considera aportes − retiradas.
- Rendimentos aceitam perdas negativas. Movimentações comuns exigem valor diferente de zero; saldo inicial pode ser zero.
- Cada local tem no máximo um saldo inicial. O ledger é validado por data, agrupando lançamentos do mesmo dia, e não pode ficar negativo.
- Objetivos destinam saldo existente. A soma destinada não pode superar o saldo do local. A meta deve ser positiva; o modelo atual permite destinação acima da meta.
- Registros com `datePrecision: "month"` usam o primeiro dia apenas para ordenação e são apresentados como mês, sem afirmar um dia conhecido.

`validateBackup` reconstrói campos conhecidos e valida estrutura, duplicatas, referências e integridade financeira. Dados sincronizados podem preservar conflitos financeiros para correção explícita; isso não autoriza ignorar erros estruturais.

## Caminho de uma gravação

1. O formulário valida o texto e converte dinheiro para centavos.
2. `App.mutate` impede commits simultâneos na mesma instância e usa Web Locks quando disponível.
3. O app relê o estado, aplica a transformação sobre uma cópia e valida o candidato. Edição de gasto ausente no orçamento atual falha sem ressuscitar o registro nem descartar o formulário.
4. O repositório confirma a transação IndexedDB antes de resolver `save`.
5. A interface atualiza os dados e emite feedback; BroadcastChannel informa outras abas. No modo cloud, a rede é tentada separadamente.

No modo local, `cash-tracker/state/current` guarda `{ revision, data }`. A revisão detecta escrita desatualizada entre abas. Leituras ilegíveis falham; não são convertidas em banco vazio. Uma gravação abortada preserva a versão anterior.

No modo cloud, `cash-tracker-accounts/accounts` usa a chave `[URL do projeto, UUID do usuário]`, com documento, pendência e offset do relógio. `applyEdit` altera a revisão apenas dos registros modificados. A RPC mescla atomicamente a linha do usuário; revisões antigas não sobrescrevem novas e tombstones preservam exclusões.

`materialize` reconstrói `AppData`, preserva relações e permite detectar conflitos financeiros em `needsReview`. Correções graduais podem resolver uma conta por vez. O repositório expõe status, pendência de envio e mensagem operacional segura separadamente. Falha de atualização não implica edições pendentes; uma releitura do cache não apaga o erro de sync. Há tentativa de sync ao abrir, salvar, reconectar, focar/retornar à janela e a cada 15 segundos enquanto visível. Veja [authentication.md](authentication.md) para sessões, relógios, conflitos e limites.

## Preferências e modais

Tema, ocultação e identidade offline usam chaves próprias em localStorage. Tema/ocultação são por dispositivo e não integram o backup. A identidade só permite abrir o cache local; não substitui a autorização do servidor.

O `Modal` é um portal com foco inicial, contenção do foco, retorno ao disparador e bloqueio de rolagem do corpo. Seu contexto de privacidade revela os campos do diálogo sem mudar a preferência da tela. As telas principais escondem dinheiro, gráficos e outros campos definidos no contrato de [privacidade](authentication.md#privacidade-na-interface).

O contexto compartilhado `SavingContext` chega também aos portais e modais guardados em estado. Campos, salvar/confirmar e fechar ficam bloqueados durante o commit; o botão indica a ação em andamento. A validação associa o erro ao campo com `aria-invalid`/`aria-describedby`, preserva a dica e limpa a mensagem ao editar o campo responsável. Erros gerais são limpos na próxima edição.

Um clique fora não descarta campos editados. Cancelar, X e Escape mantêm o fechamento explícito, sem confirmação extra. Mensagens operacionais seguras continuam legíveis com o olho fechado; caminhos de erro do backup não interpolam IDs fornecidos pelo arquivo.

## Histórico

Os filtros salarial e de orçamento incluem o ano selecionado mesmo sem registros. Ao mudar o ano no cabeçalho, um filtro de ano específico acompanha a mudança; “Todos os anos” permanece selecionado. O gráfico salarial usa uma janela de 12/36 meses até o mês do cabeçalho, inclusive, ou todo o histórico. Meses ausentes não geram salários artificiais.

A cor do gasto deriva do ID, usando a paleta existente, e não do índice após ordenar/filtrar. O progresso de um objetivo limita a barra acessível à meta e descreve a destinação monetária integral quando a meta é superada.

## Backup e compatibilidade

O envelope JSON usa `format: "cash-tracker"`, `version: 1`, `exportedAt` e `data`. A restauração valida antes de gravar e tenta baixar uma cópia do estado anterior. Na recuperação de leitura local, se o estado voltar a abrir, falha ao gerar essa cópia impede a substituição. Download disparado pelo navegador não é confirmação de que o usuário conservou o arquivo. A geração ocorre depois de validar o candidato e antes de gravar a data da exportação; se essa gravação falhar, o aviso informa que o download iniciou e que a data não foi atualizada.

Uma exportação de estado financeiro conflitante pode conter `requiresReview: true`; a restauração continua exigindo integridade financeira. O histórico legado e a base existem por compatibilidade. Novas contas não recebem uma planilha nem dados de exemplo. Legado pendente apresenta “Conferir saldo da planilha” em Reserva, usando o formulário existente; sem local, o fluxo pede primeiro seu nome. A confirmação grava um único saldo inicial e preserva os valores antigos sem somá-los novamente.

Na falha de carregamento inicial, restauração direta está disponível apenas no modo local. No modo cloud, é preciso abrir a conta/cache antes de restaurar em Configurações; esse pré-requisito preserva a mesclagem por registro.

## PWA e build

O plugin `offlineAssets` percorre `dist`, calcula uma versão a partir do worker/arquivos e injeta a lista de assets, incluindo chunks lazy. O worker instala o lote completo, recusa HTML no lugar de JS/CSS e mantém versões anteriores para a troca de shell. Requisições de outros domínios não são tratadas pelo cache do app.

Uma nova versão aguarda a ação “Atualizar”; `controllerchange` recarrega uma página já controlada. Esse fluxo e a preservação de dados no IndexedDB precisam ser conferidos no navegador, além dos testes simulados.
