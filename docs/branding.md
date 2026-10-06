# Marca e ícones

A logo oficial é a carteira com barras de crescimento, nas versões verde e creme fornecidas em 06/10/2026. A arte original é preservada; apenas margens e resolução foram ajustadas para cada aplicação.

## Fontes e uso

- [wallet-light.png](../src/assets/brand/wallet-light.png) vem de `cash_tracker_verde_transparente_centralizado.png`; a carteira verde aparece no tema claro.
- [wallet-dark.png](../src/assets/brand/wallet-dark.png) vem de `cash_tracker_creme_transparente_centralizado.png`; a carteira creme aparece no tema escuro.
- O componente [BrandMark](../src/components/BrandMark.tsx) compartilha essas imagens transparentes de 256 × 256 no menu, cabeçalho do celular, login e carregamento. A marca acompanha o tema resolvido, incluindo preferência do sistema e alterações entre abas. Menu/cabeçalho preservam o espaço de 32 px (28 px em telas menores); login/carregamento usam 64 px.
- Os favicons claro e escuro usam as mesmas carteiras transparentes das telas. A versão com fundo verde, `Ícone de carteira financeira verde e creme.png`, origina os ícones de instalação, com bom contraste em superfícies claras e escuras.

## Arquivos para navegador e instalação

| Arquivo | Uso |
|---|---|
| `public/favicon.ico` | Favicon de compatibilidade transparente, com imagens de 16, 32 e 48 px. |
| `public/icons/wallet-favicon-light.png` | Favicon claro, carteira verde com fundo transparente, 48 × 48. |
| `public/icons/wallet-favicon-dark.png` | Favicon escuro, carteira creme com fundo transparente, 48 × 48. |
| `public/icons/wallet-192.png` | Instalação PWA, 192 × 192. |
| `public/icons/wallet-512.png` | Instalação PWA, 512 × 512. |
| `public/icons/wallet-maskable-512.png` | PWA com recorte pelo sistema, 512 × 512; fundo verde opaco e margem de segurança. |
| `public/icons/wallet-apple-touch.png` | Ícone Apple, 180 × 180; fundo verde opaco. |

O favicon PNG acompanha o tema do app, inclusive antes da primeira renderização, por meio do bootstrap do HTML e de [theme.ts](../src/theme.ts). O ICO usa a versão clara como fallback. Ícones instalados têm uma versão fixa: os sistemas não oferecem a mesma troca de tema da interface.

As imagens comuns de instalação reduzem as margens do original para destacar a carteira. A variante maskable preserva a tela original inteira e mantém a arte dentro da área segura circular central de 80%. Todas as versões de instalação têm fundo opaco, inclusive nos cantos. Os arquivos ficam versionados; desenvolver e compilar não exige um renderizador de imagem ou uma nova dependência.

## Manutenção e verificação

Ao alterar a marca por pedido explícito, use as imagens oficiais correspondentes. Preserve transparência nas marcas das telas e favicons, dimensões dos ícones e fundo opaco/margem segura na instalação. Não volte à setinha ou ao monograma “C” antigos.

O HTML e o manifesto usam caminhos `wallet-*` para distinguir os assets da versão anterior em caches e atalhos. O `id`, escopo e início da PWA permanecem iguais, preservando a identidade do app instalado.

Execute `npm run verify`, confira dimensões/arquivos e abra favicon e cabeçalho em desktop/celular, claro/escuro e com valores visíveis/ocultos. O build inclui todos esses arquivos no precache. A atualização de um ícone já instalado também depende do navegador/sistema; para conferir esse caso, use um dispositivo de teste e o roteiro de [verificação](verification.md).
