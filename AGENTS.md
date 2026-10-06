# Guia de trabalho no Cash Tracker

## Produto e escopo

O app é um registro manual e simples de salários, estimativas de gastos e reserva. Preserve as cinco telas, a navegação, os temas, a hierarquia visual e a diferença entre planejamento e dinheiro efetivamente guardado.

- Faça a menor alteração que resolva o pedido. Não adicione funcionalidades, dependências, refatorações amplas ou reorganização do layout por iniciativa própria.
- Em pedidos de revisão, entregue achados com impacto, reprodução e evidência. Não implemente correções sem que façam parte do escopo autorizado.
- Uma solicitação de documentação/harness autoriza mudanças nos guias, scripts e verificações; não autoriza mudanças no comportamento do produto.
- Instruções explícitas do usuário prevalecem sobre este guia.

## Antes de editar

1. Leia [README.md](README.md) e os documentos relevantes em [docs/README.md](docs/README.md).
2. Confira `git status --short`. Preserve alterações existentes; não restaure arquivos nem apague trabalho alheio.
3. Identifique a camada afetada em [docs/architecture.md](docs/architecture.md).
4. Use `rg` para localizar os fluxos e os testes existentes. Prefira estender uma verificação relevante a criar estruturas paralelas.

## Regras que devem continuar verdadeiras

- Valores monetários são inteiros em centavos, dentro de `Number.isSafeInteger`. Use `parseMoney`, `formatMoney` e as funções de domínio; não converta dinheiro com `parseFloat(valor) * 100`.
- Orçamento e reserva planejada são estimativas. Apenas movimentações alteram o saldo da reserva. Destinar dinheiro a um objetivo não gera aporte.
- Saldo inicial é único por local e anterior ou igual às outras movimentações. Preserve a precisão mensal dos registros antigos; não invente dias.
- Uma conta/instalação nova começa vazia. Fixtures pertencem a testes e nunca devem aparecer no bundle do app.
- Falha de leitura é diferente de banco vazio. Não inicialize dados sobre um estado ilegível.
- Uma gravação só é bem-sucedida após o commit local no IndexedDB. Falha de rede não pode descartar uma edição já salva.
- No modo cloud, preserve partições por projeto/usuário, revisões por registro, tombstones, mesclagem e correção de conflitos. Não substitua o documento inteiro no servidor.
- O servidor determina o proprietário por `auth.uid()`. Não use chave secreta/service role no navegador nem remova RLS.
- O olho protege a apresentação das telas principais. Modais revelam seus próprios campos; backups contêm valores reais. Não mude esse contrato silenciosamente.
- Preserve navegação por teclado, foco do modal, labels, feedback acessível, temas e usabilidade em telas estreitas.
- A logo oficial é a carteira verde e creme. Use `BrandMark` no carregamento, alternando as versões transparentes pelo tema; menu, cabeçalho e login usam apenas o nome. Mantenha favicons/ícones de instalação derivados das imagens oficiais, conforme [branding.md](docs/branding.md).
- O service worker só é registrado no build de produção. Todos os arquivos gerados, inclusive chunks lazy, devem entrar no precache.

## Dados e ambientes

- Use `npm run dev:local` para revisão sem autenticação, com dados fictícios e origem separada. Use `npm run preview:local` para validar PWA; esse comando recompila `dist` em modo local.
- Não abra, imprima, copie ou versione `.env.local`, sessões, tokens ou backups pessoais como parte de uma revisão. Consulte apenas nomes de variáveis em `.env.example`.
- Não use produção como ambiente de teste. Validações reais de autenticação/SQL devem usar projeto e contas de teste.
- Não faça deploy, execute mudanças no banco remoto ou publique arquivos como consequência implícita de um pedido de revisão/documentação.
- Não altere o lockfile ou atualize dependências sem necessidade do pedido. `npm ci` instala as versões registradas.

## Verificação

- Os comandos e a matriz de cobertura estão em [docs/verification.md](docs/verification.md).
- Para uma mudança de código, rode a suíte relacionada durante o trabalho e `npm run verify` antes da entrega. Esse comando testa o app/harness, faz TypeScript/build e confere o precache gerado.
- Se a alteração for apenas documental, confira comandos, caminhos e links; não crie testes que apenas repitam o texto.
- Scripts novos devem ser verificados. Não apresente mocks, inspeção estática ou checks de arquivos como prova de comportamento real no navegador/servidor.
- Alterações visuais exigem conferência em claro/escuro, celular/desktop e com valores visíveis/ocultos, sem ampliar o escopo.
- Se não puder executar um check relevante, informe o motivo e a limitação. Não declare que passou.

## Entrega

Informe o que mudou, por quê, checks executados e limitações materiais. Cite arquivos/linhas quando ajudam a revisar. Em análises, diferencie defeito confirmado, evidência de código e hipótese que exige reprodução. Atualize documentação quando contratos ou comandos mudarem.
