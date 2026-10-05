# Cash Tracker

Aplicação para registrar manualmente quanto entrou, os gastos aproximados do mês e quanto foi guardado de fato. Sem conexão com bancos ou importação automática de dados financeiros.

## Funcionalidades

- Visão geral do mês, orçamento, histórico de salários e reserva.
- Locais de reserva, aportes, retiradas, rendimentos e objetivos.
- Cadastro, confirmação de e-mail, login e recuperação de senha pelo Supabase.
- Dados separados por conta, gravação offline e sincronização entre dispositivos.
- Temas claro e escuro e ocultação de valores.
- Backup e restauração em JSON, com validação antes de substituir os registros.

Toda instalação e conta nova começa vazia. O código não contém salários, gastos, saldos ou dados pessoais de usuários. Testes usam apenas dados fictícios.

## Desenvolvimento

Use Node.js 22.22.2+ na linha 22, 24.15.0+ na linha 24 ou 26+, conforme as dependências do lockfile. `.nvmrc` fixa a referência 22.22.2.

```sh
npm ci
npm run dev:local
```

Abra `http://127.0.0.1:5174`. Esse ambiente usa dados locais, começa vazio e dispensa Supabase. O script força o modo local sem editar `.env.local`. Para conferir a PWA, use `npm run preview:local`, que recompila `dist/` em modo local antes de servir o preview em `http://127.0.0.1:4174`.

Para desenvolver com autenticação, copie `.env.example` para `.env.local` se ainda não existir, configure um projeto Supabase de teste e use `npm run dev`. Senhas, chaves secretas e backups pessoais não devem entrar no repositório. A publicação para usuários deve usar `cloud`, que é o padrão.

```sh
npm run verify
```

O harness executa testes do app e dos scripts, TypeScript/build e uma checagem do precache gerado. Também há comandos por suíte e `npm run typecheck`. Consulte [desenvolvimento](docs/development.md) e [verificação](docs/verification.md) para os checks manuais e seus limites.

## Publicação

Use o projeto existente na Vercel, com `npm run build` e saída `dist`. Configure as variáveis nos ambientes que devem acessar o serviço:

| Variável | Valor |
|---|---|
| `VITE_STORAGE_MODE` | `cloud` |
| `VITE_SUPABASE_URL` | URL HTTPS do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública `sb_publishable_…` |

Conecte o repositório GitHub ao projeto da Vercel para publicar os próximos commits da branch `main`. Mantenha o domínio já configurado para preservar os links de confirmação e recuperação.

Em uma instalação nova, execute `supabase/schema.sql` no SQL Editor e configure as URLs de autenticação. Para o projeto já configurado, uma atualização do app não exige recriar tabelas ou importar dados.

O domínio principal pode ser público: a autorização dos dados fica no Supabase. Mantenha as publicações antigas e as prévias protegidas. **Não publique o `dist/` de `build:local` ou `preview:local`; gere novamente com as variáveis cloud corretas.** Consulte [publicação](docs/deployment.md) e [contas e sincronização](docs/authentication.md) para configuração, funcionamento offline e limites.

## Estrutura

- `src/domain`: tipos, cálculos em centavos e dados iniciais vazios.
- `src/auth`: autenticação e repositório por conta.
- `src/sync`: cache IndexedDB, revisões e mesclagem.
- `src/components`: formulários e controles compartilhados.
- `src/test`: exemplos fictícios usados exclusivamente pelos testes.
- `supabase`: esquema e verificações de isolamento.
- `scripts`: ambiente local e inspeção/testes do build offline.
- `docs`: arquitetura, desenvolvimento, verificação, publicação e revisões.

## Documentação e manutenção

Comece pelo [índice da documentação](docs/README.md). O [AGENTS.md](AGENTS.md) orienta mudanças pequenas, preservação da simplicidade e validação de dados. A [revisão de 05/10/2026](docs/review-2026-10-05.md) registra os 12 achados e as correções verificadas.
