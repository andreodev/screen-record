# Estado das entregas — 21/10/2026

Todas as cinco partes receberam uma primeira implementação. Isso ainda não significa paridade completa com o Screen Studio.

| Parte | Implementado | Validação | Próximo trabalho |
| --- | --- | --- | --- |
| 1. Editor | Vídeo local real, layout com inspector, timeline, reprodução/seek, corte, pacotes `.framestudio` com mídia incluída, autosave, backup, prévia e salvamento atômico | Build; importação e zoom manual conferidos no desktop; projeto salvo com mídia relativa | Mais formatos/rotação e proteção dos vídeos importados ainda não salvos como pacote |
| 2. Captura | ScreenCaptureKit, início/parada, H.264, cursor excluído do vídeo, eventos separados, timestamps de host, extensão de períodos estáticos | Compilação nativa; permissão negada tratada; posteriormente observado take real de 8,7 s com 1.019 eventos e três zooms | Calibrar offset/cliques nos cantos, escalas e sessões longas; substituir polling por eventos de mouse |
| 3. Zoom | Sugestões por clique, agrupamento, follow com zona de tolerância, curvas suaves, crop limitado, seek determinístico, edição por inspector e arraste | Testes de agrupamento, continuidade, limites, posição do clique, suavização e follow; zoom manual visível na prévia | Mais calibração estética com gravações reais; sobreposições e cliques distantes agora têm transição contínua |
| 4. Exportação | CoreImage + AVFoundation; H.264 30 fps, aparência, cursor, corte, primeira faixa de áudio, progresso/cancelamento e destino temporário | Integração com mídia sintética: horizontal, 9:16, 1:1, áudio e cancelamento; duração e frames inspecionados | Comparação geométrica automatizada de pontos do compositor; HDR/rotação e gravações longas reais |
| 5. Comodidade | Preset local, autosave de pacotes, abertura por duplo clique, undo/redo, atalhos e proporções | Build e uso inicial no desktop | Recentes, recuperação, captura por janela/área, áudio, webcam e extras |

## Decisões que afetam o desempenho

- Um auxiliar nativo por operação, encerrado quando termina; sem serviço residente de captura/exportação.
- Fila de captura de três frames; vídeo não passa pelo JavaScript em base64.
- Preview usa o decoder do WebView e transformações sobre o elemento de vídeo; sem copiar cada frame em canvas 2D.
- Trajetória calculada fora do loop de reprodução. Apenas o playhead textual atualiza React em frequência reduzida.
- Exportação usa buffers nativos e camadas estáticas preparadas uma vez. Áudio e vídeo são drenados concorrentemente para evitar espera circular do writer.
- Quadros de saída são produzidos a 30 fps mesmo quando a fonte contém intervalos de tela parada; assim o zoom continua animado nesses intervalos.
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
