# Publicação

Este guia descreve o procedimento. Revisar/documentar o projeto não publica uma versão nem altera banco remoto.

## Preparação

1. Use o projeto Vercel existente e preserve o domínio configurado nos redirects. O projeto usa Vite, `npm run build` e saída `dist/`, conforme `vercel.json`.
2. Confira as variáveis de ambiente do destino: `VITE_STORAGE_MODE=cloud`, `VITE_SUPABASE_URL` HTTPS e `VITE_SUPABASE_PUBLISHABLE_KEY` pública `sb_publishable_…`. Vite incorpora essas variáveis no build; mudar apenas o ambiente do preview não reconfigura um bundle pronto.
3. Use [authentication.md](authentication.md) para schema, redirects, confirmação de e-mail e SMTP. Uma atualização comum do frontend não exige recriar o banco.
4. Execute `npm run verify`. Para validar comportamento cloud, use também um ambiente de teste configurado; o build pode compilar mesmo sem uma configuração de conta utilizável.
5. Se o último comando foi `build:local` ou `preview:local`, gere novamente o build com ambiente cloud correto. `dist` local é para revisão e não deve ser enviado aos usuários.

No fluxo Git da Vercel, publique pela branch já configurada no projeto. Não mude branch/domínio/proteção por inferência. Uma execução do harness não precisa de credenciais de publicação.

## Após publicar

- Confira login, primeiro carregamento e gravação/reabertura com conta de teste autorizada.
- Confira que `/sw.js` é servido com os headers de cache de `vercel.json` e que o manifesto/ícones são encontrados.
- Mantenha uma janela na versão anterior e confira o aviso de atualização e o carregamento da nova versão, com dados preservados.
- Abra uma vez online no dispositivo de teste e confira reabertura offline. Sem cache prévio, o primeiro acesso offline não é garantido.
- Confirme que prévias/versões históricas mantêm a proteção definida na hospedagem. Não presuma que uma configuração documentada comprova o estado remoto atual.

## Recuperação

Mantenha versões de publicação recuperáveis. Um rollback do frontend deve respeitar a compatibilidade do schema/dados; não reverta ou limpe IndexedDB/contas como medida automática. Se houver falha, preserve registros e backups antes de qualquer recuperação. O app não faz migrações destrutivas na inicialização.

Backups incluem valores reais. Não os envie para o repositório ou como artefatos públicos de CI.
