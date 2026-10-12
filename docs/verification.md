# Verificação e harness

## Gate local

```sh
npm ci
npm run verify
```

`verify` interrompe no primeiro erro: Vitest → testes do harness → TypeScript/build → inspeção do build. Não faz deploy, não usa contas reais nem executa SQL remoto. O build mantém o modo definido no ambiente; testes do app usam fixtures/mocks.

`check:build` exige `dist/` gerado. Confere shell, manifesto, versão injetada no worker, JS/CSS, presença de **todos** os arquivos no precache, ausência de URLs inesperadas/repetidas e existência dos ícones. Não executa o worker, não chama rede e não comprova headers HTTP, instalação real ou funcionamento offline. Os testes do próprio checker usam diretórios temporários e incluem chunk lazy omitido, asset removido, worker de desenvolvimento, URL externa e ícone ausente.

## Cobertura existente

| Suíte | Evidência | Limite |
|---|---|---|
| `domain/finance.test.ts` | Centavos, meses, orçamento, reserva, objetivos e ledger. | Não renderiza telas. |
| `storage.test.ts` | Validação, exportação/importação e casos de backup inválido. | Não comprova download salvo pelo usuário. |
| `storage.integration.test.ts` | Transações, reabertura, falhas e conflitos usando fake-indexeddb. | Não mede quota/evicção de um navegador real. |
| `sync/sync.test.ts` | Mesclagem, partições, exclusões, pendências, sessão incorreta, mensagens seguras, pendência real e correção gradual. | Rede/RPC são simuladas; não valida o Supabase publicado. |
| `auth/*.test.*` | Configuração pública, formulários, callback e ciclo de sessão. | Não comprova envio de e-mails nem a política real do projeto. |
| `first-use`, `dashboard`, `ux`, `privacy`, `theme`, `refinements` | Estados vazios, cálculos, filtros cronológicos, concorrência, recuperação, gravação ocupada, erros acessíveis, backup, preferências e ocultação. | jsdom não verifica layout, contraste, toque ou teclado virtual. |
| `splits/domain.test.ts` | Cotas em centavos e sobras, 50/50, uma pessoa, selecionados, saldos, compensação, efeito por lançamento, gasto e cota por pessoa, acertos totais/parciais e validações. | Não renderiza telas. |
| `splits/repository.test.ts` | Armazenamento local próprio e ilegível preservado; chamadas cloud sem ID de dono, sessão de outra conta, mensagens seguras e resposta malformada. | Cliente Supabase simulado. |
| `splits/splits.test.tsx` | Fluxo criar grupo → despesa → quem deve a quem → acerto/edição/exclusão, data, totais, histórico por mês, busca, ícone pela descrição, convite, olho fechado e ausência de gravação/leitura cruzada com as finanças. | jsdom; não verifica layout. |
| `notifications.test.ts`, `ux` | Regra do lembrete, inscrição/remoção do dispositivo, conta fixada, textos de Divisões com a mesma cota da tela, cifragem RFC 8291 aberta pelo lado do navegador, assinatura VAPID e seção de Configurações. | APIs de push simuladas; não comprova a entrega pelo navegador/sistema nem a Edge Function publicada. |
| `supabase/notifications.security.test.sql` | Só a conta grava seus dispositivos e só pelas funções; endereços fora dos serviços de push negados; lembrete reivindicado uma vez; mês completo suprimido; destinos sem o autor; lançamentos preservados com o gatilho. | Execução separada em banco de teste; não chama a função nem envia notificações. |
| `pwa.test.ts` | Registro/atualização e worker em ambiente simulado, incluindo versões/cache. | Não prova comportamento no Safari/Chrome instalado. |
| `supabase/security.test.sql` | Acesso anônimo negado, isolamento, escrita direta negada e revisões antigas. | Execução separada em banco de teste; não integra `npm test`. |
| `supabase/splits.security.test.sql` | Só participantes leem/gravam; convite por código; escrita direta e lançamentos inválidos negados; `financial_sync` intocada. | Execução separada em banco de teste; não integra `npm test`. |

Testes relacionados podem ser executados pelos scripts `test:domain`, `test:storage`, `test:sync`, `test:auth`, `test:ui`, `test:pwa` e `test:splits`. Não há cobertura de navegador automatizada nem CI hospedado configurado neste repositório. Um runner de CI pode usar o mesmo `npm ci` + `npm run verify`, sem segredos do Supabase.

## Roteiro manual local

Use `npm run dev:local`, com origem e dados fictícios. Exemplos: salário R$ 3.000,00, gasto R$ 500,00, saldo inicial R$ 1.000,00, aporte R$ 200,00, retirada R$ 100,00 e rendimento −R$ 10,00. A reserva resultante deve ser R$ 1.090,00. Não copie dados pessoais para screenshots, testes ou logs.

