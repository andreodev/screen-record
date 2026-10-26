# Frame Studio

Editor e gravador desktop local com Tauri 2, React/TypeScript e Rust. Usa Swift/AVFoundation/ScreenCaptureKit no macOS e FFmpeg/WASAPI no Windows.

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

No macOS, o build compila `src-tauri/native/FrameNative.swift` para a arquitetura alvo e inclui o executável no bundle.

## Executar no Windows

Requer Node, pnpm, Rust (toolchain MSVC), Visual Studio Build Tools 2022 com a carga **Desenvolvimento para desktop com C++** e Windows SDK, e Microsoft Edge WebView2 Runtime. Reabra o terminal após instalar o Rust para atualizar o PATH.

```powershell
pnpm install --frozen-lockfile
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
pnpm tauri dev
```

Para gerar um executável local sem instalador:

```powershell
pnpm tauri build --debug --no-bundle
.\src-tauri\target\debug\screen-studio.exe
```

O script prepara FFmpeg/FFprobe e a licença em `src-tauri/resources/ffmpeg/` (ignorado pelo Git). Os executáveis são incluídos nos bundles Windows; a instalação final não exige Node, Rust ou FFmpeg no PATH. O motor roda em um processo separado do próprio aplicativo.

No Windows estão disponíveis importação MOV/MP4/M4V, abertura/salvamento de projetos, captura do monitor principal sem cursor embutido, cursor separado, webcam com prévia, áudio do sistema por WASAPI loopback e microfone padrão em trilha independente. A captura solicita 60 fps e limita a resolução a 4K, sem ampliar telas menores. A exportação H.264/AAC aplica cortes, velocidade, câmera/zooms, cursores, gradiente/wallpaper/fundo desfocado, margens, cantos, sombra, máscaras/destaques, webcam, música e cliques, com progresso e cancelamento.

Em **Abrir projeto**, entre na pasta `.framestudio` e selecione `project.json`. Projetos legados `.frame.json` também podem ser selecionados. Para atalhos, use Ctrl no lugar de ⌘. As permissões de câmera e microfone abrem as Configurações do Windows.

Antes de gravar, escolha **Microfone para gravar** e **Saída de áudio a gravar** no painel **Áudio**, e **Webcam para gravar** no painel **Webcam**. A saída selecionada identifica os fones/alto-falantes cujo áudio será capturado por loopback; não altera a saída padrão do Windows. As escolhas e o tratamento da voz ficam salvos neste computador. **Atualizar dispositivos** detecta conexões e desconexões; um dispositivo escolhido que foi desconectado gera erro para você selecionar outro.

O microfone vem com o perfil **Natural**: supressão espectral de ruído, corte de graves em 80 Hz, compressor leve e limitador de picos. O áudio passa pelos filtros durante a captura, antes de ser salvo na trilha independente. **Ambiente ruidoso** aumenta a redução; **Sem processamento** desativa a cadeia. Nos ajustes avançados, configure limiar, razão e ganho do compressor. O tratamento afeta novas gravações; trilhas já gravadas mantêm seu áudio. A supressão reduz ruído constante, mas não substitui isolamento acústico nem cancela vozes/reverberação.

Validação do motor Windows (mídia sintética, sem acessar dispositivos):

```powershell
node tests/windows-native.test.mjs
```

Para incluir uma prévia real da webcam e uma gravação curta de tela, webcam, áudio do sistema e microfone, em arquivos temporários removidos ao terminar:

```powershell
node tests/windows-native.test.mjs --capture
```

Use `--desktop` para incluir abertura de projeto e reprodução reais no WebView2 (compile antes com `pnpm tauri build --debug --no-bundle`). Os dois parâmetros podem ser combinados.

A composição Windows usa CPU e não tem aceleração GPU nesta versão. A suavidade das sombras e a mistura das amostras de motion blur podem diferir do Core Image no macOS. Desempenho de exportações longas/4K60, HDR e sincronismo em sessões longas ainda precisam de medição.

## Fluxo disponível

