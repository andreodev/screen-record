# Frame Studio

Editor e gravador desktop local com Tauri 2, React/TypeScript, Rust e um motor Swift para mídia no macOS.

## Executar

Requer macOS 13+, Node, pnpm, Rust e Xcode Command Line Tools (incluindo Swift).

```sh
source "$HOME/.cargo/env"
pnpm install
pnpm tauri dev
```

Para abrir sem servidor de desenvolvimento:

```sh
pnpm tauri build --debug --bundles app
open "src-tauri/target/debug/bundle/macos/Frame Studio.app"
```

Novas gravações criam projetos em `~/Frame Studio Projects/`. A mídia é gravada diretamente dentro do pacote, sem segunda cópia.

O build compila `src-tauri/native/FrameNative.swift` para a arquitetura alvo e inclui o executável no bundle. A versão para Windows ainda não tem motor de mídia.

## Fluxo disponível

1. **Importar vídeo** abre MOV/MP4/M4V local em um diálogo nativo. H.264 é o formato inicial recomendado.
2. **Nova gravação** inicia ScreenCaptureKit no monitor principal, sem áudio. **Parar gravação** finaliza o MOV e abre o editor. O macOS precisa autorizar **Frame Studio** (a permissão do Screen Studio é independente) em Privacidade e Segurança → Gravação de Tela e Áudio do Sistema; pode ser necessário reabrir o app. Se a opção já estiver ligada e o acesso continuar bloqueado após recompilar, remova a entrada antiga e adicione novamente o bundle atual; builds locais usam assinatura ad hoc e podem exigir nova autorização.
3. **Zooms** oferece os modos Automático, Manual e Híbrido (padrão), com keyframes editáveis na timeline. A gravação registra posição do cursor e botões esquerdo/direito/meio a 120 Hz; cliques próximos são agrupados e movimentos relevantes seguidos de pausa podem gerar foco suave. Ao editar um zoom automático, ele passa a ser um ajuste manual e tem prioridade no modo Híbrido.
4. **Aparência** ajusta gradiente, margem, cantos e sombra. **Fundo com vídeo desfocado** preserva a imagem inteira sobre um fundo ampliado e desfocado, útil quando um crop 9:16 cortaria conteúdo importante. **Salvar como padrão** conserva o preset para novos vídeos.
5. **Salvar** cria um pacote `.framestudio` com vídeo, cursor, edição, backup e prévia. Depois do primeiro salvamento, as alterações são salvas automaticamente. **Salvar como** cria uma cópia independente. O pacote pode ser movido ou copiado inteiro e reaberto por duplo clique no Finder. Os projetos antigos `.frame.json` continuam abrindo; o próximo salvamento pode convertê-los em um pacote.
6. **Exportar** abre opções de 480p/720p/1080p/1440p/4K e 24/30/60 fps (inicialmente 4K60) e gera MP4 H.264 com zooms, cursor, aparência e trecho escolhido. Em 9:16, 1080p gera 1080×1920 e 4K gera 2160×3840. Preserva o áudio da gravação/importação e oferece progresso e cancelamento.

Na timeline, posicione o marcador e use **Dividir** (⌘B). Selecione um trecho dourado ou um zoom roxo e use **Apagar** (Delete/Backspace). **Limpar zooms** remove todos os zooms; **Restaurar cortes** recupera os trechos. Os cortes participam da reprodução, autosave e exportação, com áudio e cursor sincronizados. O original permanece intacto.

Selecione um **trecho dourado** para ajustar sua velocidade (0,25× a 4×), ocultar o cursor ou usar seu movimento original somente nesse intervalo. Dividir um trecho preserva essas opções nas duas partes. A duração editada e a exportação consideram a velocidade de cada trecho, inclusive o áudio.

Em **Zooms**, ative **Zoom instantâneo** para entrar e sair sem transição; arraste o ponto violeta na prévia para posicionar um foco manual. O ponto também aceita as setas do teclado. Em **Animações**, os controles de **Motion blur** ajustam separadamente o movimento do cursor, a aproximação/afastamento e o deslocamento da tela. Todos começam em zero. Prévia e exportação calculam até cinco amostras de movimento do mesmo frame de vídeo, com exposição de 1/60 s no tempo editado; isso não reconstrói frames intermediários da gravação.

Espaço reproduz/pausa, setas avançam/recuam um frame, ⌘Z desfaz e ⇧⌘Z refaz. A velocidade da prévia não altera a exportação.

## Zoom e leveza

