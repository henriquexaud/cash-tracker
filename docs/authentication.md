# Contas, dados offline e sincronização

O modo por conta usa Supabase Auth com e-mail e senha. Cada usuário possui um documento privado no banco; o servidor identifica o dono pelo token autenticado, sem aceitar um ID de dono enviado pelo navegador. A chave publicável identifica o projeto. Chaves secretas e senhas não entram no código nem no build.

## Ativar em outra instalação

1. Execute `supabase/schema.sql` no SQL Editor do seu projeto. O script cria apenas `financial_sync`, sua política de leitura e a função de mesclagem. Pode ser executado novamente.
2. Configure as três variáveis de `.env.example` no ambiente de build: `VITE_STORAGE_MODE=cloud`, URL HTTPS do projeto e chave `sb_publishable_…`. Configure também as variáveis na hospedagem; `.env.local` não é enviado pelo Git.
3. Em **Supabase → Authentication → URL Configuration**, defina **Site URL** com o domínio público do app e adicione esse domínio, incluindo a barra final, em **Redirect URLs**. Salve ambos. Adicione os endereços de desenvolvimento somente se usados; não deixe `http://localhost:3000` como Site URL de produção. A confirmação de cadastro e a recuperação usam esse endereço. Mantenha confirmação de e-mail habilitada para novos usuários e configure SMTP para enviar mensagens a usuários fora da organização/projeto. Modelos de e-mail devem usar `{{ .ConfirmationURL }}` para o link completo de confirmação.
4. Faça o build, teste o login e a PWA em ambiente de teste, publique e abra a versão publicada uma vez com internet em cada dispositivo. Confirme que o service worker instalou e controla a página; a interface atual de Configurações não mostra um indicador específico de cache offline pronto. Veja [verification.md](verification.md).

O modo `cloud` sem configuração válida bloqueia o acesso. O modo padrão exige autenticação configurada. Para desenvolvimento local sem autenticação, use `VITE_STORAGE_MODE=local`: ele começa vazio e não inclui dados de nenhum usuário.

Após criar a conta, o app mostra a etapa de confirmação, com opção de reenviar o link sem cadastrar novamente. No navegador que iniciou o cadastro, a confirmação válida abre a sessão automaticamente. Em outro navegador ou dispositivo, o e-mail continua podendo ser confirmado, mas a sessão PKCE não pode ser trocada sem o verificador original: o app orienta entrar com e-mail e senha. Links inválidos, expirados ou reutilizados recebem uma mensagem de recuperação sem expor detalhes do provedor; códigos e erros são removidos da URL. Recuperação de senha continua abrindo o formulário de nova senha após validação no navegador de origem.

## Levar os dados anteriores

Exporte um backup antes de mudar de modo. Depois de entrar, restaure seu próprio arquivo em **Configurações → Restaurar backup**. A restauração exige confirmação e exporta uma cópia do estado atual. Não há importação automática em contas novas nem acesso pela interface ao armazenamento antigo sem conta. Se os dados cloud ainda não abriram nesse dispositivo, conecte-se e conclua a abertura antes de restaurar; a recuperação inicial por arquivo é oferecida apenas no modo local.

O armazenamento antigo é preservado. O armazenamento por conta usa uma partição diferente, definida pela URL do projeto e pelo UUID da conta. Entrar em outra conta não carrega os dados da anterior. Backups são arquivos completos com os valores reais: o olho não altera o arquivo.

## O que funciona offline

Após o primeiro acesso online e o preparo da PWA, as cinco telas, consultas, lançamentos, edições, exclusões e backups funcionam sem internet. A gravação termina depois de confirmar uma transação local IndexedDB; nunca fica dependendo de uma resposta da rede. Fechar e reabrir preserva as edições pendentes.

A última identidade autenticada permite abrir a cópia offline mesmo depois de o token expirar. Ela não autoriza operações no servidor: o Supabase continua validando o token e o dono de cada chamada. Cadastro, primeiro login em um dispositivo, recuperação de senha e comunicação entre dispositivos exigem internet. Sem conexão, cada dispositivo tem sua última cópia; os outros só recebem as mudanças ao reconectar.

O navegador/instalação deve ser pessoal e protegido pelo bloqueio do dispositivo. Para permitir abertura offline automática, os dados e a sessão persistem no navegador; não há criptografia adicional do cache com uma senha de desbloqueio. O botão de olho protege a visualização, não o armazenamento, o acesso físico ao dispositivo ou ferramentas de desenvolvimento. Sair remove a cópia offline quando não há alterações aguardando envio. Edições pendentes impedem a saída com remoção para evitar perda de dados.

## Como os conflitos são resolvidos

Cada salário (por mês), local de reserva, movimentação, objetivo e item de orçamento tem uma revisão própria. Itens de orçamento são separados por mês e ID; a reserva planejada tem revisão separada. Preferências de backup e histórico importado também são preservados.

Só registros editados recebem nova revisão. A revisão contém o horário da edição, um contador monotônico e um identificador aleatório do dispositivo. O relógio é ajustado ao horário do servidor quando conectado. A última edição do mesmo registro vence, incluindo exclusões; em empate, o identificador resolve de forma determinística. Alterações em registros diferentes são combinadas. O horário de chegada da sincronização não torna uma edição antiga mais recente. Uma exclusão mantém um marcador para um dispositivo antigo não ressuscitar o registro.

