# Relatório: cursor em 16:9 e 9:16

## Método

Comparei a mesma gravação do projeto `Gravação-1792644400477421000.framestudio` nos exports 16:9 e 9:16. A gravação é 1920×1080, tem o cursor original removido do vídeo e fornece os movimentos em `recording.cursor.json`; portanto, o ponteiro visível no export é desenhado a partir desses eventos. Renderizei versões com e sem cursor para inspecionar o overlay, usando os mesmos keyframes de câmera. Examinei frames em 3,2 s, 4,0 s, 5,5 s e 8,5 s.

## Resultado

A posição do hotspot acompanha a transformação da câmera nos dois formatos. Nos quatro pontos amostrados, o ponto calculado para o cursor coincide visualmente com o local correspondente da interface; não encontrei inversão de eixo nem um deslocamento constante entre metadado e imagem. Isso indica que a falha observada não é uma conversão de coordenadas diferente no renderer 9:16.

O defeito visível no 9:16 é de enquadramento e escala do cursor: o cursor é ampliado pela escala da câmera, que chega a aproximadamente 2,6×, e em 5,5 s fica muito próximo da borda direita. A folga do canvas não leva em conta as dimensões e o hotspot do cursor. Isso faz o ponteiro parecer fora do lugar e pode cortar parte do desenho. No 16:9, o enquadramento mais amplo mantém o cursor longe das bordas, por isso o problema quase não aparece.

A diferença também se vê ao comparar os frames no mesmo instante: em 9:16 o cursor é proporcionalmente maior e o conteúdo é mais recortado; em 16:9 ele permanece menor dentro de uma área mais ampla. Não há evidência, nesta comparação, de que o cursor esteja sendo enviado para o lado oposto. Há evidência de que o plano de câmera mobile permite o hotspot e o corpo do cursor chegarem à margem sem uma margem de segurança.

## Amostras

As coordenadas abaixo são posições de hotspot calculadas pelo mesmo mapeamento câmera→canvas usado no preview/render; são pixels no canvas 1080×1920 (9:16) e 1920×1080 (16:9). Servem para conferir o ponto de ancoragem. A inspeção visual dos PNGs confirma o posicionamento; não são medições automáticas por segmentação de pixels.

| Tempo | 9:16 hotspot (x, y) | 16:9 hotspot (x, y) | Observação |
|---:|---:|---:|---|
| 3,2 s | (482, 718) | (903, 116) | Acompanha a área ativa nos dois formatos. |
| 4,0 s | (699, 750) | (1113, 135) | Sem deslocamento aparente; cursor maior no mobile. |
| 5,5 s | (1025, 1187) | (1618, 666) | No mobile, hotspot e desenho ficam perto da borda direita. |
| 8,5 s | (356, 734) | (649, 119) | Reposicionamento acompanha a troca de região. |

## Arquivos de evidência

- `9-16-cursor.mp4` e `16-9-cursor.mp4`: exports com cursor.
- `9-16-no-cursor.mp4` e `16-9-no-cursor.mp4`: mesmos exports sem cursor, para comparação do overlay.
- PNGs com timestamps no nome: frames usados na inspeção.
- JSONs com os parâmetros de renderização.

## Código conferido e validação

O preview posiciona o cursor por `cameraPoint` em `src/App.tsx`; o renderer nativo compõe o cursor no espaço da gravação antes de aplicar a câmera em `src-tauri/native/FrameNative.swift`. As duas rotas aplicam a transformação espacial da câmera ao cursor. O tamanho do ponteiro também cresce com `cam.scale`, o que explica a diferença visual mais forte no mobile.

Rodei `tests/zoom.test.ts`, `tests/cursor.test.ts` e `pnpm build`; todos passaram. Não alterei o código nesta verificação, porque as amostras não apontam para erro de coordenadas; apontam para falta de margem de segurança do cursor no planejamento de câmera 9:16. A correção indicada é incluir o retângulo visual do cursor/hotspot nos limites de enquadramento mobile e deslocar a câmera suavemente quando ele estiver prestes a ser cortado, preservando o cursor preso ao ponto real da gravação.
