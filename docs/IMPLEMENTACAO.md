# Estado das entregas — 21/10/2026

Todas as cinco partes receberam uma primeira implementação. Isso ainda não significa paridade completa com o Screen Studio.

| Parte | Implementado | Validação | Próximo trabalho |
| --- | --- | --- | --- |
| 1. Editor | Vídeo local real, layout com inspector, timeline, reprodução/seek, corte, pacotes `.framestudio` com mídia incluída, autosave, backup, prévia e salvamento atômico | Build; importação e zoom manual conferidos no desktop; projeto salvo com mídia relativa | Mais formatos/rotação e proteção dos vídeos importados ainda não salvos como pacote |
| 2. Captura | ScreenCaptureKit, início/parada, H.264, cursor excluído do vídeo, eventos separados, timestamps de host, extensão de períodos estáticos | Compilação nativa; permissão negada tratada; posteriormente observado take real de 8,7 s com 1.019 eventos e três zooms | Calibrar offset/cliques nos cantos, escalas e sessões longas; substituir polling por eventos de mouse |
| 3. Zoom | Sugestões por clique, agrupamento, follow com zona de tolerância, curvas suaves, crop limitado, seek determinístico, edição por inspector e arraste | Testes de agrupamento, continuidade, limites, posição do clique, suavização e follow; zoom manual visível na prévia | Mais calibração estética com gravações reais; sobreposições e cliques distantes agora têm transição contínua |
| 4. Exportação | CoreImage + AVFoundation; H.264 com resolução/fps configuráveis até 4K60, aparência, cursor, corte, primeira faixa de áudio, progresso/cancelamento e destino temporário | Integração com mídia sintética: horizontal, 9:16, 1:1, áudio e cancelamento; duração e frames inspecionados | Comparação geométrica automatizada de pontos do compositor; HDR/rotação e gravações longas reais |
| 5. Comodidade | Preset local, autosave de pacotes, abertura por duplo clique, undo/redo, atalhos e proporções | Build e uso inicial no desktop | Recentes, recuperação, captura por janela/área, áudio, webcam e extras |

## Decisões que afetam o desempenho

- Um auxiliar nativo por operação, encerrado quando termina; sem serviço residente de captura/exportação.
- Fila de captura de três frames; vídeo não passa pelo JavaScript em base64.
- Preview usa o decoder do WebView e transformações sobre o elemento de vídeo; sem copiar cada frame em canvas 2D.
- Trajetória calculada fora do loop de reprodução. Apenas o playhead textual atualiza React em frequência reduzida.
- Exportação usa buffers nativos e camadas estáticas preparadas uma vez. Áudio e vídeo são drenados concorrentemente para evitar espera circular do writer.
- Quadros de saída são produzidos na taxa escolhida (24, 30 ou 60 fps), inclusive em intervalos de tela parada; assim o zoom continua animado nesses intervalos.
- Acesso a assets limitado aos vídeos abertos nesta sessão; nenhum escopo global ao diretório pessoal.

A prévia agora anima por requestAnimationFrame enquanto reproduz, inclusive quando o vídeo mantém um frame estático. O loop para ao pausar; cursor usa transformação CSS e o relógio React atualiza quatro vezes por segundo. Medições e limites estão em [DESEMPENHO.md](DESEMPENHO.md).

## Arquivos principais

- `src/App.tsx`, `src/App.css`: editor e interação.
- `src/zoom.ts`: geometria, segmentos e trajetórias compartilhadas com a exportação.
- `src-tauri/src/studio.rs`: diálogos, validação, projetos e controle dos processos nativos.
- `src-tauri/native/FrameNative.swift`: captura, metadados e compositor/exportador.
- `tests/zoom.test.ts`, `tests/native.test.py`: verificações do motor e do fluxo de exportação.

## Pendência que exige ação no Mac

A primeira tentativa foi recusada pelo macOS; posteriormente a sessão real foi concluída no aplicativo. Nenhuma permissão do sistema foi alterada automaticamente por este trabalho. Novas instalações ou mudanças de assinatura podem exigir nova autorização nos Ajustes do Sistema.

## Medição isolada do motor

No Node 24 deste M1, uma execução com 72.000 eventos sintéticos (10 min a 120 Hz) levou aproximadamente 15 ms para suavização e 29 ms para gerar 36.001 chaves de câmera. Essa medida isolada não representa o aplicativo; o teste desktop de 10 minutos está documentado separadamente.

## Projetos no Finder

A inspeção dos `.screenstudio` locais confirmou um pacote com manifesto, gravação, eventos de mouse, cache e `QuickLook/Preview.png`. O Frame Studio agora usa seu próprio pacote `.framestudio` e declaração UTI no bundle do macOS. A abertura pelo sistema é enfileirada até o frontend estar pronto. O formato antigo JSON continua legível.

O teste de pacote verifica cópia interna de vídeo/cursor, mudança de pasta, remoção do original externo, backup, compatibilidade com JSON antigo e rejeição de mídia que escape do pacote por caminho relativo ou symlink. O autosave não recopia a mídia.

## Incremento de 4K60