1. **Importar vídeo** abre MOV/MP4/M4V local em um diálogo nativo. H.264 é o formato inicial recomendado.
2. **Nova gravação** abre a seleção de monitor, janela ou área, com resolução máxima de 1080p/4K e 30/60 fps. Webcam, microfone e áudio do sistema seguem as escolhas da barra de gravação. **Parar gravação** finaliza o MOV e abre o editor. O macOS precisa autorizar **Frame Studio** (a permissão do Screen Studio é independente) em Privacidade e Segurança → Gravação de Tela e Áudio do Sistema; pode ser necessário reabrir o app. Se a opção já estiver ligada e o acesso continuar bloqueado após recompilar, remova a entrada antiga e adicione novamente o bundle atual; builds locais usam assinatura ad hoc e podem exigir nova autorização.
3. **Zooms** oferece os modos Automático, Manual e Híbrido (padrão), com keyframes editáveis na timeline. A gravação registra posição do cursor e botões esquerdo/direito/meio a 120 Hz; cliques próximos são agrupados e movimentos relevantes seguidos de pausa podem gerar foco suave. Ao editar um zoom automático, ele passa a ser um ajuste manual e tem prioridade no modo Híbrido.
4. **Aparência** ajusta gradiente, margem, cantos e sombra. **Fundo com vídeo desfocado** preserva a imagem inteira sobre um fundo ampliado e desfocado, útil quando um crop 9:16 cortaria conteúdo importante. **Salvar como padrão** conserva o preset para novos vídeos.
5. **Salvar** cria um pacote `.framestudio` com vídeo, cursor, edição, backup e prévia. Depois do primeiro salvamento, as alterações são salvas automaticamente. **Salvar como** cria uma cópia independente. O pacote pode ser movido ou copiado inteiro e reaberto por duplo clique no Finder. Os projetos antigos `.frame.json` continuam abrindo; o próximo salvamento pode convertê-los em um pacote.
6. **Exportar** abre opções de 480p/720p/1080p/1440p/4K e 24/30/60 fps (inicialmente 4K60) e gera MP4 H.264/HEVC ou MOV ProRes 422 LT/422/422 HQ/4444 com zooms, cursor, aparência e trecho escolhido. H.264 e HEVC oferecem qualidades Web, Equilibrada e Alta. Em 9:16, 1080p gera 1080×1920 e 4K gera 2160×3840. Preserva o áudio da gravação/importação e oferece progresso e cancelamento.

Na timeline, posicione o marcador e use **Dividir** (⌘B). Selecione um trecho dourado ou um zoom roxo e use **Apagar** (Delete/Backspace). **Limpar zooms** remove todos os zooms; **Restaurar cortes** recupera os trechos. Os cortes participam da reprodução, autosave e exportação, com áudio e cursor sincronizados. O original permanece intacto.

Ativar **Webcam** abre uma [prévia flutuante independente](docs/README-WEBCAM-FLOATING-PREVIEW.md), sempre no topo, arrastável e redimensionável. Ela permite trocar a câmera antes da gravação e parar a captura enquanto você usa outros aplicativos. A prévia é excluída da gravação da tela; a câmera continua em `webcam.mov` e permanece editável. Mover a janela serve apenas ao monitoramento. Ao terminar a gravação ou desativar a webcam, a janela fecha e a câmera é liberada.

Selecione um **trecho dourado** para ajustar sua velocidade (0,25× a 4×), ocultar o cursor ou usar seu movimento original somente nesse intervalo. Dividir um trecho preserva essas opções nas duas partes. A duração editada e a exportação consideram a velocidade de cada trecho, inclusive o áudio.

Em **Zooms**, ative **Zoom instantâneo** para entrar e sair sem transição; arraste o ponto violeta na prévia para posicionar um foco manual. O ponto também aceita as setas do teclado. Em **Animações**, os controles de **Motion blur** ajustam separadamente o movimento do cursor, a aproximação/afastamento e o deslocamento da tela. Todos começam em zero. Prévia e exportação calculam até cinco amostras de movimento do mesmo frame de vídeo, com exposição de 1/60 s no tempo editado; isso não reconstrói frames intermediários da gravação.

Espaço reproduz/pausa, setas avançam/recuam um frame, ⌘Z desfaz e ⇧⌘Z refaz. A velocidade da prévia não altera a exportação.

## Anotações, legendas e ritmo

- **＋ Anotação** na timeline adiciona texto, seta, retângulo, elipse, spotlight, lupa ou marca d’água. A ferramenta **Anotações** edita tipo, cor, texto, tamanho e duração. Várias camadas aparecem simultaneamente; arraste a área ou use as setas para posicionar. Desfoque e destaque continuam disponíveis.
- **Importar legendas SRT** usa tempos do vídeo original, preservados ao cortar ou alterar a velocidade. Cada bloco aceita edição de texto, tempo, cor e posição. Legendas e marca d’água ficam fixas no quadro final durante os zooms.
- **Ritmo** analisa o microfone, quando disponível, ou o áudio da fonte. Exibe forma de onda e sugestões de silêncio para revisar e aplicar. A aceleração de digitação usa apenas os eventos de digitação registrados, sem texto digitado. Ambas preservam os cortes existentes e podem ser desfeitas.
- **Cursor** oferece círculo/onda de clique e ocultação após um segundo parado, com fade de 200 ms. Os controles valem para a prévia e para a exportação.
- **Recentes** reabre até 20 projetos. Se o manifesto estiver danificado e houver backup válido, o app o recupera e preserva o original como `project.json.corrupt-*`. Versões futuras desconhecidas são rejeitadas.
- Anotações e os novos controles de cursor usam schema 12. Máscaras antigas com crop são convertidas ao abrir, preservando sua posição exportada. Os projetos anteriores continuam legíveis.

