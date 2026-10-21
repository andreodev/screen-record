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
2. **Nova gravação** inicia ScreenCaptureKit no monitor principal, sem áudio. **Parar gravação** finaliza o MOV e abre o editor. O macOS precisa autorizar Frame Studio (ou frame-native) em Privacidade e Segurança → Gravação de Tela e Áudio do Sistema; pode ser necessário reabrir o app.
3. **Zooms** permite adicionar blocos, arrastar o bloco e suas bordas, ajustar intensidade/foco/duração e desativar ou remover. Vídeos capturados com trilha de cursor recebem sugestões a partir dos cliques. Importados sem essa trilha usam zoom manual.
4. **Aparência** ajusta gradiente, margem, cantos e sombra; **Salvar como padrão** conserva o preset para novos vídeos.
5. **Salvar** cria um pacote `.framestudio` com vídeo, cursor, edição, backup e prévia. Depois do primeiro salvamento, as alterações são salvas automaticamente. **Salvar como** cria uma cópia independente. O pacote pode ser movido ou copiado inteiro e reaberto por duplo clique no Finder. Os projetos antigos `.frame.json` continuam abrindo; o próximo salvamento pode convertê-los em um pacote.
6. **Exportar** gera MP4 H.264 a 30 fps com os zooms, cursor, aparência e trecho escolhido. Preserva a primeira faixa de áudio dos vídeos importados. Oferece progresso e cancelamento; o destino só é substituído após sucesso.

Espaço reproduz/pausa, setas avançam/recuam um frame, ⌘Z desfaz e ⇧⌘Z refaz. A velocidade da prévia não altera a exportação.

## Zoom e leveza

- Curvas de entrada/saída suaves, coordenadas limitadas à imagem e trajetória determinística compartilhada com a exportação.
- Zoom automático agrupa cliques próximos; seguimento usa zona de tolerância para evitar deslocar a câmera com pequenos movimentos.
- Cursor separado do vídeo, suavização que preserva a posição dos cliques e controle de tamanho/ocultação.
- Frames permanecem no motor nativo; a ponte Tauri carrega comandos e metadados. Fundos, sombras e máscaras estáticos são preparados uma vez por exportação.
- Prévia atualiza transformações sem renderizar React a cada frame. A trajetória é pré-calculada e consultada por busca binária.
- Captura limitada ao enquadramento de até 1920 × 1080; exportações verticais podem chegar a 1080 × 1920. Resolução e qualidade ainda precisam ser calibradas com uso real.

## Validação

```sh
pnpm build
node --experimental-strip-types tests/zoom.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib
python3 tests/native.test.py
```

O teste de integração macOS cria mídia sintética em uma pasta temporária, verifica cortes, exportação horizontal/vertical/quadrada, faixa de áudio, cancelamento, limpeza e preservação da mídia original. Não captura a tela.

## Limitações desta primeira implementação

- A captura foi inicialmente bloqueada pelo TCC; uma sessão posterior de 8,7 s gerou vídeo, 1.019 amostras de cursor e três sugestões de zoom no desktop. Permissões continuam dependendo do macOS. Faltam sessões longas e calibração em outras escalas/monitores.
- Cursor/cliques são amostrados a 120 Hz; cliques muito breves entre amostras podem ser perdidos. A evolução prevista é um event tap apenas de mouse, com as permissões adequadas.
- Sem seleção de janela/área, captura de microfone/áudio do sistema, webcam, legendas, motion blur ou lista de projetos recentes. O manifesto anterior fica em `project.json.bak`; recuperação automática após corrupção ainda não foi implementada.
- Formatos alternativos atualmente preservam a tela inteira com margens; reenquadramento específico para vídeo vertical é uma evolução prevista.
- Somente a primeira faixa de áudio importada é exportada; vídeos HDR, codecs alternativos e fontes com orientação especial precisam de uma matriz maior de testes.
- Há benchmark de prévia/exportação de um projeto sintético de 10 minutos, com limites de atribuição dos serviços do macOS. Captura longa real, 4K e cinco ciclos de abertura continuam pendentes. O bundle debug não representa o tamanho final de produção.
- Fechamento pela janela bloqueado durante captura/exportação. Forçar o encerramento pode deixar uma gravação incompleta.

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