O painel Exportar oferece resolução e taxa de quadros, inicialmente 4K60. A captura usa os pixels físicos do monitor principal, sem ampliar, com limite de 3840×2160 (2160×3840 em retrato) e intervalo mínimo solicitado de 1/60 s. O encoder H.264 High usa bitrate proporcional aos pixels e fps (96 Mbps em 4K60). Isso precisa de medição real de cadência e nitidez; configurações não comprovam 60 frames distintos por segundo. As lacunas para equivalência funcional completa estão em [PARIDADE-SCREEN-STUDIO.md](PARIDADE-SCREEN-STUDIO.md).

## Permissão de captura e edição do cursor

Os logs TCC de 21/10/2026 mostraram `Failed to match existing code requirement` para `com.andreodev.screenstudio`, com hashes diferentes entre o build autorizado e o atual. O bundle agora recebe assinatura ad hoc explícita com identificador do aplicativo, recursos selados e descrição de uso da tela; `codesign --verify --deep --strict` passou. Não há certificado Apple Development disponível nesta máquina. A assinatura ad hoc ainda muda após recompilar: para manter consentimento entre builds será necessário um certificado de desenvolvimento/distribuição. Referência: [resposta do DTS da Apple](https://developer.apple.com/forums/thread/819406).

O resultado de ScreenCaptureKit passa a decidir a autorização, sem bloquear previamente por `CGPreflightScreenCaptureAccess`. O erro específico de permissão mostra instruções para o **Frame Studio** e um botão para abrir os Ajustes. A autorização antiga foi revogada somente para `com.andreodev.screenstudio` via `tccutil reset ScreenCapture`; a nova autorização deve ser concedida pelo usuário no macOS. Não foi alterada a autorização de `com.timpler.screenstudio`.

O painel Cursor agora desabilita edições sem trilha e explica a necessidade do projeto original, com botão para abri-lo. Um MP4 exportado não conserva os eventos de mouse; selecionar uma imagem não substitui o ponteiro incorporado aos frames. O teste nativo compara pixels de duas exportações com trilha e estilos distintos e confirmou a troca. Para a inspeção desktop foi aberta uma cópia temporária de `Primeiro take.framestudio`, sem editar o original.

## Contador de gravação e cortes

- Contador alimentado por eventos `recording-time` do auxiliar nativo, limitados a 10 Hz e ancorados ao timestamp do primeiro frame. O evento final usa o mesmo instante que encerra a sessão do writer. Não há um segundo relógio React independente. A formatação em milissegundos trata a virada de minuto sem exibir 60 segundos no mesmo minuto.
- Timeline com divisão no marcador (⌘B), seleção/exclusão de trechos e zooms (Delete/Backspace), limpar zooms, restaurar cortes e undo/redo. Ao apagar um trecho, o áudio, cursor e câmera usam o mesmo mapeamento de tempo.
- A régua mantém as posições da mídia original para identificar os cortes; o transporte e a duração da edição mostram o tempo dos trechos mantidos. A prévia pula os intervalos removidos.
- Exportação monta os intervalos em AVMutableComposition sem arquivos intermediários e mantém as trajetórias de câmera/cursor no tempo da fonte. O arquivo final concatena os trechos e suas faixas de áudio.
- Os metadados de cortes são salvos no pacote com schema 3; sem cortes, o salvamento continua em schema 2. Versões 1 e 2 continuam aceitas. A validação rejeita cortes vazios, invertidos, sobrepostos e fora da mídia, e protege o último trecho.

## Máscaras e destaques

- A faixa de efeitos armazena intervalos no tempo original da mídia; o preview e a exportação mantêm a posição do retângulo no quadro enquanto a câmera faz zoom ou pan.
- Máscaras aplicam desfoque localizado; destaques usam uma camada amarela com opacidade ajustável. Arraste para mover, redimensione pela alça ou ajuste geometria e duração no inspector.
- Os efeitos são preservados ao salvar o pacote (schema 5), exportados pelo compositor CoreImage e limitados/validados no backend. A suíte nativa compara pixels para garantir que ambos os efeitos alterem o vídeo final.

## Música de fundo

- O painel Áudio adiciona uma faixa local, controla o volume e permite trocar ou remover a música; a faixa repete até o fim da edição e o áudio original permanece intacto.
- A prévia acompanha a linha do tempo editada, incluindo cortes e velocidades por trecho. A exportação mistura a música com as faixas originais.
- Ao salvar, arquivos externos são copiados para `audio/` no pacote `.framestudio`; projetos com trilha usam schema 6. A validação cobre arquivo, volume e persistência ao mover o pacote.

## Gravação com webcam

- A gravação pode incluir a câmera padrão do Mac em um arquivo MOV separado, sincronizado à captura de tela; o app solicita permissão de câmera quando necessário.
- O inspector oferece formatos circular, quadrado e cantos arredondados. Arraste a sobreposição na prévia ou ajuste seu tamanho; posição e formato são salvos no pacote (schema 8) e aplicados também na exportação.
- A faixa da webcam é incluída no pacote `.framestudio`, mantendo a edição funcional ao mover o projeto.
