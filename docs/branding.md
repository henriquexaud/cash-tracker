# Marca e ícones

A logo oficial é a setinha de crescimento que já aparecia ao lado do nome do app: traço branco, cantos arredondados e fundo verde. O símbolo é o `TrendingUp` do Lucide, com espessura de 2,4. A licença original está preservada nos SVGs.

## Fontes e uso

- [logo-mark.svg](../src/assets/logo-mark.svg) é o desenho vetorial do símbolo. O componente [BrandMark](../src/components/BrandMark.tsx) usa essa fonte no menu, cabeçalho do celular, login e carregamento. O fundo acompanha as cores já existentes dos temas.
- [logo.svg](../public/icons/logo.svg) é a versão completa para favicon: fundo `#244b3b`, raio de 128 em uma tela de 512 e símbolo de 320 centralizado. Mantém as proporções do ícone de 20 dentro do fundo de 32 usado no app.

## Arquivos para navegador e instalação

| Arquivo | Uso |
|---|---|
| `public/favicon.ico` | Favicon de compatibilidade, com imagens de 16, 32 e 48 px. |
| `public/icons/logo.svg` | Favicon vetorial. |
| `public/icons/logo-192.png` | Instalação PWA, 192 × 192. |
| `public/icons/logo-512.png` | Instalação PWA, 512 × 512. |
| `public/icons/logo-maskable-512.png` | PWA com recorte pelo sistema; fundo verde opaco. |
| `public/icons/logo-apple-touch.png` | Ícone Apple, 180 × 180; fundo verde opaco. |

As imagens raster foram renderizadas a partir da versão vetorial completa. A variante maskable e a Apple usam o mesmo desenho, preenchendo também os cantos com verde. Os arquivos ficam versionados; desenvolver e compilar não exige um renderizador de imagem ou uma nova dependência.

## Manutenção e verificação

Ao alterar a marca por pedido explícito, mantenha o símbolo dos dois SVGs idêntico e regenere as imagens a partir do SVG completo. Preserve dimensões, transparência das versões comuns e fundo opaco nas variantes de instalação com recorte. Não substitua pelo monograma “C” antigo.

O HTML e o manifesto usam caminhos novos para os ícones desta marca. Isso permite distinguir os assets da versão anterior em caches e atalhos. O `id`, escopo e início da PWA permanecem iguais, preservando a identidade do app instalado.

Execute `npm run verify`, confira dimensões/arquivos e abra favicon e cabeçalho em desktop/celular, claro/escuro e com valores visíveis/ocultos. O build inclui todos esses arquivos no precache. A atualização de um ícone já instalado também depende do navegador/sistema; para conferir esse caso, use um dispositivo de teste e o roteiro de [verificação](verification.md).
