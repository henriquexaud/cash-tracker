# Desenvolvimento

## Ambiente

Use npm e o `package-lock.json`. O lockfile atual exige, por dependências de teste, Node **22.22.2+ na linha 22**, **24.15.0+ na linha 24** ou **26+**. A referência em `.nvmrc` é 22.22.2. Com nvm:

```sh
nvm install
nvm use
npm ci
```

Não é necessário configurar Supabase para trabalhar no modo local. Não execute `npm install` apenas para abrir o projeto: isso pode atualizar a resolução das dependências.

## Revisão local sem autenticação

```sh
npm run dev:local
```

Abra `http://127.0.0.1:5174`. O script força `VITE_STORAGE_MODE=local` apenas no processo e usa loopback. Ele não edita arquivos de ambiente nem usa o repositório cloud, mesmo se `.env.local` estiver configurado. A origem tem armazenamento independente do domínio publicado. A primeira abertura começa vazia; reabrir a mesma origem preserva os dados fictícios que você cadastrou nela.

Se a porta estiver ocupada, o comando falha em vez de escolher outra silenciosamente. Para escolher outra:

```sh
npm run dev:local -- --port 5175
```

Trocar entre `localhost`, `127.0.0.1` ou portas muda a origem e, portanto, o armazenamento. Isso pode parecer perda de dados; confira a URL antes de concluir que houve falha.

## Build e PWA locais

O servidor de desenvolvimento não registra o service worker. Para testar instalação, cache offline e recarregamento do shell:

```sh
npm run preview:local
```

Esse comando verifica TypeScript, recompila **`dist/` em modo local** e abre o preview em `http://127.0.0.1:4174`. Alterar a variável só no preview não mudaria o modo de um bundle já compilado; por isso a recompilação é obrigatória nesse script. Ele não publica nada. Para gerar somente o build local, use `npm run build:local`.

Antes de publicar, gere novamente um build cloud; nunca envie o `dist/` deixado por esses comandos. Veja [deployment.md](deployment.md).

## Desenvolvimento com autenticação

Copie `.env.example` para `.env.local` se ainda não existir e preencha as variáveis com um **projeto de teste**. Não sobrescreva uma configuração existente. Use chave publicável `sb_publishable_…`, nunca chave secreta. Configure schema e redirects conforme [authentication.md](authentication.md).

```sh
npm run dev
```

O comando original mantém `--host 0.0.0.0`, permitindo acesso pela rede local. Consulte a URL indicada pelo Vite. Primeiro login, confirmação, recuperação e sincronização exigem internet. O modo padrão é cloud quando `VITE_STORAGE_MODE` não é `local`.

## Comandos de verificação

| Comando | Objetivo |
|---|---|
| `npm run typecheck` | TypeScript sem gerar bundle. |
| `npm test` | Todos os testes Vitest existentes. |
| `npm run test:watch` | Vitest durante a edição. |
| `npm run test:domain` / `test:storage` / `test:sync` | Testes da camada de dados afetada. |
| `npm run test:auth` / `test:ui` / `test:pwa` | Testes dos fluxos e controles afetados. |
| `npm run test:harness` | Verificar o próprio checker com artefatos fictícios. |
| `npm run build` | TypeScript e build no modo configurado no ambiente. |
| `npm run check:build` | Conferir arquivos e precache do `dist` existente. |
| `npm run verify` | Testes do app/harness, TypeScript/build e check do build, em sequência. |

Para um caso específico: `npm test -- src/ux.test.tsx -t "entrada de valores"`. Os testes usam mocks/fixtures, sem contas de produção; seus limites estão em [verification.md](verification.md).

## Diagnóstico

- **Tela de configuração de conta:** no modo cloud, faltam URL/chave válidas. Para uma revisão sem conta, use `dev:local`.
- **Dados diferentes em duas janelas:** confirme origem, modo, conta e projeto; são partições diferentes.
- **Interface antiga no preview:** confira o aviso de atualização e o worker ativo. Um worker anterior pode manter um shell cloud mesmo depois de recompilar como local. Para verificar o build sem interferência, use uma porta de teste nova: `npm run preview:local -- --port 47829`. Para limpar cache em DevTools, use apenas a origem de teste; IndexedDB e Cache Storage são armazenamentos distintos.
- **“Outra aba” ou banco bloqueado:** feche abas da mesma origem e tente novamente. Não apague o banco como primeira medida.
- **Sem internet no primeiro acesso cloud:** abra a conta online uma vez. Uma identidade salva não cria uma cópia offline que nunca foi preparada.
- **Sem permissão para abrir uma porta no ambiente de execução:** permita o servidor local no ambiente ou execute o comando em um terminal autorizado. Isso é separado de erro do app.