| Fluxo | Conferir |
|---|---|
| Primeiro uso | Cinco telas vazias; primeiros registros orientados; nenhum seed. |
| Salário | Salvar/editar/zero; rejeitar vazio, texto inválido e negativo; conferir mês e sugestão. |
| Orçamento | Fixo/variável, mensal/semanal/diário, fator inteiro; totais, filtro e cópia do mês anterior. |
| Reserva planejada | Afeta livre previsto; não cria aporte nem muda saldo real. |
| Movimentações | Primeiro local → formulário de valor; saldo inicial único; perdas; datas; retirada acima do saldo bloqueada. |
| Objetivos | Destinar sem criar dinheiro; impedir soma acima do saldo; editar/excluir preservando reserva. |
| Histórico | Ano sem registros visível no filtro; mudança de ano acompanha o cabeçalho, preservando “Todos”. Gráfico: 1/3 anos contam 12/36 meses até o mês escolhido, inclusive, sem preencher lacunas. |
| Privacidade | Cinco telas com olho fechado; gráficos/números sensíveis ocultos; modais editáveis e erros operacionais legíveis sem revelar identificadores do backup. |
| Teclado | Foco inicial, Tab/Shift+Tab no modal, Escape, retorno ao botão e gráfico por setas/Home/End. |
| Persistência | Recarregar/reabrir; editar gasto na aba A, excluir na B e salvar na A: manter rascunho e explicar o erro. Simular save lento/falho: uma gravação, controles bloqueados durante o commit e reabilitados após erro. |
| Backup | Exportar fictício: feedback de download iniciado; se a data não puder ser gravada, indicar os dois resultados. Restaurar válido com confirmação; rejeitar JSON inválido/arquivo acima de 20 MiB. Recuperação inicial: local oferece restore; cloud orienta abrir a conta antes. Legado pendente permite confirmar o saldo uma vez. |
| Divisões | Criar grupo, adicionar Bia e Caio, despesa de R$ 100,00 entre todos: Bia e Caio devem R$ 33,33 cada. Acerto parcial e total, edição e exclusão recalculam o resumo. Uma despesa com data de outro mês aparece sob o mês certo; totais, "você recebe/deve" por linha e busca conferem com o resumo, inclusive com o olho fechado. Salário, orçamento e reserva não mudam. Barra inferior com cinco itens e Configurações no cabeçalho em 320/390 px. |
| Notificações | Interruptores independentes; a grade de dias aparece só com o lembrete ligado; 320/390 px, claro/escuro e teclado. Local: dia de hoje sem salário/orçamento gera um lembrete, sem repetir ao recarregar. Cloud de teste configurado conforme [notifications.md](notifications.md), com duas contas e o app **fechado**: despesa, edição, exclusão e acerto chegam ao outro participante com os valores corretos e não ao autor; o clique abre o grupo; sair da conta encerra os avisos no dispositivo. Permissão bloqueada mostra a orientação. |
| Aparência | Claro/escuro; 320/390 px e desktop; nomes/notas longos, valores grandes, mensagens e rolagem. |

Após editar campos, clique fora não fecha o modal. Cancelar, X e Escape continuam descartando o rascunho; durante gravação, o fechamento e os campos ficam bloqueados. Não há uma confirmação adicional de descarte. Para backup, somente use arquivos fictícios em uma origem de teste.

## PWA no navegador

Use `npm run preview:local`. O preview recompila `dist` como local; não publique esse artefato.

1. Abra online e espere o worker instalar. Confira arquivos em Cache Storage e o controlador.
2. Cadastre dados fictícios, recarregue e feche/reabra.
3. Ative offline em DevTools e recarregue. Confira as cinco telas e uma gravação; retorne online.
4. Para uma atualização real, mantenha um shell antigo aberto, sirva um segundo build com algum asset diferente na mesma origem e confirme o aviso/ação de atualização. Um build idêntico não gera uma nova versão.
5. Confira que o IndexedDB persiste após trocar o worker, e que chunks lazy funcionam offline.
6. Verifique instalação e teclado virtual em navegador/dispositivo real quando o escopo da alteração depender disso.

## Supabase em ambiente de teste

Configure um projeto de teste conforme [authentication.md](authentication.md), com duas contas fictícias. Verifique cadastro/confirmar/reenviar, login, recuperação, callbacks inválidos, duas contas no mesmo navegador e dois dispositivos com edições offline. Depois confira convergência, exclusões, pendências e correção do saldo em conflito.

Execute `supabase/security.test.sql`, `supabase/splits.security.test.sql` e `supabase/notifications.security.test.sql` após os schemas no projeto de teste. Para Divisões, confira também com duas contas: convite por link/código, a mesma despesa visível para ambas e uma terceira conta sem acesso. Cada script usa uma transação com fixtures e termina em `ROLLBACK`. Se o editor interromper na primeira falha, finalize a transação com `ROLLBACK` antes de repetir. Não automatize com credenciais de produção.

## Como registrar resultados

Registre revisão/commit, ambiente, comando/fluxo, resultado e limitações. “Testes passaram” significa apenas a suíte executada. Um achado confirmado no código, mas não reproduzido em navegador real, deve manter essa distinção. O mapa inicial está em [review-2026-10-05.md](review-2026-10-05.md).