## Zoom e leveza

A implementação, os controles e os limites estão em [README — Cursor com movimento orgânico e zoom guiado](docs/README-SHAKE-CURSOR.md).

### Cursor inteligente e zoom acompanhado

O Frame Studio reconstrói o cursor separado do vídeo e usa a trajetória gravada para manter o foco legível. Zooms automáticos acompanham cliques, digitação e pausas após movimentos relevantes; durante um foco ativo a câmera cria uma pequena zona de segurança, antecipa parte do deslocamento e suaviza a aproximação para o cursor não ficar colado na borda.

No painel **Animações**, escolha a animação do cursor (Original, Suave, Médio ou Rápido), ajuste o motion blur e deixe o **Spring** ligado para transições naturais. O **Camera Motion** aplica impactos curtos nos inícios, paradas e mudanças de direção da câmera. Os presets Cinematic e Dynamic usam micro-shakes leves; a intensidade e a duração continuam editáveis, e impactos manuais podem ser adicionados no marcador.

O acompanhamento é calculado offline a partir dos mesmos eventos usados na prévia e na exportação. Isso mantém o resultado consistente ao buscar qualquer ponto da timeline, em formatos 16:9, 9:16 e 1:1. O cursor preserva a posição exata dos cliques, pode desaparecer após um segundo parado e recebe círculo ou onda de clique.

Em **Animações → Resposta ao movimento**, escolha Desligada, Suave, Cinematic ou Dynamic e ajuste a intensidade. O cursor responde à velocidade e à direção, reduz o shake nas bordas e para em até 120 ms após o movimento. **Impacto ao mudar de direção** adiciona um acento curto. **Acompanhar cursor** oferece Desligado, Equilibrado e Próximo, com **Antecipação do zoom** entre 0% e 35%. Novos projetos usam Cinematic, Equilibrado e 30%; projetos antigos mantêm o shake do cursor desligado até você ativar. As configurações são salvas no schema 13.

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
node --experimental-strip-types tests/cursor-response.test.ts
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
- A posição do mouse é amostrada a 120 Hz. No macOS, eventos de down/up complementam a amostragem; no Windows, cliques breves ainda podem escapar entre amostras. A captura não registra texto digitado nem a identidade de páginas, menus ou modais, então o foco automático infere intenção por clique, deslocamento e pausa.
- Seleção de janela/área e cliques por eventos no macOS precisam de calibração real em diferentes monitores/escalas. Motion blur ainda exige medição longa. Legendas automáticas, corte de palavras de preenchimento e remoção de fundo não estão implementados; as legendas atuais são SRT ou texto manual.
- Somente a primeira faixa de áudio importada é exportada; vídeos HDR, codecs alternativos e fontes com orientação especial precisam de uma matriz maior de testes.
- Há benchmark de prévia/exportação de um projeto sintético de 10 minutos, com limites de atribuição dos serviços do macOS. Captura longa real, 4K e cinco ciclos de abertura continuam pendentes. O bundle debug não representa o tamanho final de produção.
- Fechamento pela janela bloqueado durante captura/exportação. Forçar o encerramento pode deixar uma gravação incompleta.

Exportação 4K60 amplia fontes menores e repete frames quando necessário; selecionar 4K não acrescenta detalhes ausentes na fonte. Plano atualizado de paridade: [PARIDADE-SCREEN-STUDIO.md](docs/PARIDADE-SCREEN-STUDIO.md).

Resultados e reprodução do benchmark: [desempenho](docs/DESEMPENHO.md).

Veja [o plano completo](docs/PLANO-SCREEN-STUDIO.md) e [o estado das entregas](docs/IMPLEMENTACAO.md).

Plano do preview flutuante da webcam: [janela independente durante a gravação](docs/README-WEBCAM-FLOATING-PREVIEW.md).

Plano do episódio combinado com FocuSee: [escopo, lacunas e sequência](docs/PLANO-FRAME-STUDIO-FOCUSEE.md).

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