O servidor trava a linha da conta durante a mesclagem. Repetir um envio é idempotente. Uma edição feita durante o envio permanece pendente até ser confirmada por uma resposta posterior. O token fica fixado na conta de origem da chamada, evitando enviar um documento antigo para uma nova conta durante troca de sessão.

Há tentativa de sincronização ao abrir, ao voltar à janela, ao reconectar, após salvar e a cada 15 segundos enquanto a janela está visível. Uma falha de rede mantém os dados locais. O aviso informa envio pendente apenas quando existem edições aguardando confirmação; falha sem essas edições é apresentada como atualização indisponível. Falhas de sessão usam uma orientação segura para entrar novamente. Não há fila financeira no service worker nem cache HTTP de respostas do Supabase.

Relógios muito incorretos em dispositivos que nunca se reconectaram podem alterar a ordem de duas edições offline independentes. Não existe garantia de ordem real entre dispositivos isolados sem uma referência de tempo; as revisões asseguram convergência e respeitam a ordem já observada. Mantenha data/hora automáticas nos dispositivos.

Duas retiradas offline diferentes podem, quando combinadas, exceder o saldo. O app preserva ambas e sinaliza **Revisar registros**, sem inventar dinheiro nem apagar lançamentos. Corrija as retiradas/destinações em Reserva para restaurar a consistência financeira. Novas gravações passam pelas validações existentes. A correção pode ocorrer conta por conta, sem criar inconsistências em contas que estavam válidas. É possível exportar uma cópia marcada para revisão com todos os registros; esse arquivo exige corrigir a consistência financeira antes de restaurar.

## Privacidade na interface

| Tela | Oculto ao fechar o olho | Permanece visível |
|---|---|---|
| Visão geral | Recebido, gastos, guardado, saldo, livre estimado e reserva | Mês, rótulos e atalhos |
| Orçamento | Valores unitários, totais, estimativa livre e reserva | Nome/categoria do gasto, tipo, frequência e repetições |
| Histórico | Salários, totais, médias/variações e gráficos | Datas, períodos e quantidade de registros |
| Reserva | Saldos, aportes, retiradas, rendimentos, metas, percentuais, gráficos, nomes dos locais/objetivos e notas pessoais | Data, tipo de movimentação e ações |
| Configurações | E-mail da conta e valores do orçamento-base | Tema, estado offline/sincronização, datas de backup e contagens |
| Formulários | A ocultação das telas principais não se aplica ao modal de edição | Campos monetários, nomes, notas, datas e categorias |

Gráficos e barras de progresso são retirados da renderização quando ocultos, inclusive seus rótulos acessíveis. O botão de olho aparece apenas nas telas principais. Modais mostram os campos e informações para consulta e edição, sem alterar a preferência de ocultação da tela principal. A preferência é aplicada antes dos dados e persistida por dispositivo, separada da conta e do backup.

Erros operacionais sem valores/nomes pessoais continuam visíveis com o olho fechado. Mensagens de integridade do backup não interpolam IDs do arquivo, e exceções arbitrárias do provedor são substituídas por mensagens seguras no aviso de sincronização.

Login, cadastro e recuperação permitem mostrar ou ocultar a senha. Cadastro e definição de nova senha exigem confirmação correspondente antes de enviar ao Supabase. Os controles de visibilidade são independentes e voltam a ocultar ao trocar de formulário.

## Primeiro uso

Telas vazias orientam o primeiro registro e evitam gráficos sem dados ou referências a uma planilha inexistente. O primeiro aporte ou saldo inicial conduz ao cadastro de um local e, depois de salvá-lo, abre o formulário do valor. Cancelar esse segundo formulário mantém apenas o local cadastrado. Saldo inicial e aportes continuam sendo lançamentos manuais: a sobra do orçamento não gera movimentações.

## Verificações

- `npm test`: domínio, persistência, modo offline, reabertura, contas/projetos separados, duas edições concorrentes, exclusões, envio em andamento, falhas de sessão, tela de login e privacidade.
- `npm run build`: TypeScript e build de produção; `npm run check:build` confere os arquivos e o precache gerados.
- `npm run verify`: testes do app/harness, TypeScript/build e inspeção do precache. Não executa os checks SQL ou de navegador real.
- `supabase/security.test.sql`: isolamento entre dois usuários, negação de acesso anônimo, negação de escrita direta e mesclagem sem sobrescrita por revisões antigas. Execute após o esquema; fixtures são desfeitas com `ROLLBACK`.
- Uma publicação antiga com dados pessoais em assets/cache precisa continuar protegida; o build novo não torna privados assets publicados anteriormente. A produção atual usa Standard Protection na Vercel: domínio principal público, endereços históricos e de prévia protegidos. Autenticação e autorização dos dados do aplicativo ficam no Supabase.

Referências: [Supabase Auth](https://supabase.com/docs/guides/auth/passwords), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [chaves de API](https://supabase.com/docs/guides/getting-started/api-keys), [funções de banco](https://supabase.com/docs/guides/database/functions).