- Curvas de entrada/saída suaves, coordenadas limitadas à imagem e trajetória determinística compartilhada com a exportação.
- O reenquadramento 9:16 acompanha interações em diferentes regiões e limita o foco ao crop visível. O controle **Acompanhar cursor** move esse crop suavemente entre zooms.
- Zoom automático agrupa cliques próximos e ignora movimentos pequenos; pausas após deslocamentos relevantes podem sugerir foco com ampliação menor.
- Cursor separado do vídeo, suavização que preserva a posição dos cliques e controle de tamanho/ocultação. Conjuntos de cursores aplicam seta, mão e texto conforme o tipo registrado na nova captura; gravações antigas sem essa informação usam seta.
- Frames permanecem no motor nativo; a ponte Tauri carrega comandos e metadados. Fundos, sombras e máscaras estáticos são preparados uma vez por exportação.
- Prévia atualiza transformações sem renderizar React a cada frame. A trajetória é pré-calculada e consultada por busca binária.
- Captura preserva os pixels físicos da tela até 3840 × 2160 (ou 2160 × 3840 em retrato), solicitando 60 fps. Não amplia telas menores. Nitidez e cadência sustentada ainda precisam ser medidas em gravações reais.

## Validação

```sh
pnpm build
node --experimental-strip-types tests/zoom.test.ts
node --experimental-strip-types tests/cursor.test.ts
node --experimental-strip-types tests/animations.test.ts
node --experimental-strip-types tests/timeline.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib
python3 tests/native.test.py
```

O teste de integração macOS cria mídia sintética em uma pasta temporária, verifica cortes, exportação horizontal/vertical/quadrada, faixa de áudio, cancelamento, limpeza e preservação da mídia original. Não captura a tela.

O contador de gravação usa o relógio do motor nativo: começa no primeiro frame, atualiza durante a captura e recebe o tempo final ao parar. Esperas por autorização e pela finalização do encoder não aumentam o contador.

Projetos com cortes usam schema 3; projetos com velocidade/opções de cursor por trecho, zoom instantâneo ou motion blur usam schema 4; os modos de câmera e crop vertical usam schema 7; captura/edição de webcam usa schema 8. Builds antigos rejeitam schemas novos para evitar perder informações da edição. Projetos antigos continuam abrindo.

## Limitações desta primeira implementação

- A captura foi inicialmente bloqueada pelo TCC; uma sessão posterior de 8,7 s gerou vídeo, 1.019 amostras de cursor e três sugestões de zoom no desktop. Permissões continuam dependendo do macOS. Faltam sessões longas e calibração em outras escalas/monitores.
- Eventos de mouse são amostrados a 120 Hz; cliques breves podem escapar entre amostras. A captura não registra texto digitado nem a identidade de páginas, menus ou modais, então o foco automático infere intenção por clique, deslocamento e pausa.
- Ainda faltam seleção de janela/área, captura de microfone/áudio do sistema, legendas e lista de projetos recentes. Motion blur aumenta o trabalho de composição e ainda precisa de medição longa na prévia. O manifesto anterior fica em `project.json.bak`; recuperação automática após corrupção ainda não foi implementada.
- Somente a primeira faixa de áudio importada é exportada; vídeos HDR, codecs alternativos e fontes com orientação especial precisam de uma matriz maior de testes.
- Há benchmark de prévia/exportação de um projeto sintético de 10 minutos, com limites de atribuição dos serviços do macOS. Captura longa real, 4K e cinco ciclos de abertura continuam pendentes. O bundle debug não representa o tamanho final de produção.
- Fechamento pela janela bloqueado durante captura/exportação. Forçar o encerramento pode deixar uma gravação incompleta.

Exportação 4K60 amplia fontes menores e repete frames quando necessário; selecionar 4K não acrescenta detalhes ausentes na fonte. Plano atualizado de paridade: [PARIDADE-SCREEN-STUDIO.md](docs/PARIDADE-SCREEN-STUDIO.md).

Resultados e reprodução do benchmark: [desempenho](docs/DESEMPENHO.md).

Veja [o plano completo](docs/PLANO-SCREEN-STUDIO.md) e [o estado das entregas](docs/IMPLEMENTACAO.md).

## Estrutura do projeto

O Finder reconhece `.framestudio` como um pacote do Frame Studio. O formato é próprio, sem compatibilidade de edição com `.screenstudio`.

```text
Meu projeto.framestudio/
  project.json             # edição versionada e caminhos relativos
  project.json.bak         # manifesto anterior
  media/
    recording.mov          # ou o contêiner do vídeo importado
    recording.cursor.json  # quando a captura tem eventos de cursor
  QuickLook/
    Preview.png            # primeiro frame para identificação
```

Na primeira cópia de um vídeo importado, o arquivo é copiado sem recodificação. Depois, o autosave grava apenas os metadados. A prévia usa um frame da mídia e pode diferir da composição editada.

## Referência do aplicativo instalado

A extração e desofuscação parcial estão documentadas em [ENGENHARIA-REVERSA.md](docs/ENGENHARIA-REVERSA.md). O editor agora inclui presets, cor/gradiente personalizados e animação de cursor independente da câmera.

Biblioteca disponível no desktop: [wallpapers, cursores e animações](docs/BIBLIOTECA-VISUAL.md).
