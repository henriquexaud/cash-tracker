# Cash Tracker

Aplicação para registrar manualmente quanto entrou, os gastos aproximados do mês e quanto foi guardado de fato. Sem conexão com bancos ou importação automática de dados financeiros.

## Funcionalidades

- Visão geral do mês, orçamento, histórico de salários e reserva.
- Locais de reserva, aportes, retiradas, rendimentos e objetivos.
- Cadastro, confirmação de e-mail, login e recuperação de senha pelo Supabase.
- Dados separados por conta, gravação offline e sincronização entre dispositivos.
- Temas claro e escuro, ocultação de valores e guia rápido no primeiro uso.
- Backup e restauração em JSON, com validação antes de substituir os registros.

Toda instalação e conta nova começa vazia. O código não contém salários, gastos, saldos ou dados pessoais de usuários. Testes usam apenas dados fictícios.

## Desenvolvimento

Requer Node.js 22 ou superior.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Configure `.env.local` com a URL e a chave publicável do seu projeto Supabase. Senhas, chaves secretas e backups pessoais não devem entrar no repositório.

Para desenvolvimento sem autenticação, use `VITE_STORAGE_MODE=local`. Esse modo começa vazio e grava apenas neste navegador; não sincroniza contas. A publicação para usuários deve usar `cloud`, que é o padrão.

```sh
npm test
npm run build
```

## Publicação

Use o projeto existente na Vercel, com `npm run build` e saída `dist`. Configure as variáveis nos ambientes que devem acessar o serviço:

| Variável | Valor |
|---|---|
| `VITE_STORAGE_MODE` | `cloud` |
| `VITE_SUPABASE_URL` | URL HTTPS do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública `sb_publishable_…` |

Conecte o repositório GitHub ao projeto da Vercel para publicar os próximos commits da branch `main`. Mantenha o domínio já configurado para preservar os links de confirmação e recuperação.

Em uma instalação nova, execute `supabase/schema.sql` no SQL Editor e configure as URLs de autenticação. Para o projeto já configurado, uma atualização do app não exige recriar tabelas ou importar dados.

O domínio principal pode ser público: a autorização dos dados fica no Supabase. Mantenha as publicações antigas e as prévias protegidas. Consulte [contas e sincronização](docs/authentication.md) para configuração, funcionamento offline e limites.

## Estrutura

- `src/domain`: tipos, cálculos em centavos e dados iniciais vazios.
- `src/auth`: autenticação e repositório por conta.
- `src/sync`: cache IndexedDB, revisões e mesclagem.
- `src/components`: formulários e controles compartilhados.
- `src/test`: exemplos fictícios usados exclusivamente pelos testes.
- `supabase`: esquema e verificações de isolamento.
