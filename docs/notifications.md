# Notificações

Dois avisos opcionais, ligados separadamente em Configurações → Notificações e válidos para o dispositivo em que foram ativados:

- **Lembrete do mês:** no dia escolhido, a partir das 9h do fuso do dispositivo, um aviso para lançar o salário e montar o orçamento. Em meses mais curtos vale o último dia. Não é enviado se o mês já tiver salário e orçamento.
- **Divisões:** quando outra pessoa adiciona, edita ou exclui uma despesa ou um acerto em um grupo seu. O texto traz grupo, quem lançou, descrição, valor e quanto você deve ou recebe.

No modo cloud os avisos são notificações push: chegam com o app fechado. No modo local há somente o lembrete, verificado enquanto o app está aberto.

## Configuração (uma vez por projeto)

Sem estes passos o app continua funcionando; a seção apenas informa que os avisos não estão disponíveis.

1. **Gere o par de chaves VAPID** em qualquer terminal. Guarde as duas; a privada nunca vai para o repositório nem para a Vercel.

   ```sh
   npx web-push generate-vapid-keys
   ```

2. **Escolha um segredo** longo e aleatório para o banco chamar a função, por exemplo `openssl rand -hex 32`.

3. **Publique a Edge Function** `supabase/functions/push`, sem verificação de JWT (ela confere o segredo do passo 2). Com o Supabase CLI:

   ```sh
   npx supabase login
   npx supabase functions deploy push --no-verify-jwt --project-ref <ref-do-projeto>
   npx supabase secrets set --project-ref <ref-do-projeto> \
     VAPID_PUBLIC_KEY=<chave pública> \
     VAPID_PRIVATE_KEY=<chave privada> \
     VAPID_SUBJECT=mailto:<seu e-mail> \
     PUSH_SECRET=<segredo do passo 2>
   ```

   Pelo painel também funciona: Edge Functions → Deploy a new function, com os três arquivos da pasta, "Verify JWT" desligado, e os quatro valores em Secrets.

4. **Guarde no Vault** o endereço da função e o mesmo segredo, no SQL Editor:

   ```sql
   select vault.create_secret('https://<ref-do-projeto>.supabase.co/functions/v1/push', 'push_function_url');
   select vault.create_secret('<segredo do passo 2>', 'push_secret');
   ```

5. **Execute `supabase/notifications.sql`** no SQL Editor, depois de `schema.sql` e `splits.sql`. O script ativa `pg_net` e `pg_cron`, cria a tabela de dispositivos, o gatilho de Divisões e a verificação horária do lembrete. Pode ser executado novamente.

6. **Configure `VITE_VAPID_PUBLIC_KEY`** (a chave pública) na Vercel, nos mesmos ambientes das outras variáveis, e publique. A variável entra no build; é preciso publicar de novo depois de defini-la.

7. **Ative no dispositivo:** abra o app publicado, Configurações → Notificações, ligue as opções e permita as notificações. No iPhone/iPad (iOS 16.4+), instale antes o app na tela inicial e abra por esse ícone. No Android e no computador, o navegador precisa ter permissão de notificação no sistema.

Para testar: ligue o lembrete escolhendo o dia de hoje (ou um dia anterior) em um mês sem salário ou orçamento; o aviso chega na próxima verificação, no minuto 5 de cada hora, depois das 9h. Para Divisões, lance uma despesa com outra conta do grupo: o aviso chega em segundos.

Se nada chegar, veja os logs da função (Edge Functions → push → Logs, uma linha `{"sent","expired","failed"}` por envio) e a tabela `net._http_response` para a resposta das chamadas do banco. Trocar as chaves VAPID invalida as inscrições existentes: cada dispositivo precisa desligar e ligar as opções.

## Como funciona

- `src/notifications.ts` inscreve o navegador no serviço de push (`PushManager`) e grava a inscrição e as preferências na conta com `push_subscribe`; ao desligar tudo ou sair da conta, `push_unsubscribe`. A preferência fica em `localStorage` (`cash-tracker-notifications`), fora do backup e do sync financeiro. Ao abrir o app, a inscrição é renovada e o mês com salário e orçamento é informado para suprimir o lembrete em todos os dispositivos da conta.
- `push_subscriptions` não tem policies: a conta só grava pelas funções, que identificam o dono por `auth.uid()`, e nunca lê a tabela. O endereço precisa ser de um serviço de push conhecido (Google, Apple, Mozilla, Microsoft). O servidor não lê `financial_sync`.
- O gatilho em `split_entries` e o `pg_cron` chamam `push_send`, que envia o trabalho à Edge Function por `pg_net`, com o segredo do Vault. Sem os segredos nada é enviado, e nenhuma falha desse caminho desfaz o lançamento.
- A função lista os destinos com a service role (`push_claim_reminders`, `push_split_targets`), monta o texto de cada pessoa (`messages.ts`), cifra e envia (`webpush.ts`, RFC 8291/8292 com Web Crypto) e apaga inscrições expiradas (`push_forget`). Quem fez o lançamento não é avisado, em nenhum dos seus dispositivos.
- `public/sw.js` mostra a notificação (`push`) e, no clique, foca ou abre o app na tela relacionada (`notificationclick` → `OPEN_HASH`).

## Limites

- **Privacidade:** as notificações de Divisões mostram valores na tela do dispositivo, inclusive bloqueada, e não seguem o olho. O conteúdo é cifrado de ponta a ponta entre a função e o navegador.
- A entrega depende do serviço de push do navegador e do sistema (economia de bateria, modo foco, permissões). Mensagens ficam retidas por até 24 horas com o dispositivo offline.
- O lembrete é reivindicado antes do envio para não repetir; uma falha de entrega naquele momento não é reenviada no mês.
- Divisões no modo local não notificam: não há outras contas.
