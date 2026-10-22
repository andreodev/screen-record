# Validação do zoom 9:16 do Frame Studio

## Causa encontrada e correção

O resultado anterior de 22–26% da altura veio de um teste inválido: foi exportado com `src-tauri/target/debug/frame-native`, binário de 23:54, anterior ao código nativo atual (00:26). Ao recompilar `FrameNative.swift` e exportar o mesmo projeto com as mesmas chaves e timestamps, o vídeo cresceu conforme esperado.

Também corrigi a translação do preview. O CSS escalava a camada a partir do canto superior esquerdo, mas o deslocamento subtraía a posição base sem escalá-la. Assim, em zoom, o layer não chegava à posição calculada pela câmera. Agora preview usa `cameraViewportTransform`, que calcula a translação para que a caixa transformada coincida com `cameraFrame`, como no exportador.

Não havia `overflow` limitando a camada ao tamanho inicial: `.scene` recorta no canvas de saída e o viewport acompanha a escala. O exportador aplica `fit × camera.scale` uma vez, sem acumular escala base e zoom. A proporção continua preservada, porque o `fit` mantém as dimensões da gravação; no modo 9:16 o layer pode sair pelas laterais e o canvas faz o recorte final.

## Medidas no mesmo projeto e timestamps

Projeto ativo: gravação 1920×1080, duração 10,855 s, saída 9:16 a 1080×1920 e 30 fps. A camada base é aproximadamente 886×498 px (82% da largura e 25,9% da altura). O planejador escolhe escala de câmera até 2,6× para as regiões de interesse mobile.

| Timestamp | Antes (helper antigo) | Depois (helper recompilado) |
|---:|---:|---:|
| 2,9 s | 80% largura × 25,9% altura | 100% largura × 57,8% altura |
| 5,5 s | 82% × 26,0% | 100% × 67,5% |
| 8,5 s | 75% × 25,9% | 100% × 63,0% |
| 10,5 s | 82% × 25,9% | 100% × 67,5% |

Largura/altura são limites aproximados da camada visível; as laterais são cortadas pelo canvas vertical quando a gravação ampliada ultrapassa as bordas. A gravação não é distorcida. Antes e depois usam o mesmo projeto, vídeo, keyframes e tempos. A única diferença no export é o binário do renderizador (antigo versus recompilado do código atual).

## Arquivos de revisão

- [Vídeo anterior](frame-studio-9-16-before-stale.mp4) e [frames antes](before-2.9.png), [antes 5,5 s](before-5.5.png).
- [Novo vídeo 9:16](frame-studio-9-16-after.mp4) e [frames depois](frame-2.9.png), [depois 5,5 s](frame-5.5.png), [depois 8,5 s](frame-8.5.png).
- [Medições e configuração completa](measurements.json).

O preview foi alinhado ao mesmo cálculo de câmera do export. A equivalência espacial é coberta por teste unitário: aplicar scale e translação CSS à origem base deve colocar o layer exatamente em `cameraFrame.left/top`. Build e testes de câmera/cursor passaram. A reprodução visual no app Frame Studio não foi automatizada nesta sessão; validei o vídeo exportado e os frames extraídos diretamente.
