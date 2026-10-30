# Frontend do Frame Studio

## Composição

O app inicia no launcher de captura de `recorder/RecorderLauncher.tsx`, fora da
árvore do editor. A configuração tem 460 × 370 pixels lógicos.
`useWorkspaceFlow` coordena configuração, gravação em segundo plano e edição.
A edição só é montada ao importar/abrir mídia ou receber
`recording-finished`; parar a gravação aguarda a finalização do arquivo.

O módulo nativo `workspace.rs` alterna tamanho, decoração, proteção de captura
e prioridade da janela principal. A configuração fica no topo; durante a
gravação, a janela e a prévia da webcam ficam ocultas. Não há widget ou
contador sobre a tela. O editor volta a ser uma janela normal.
As fontes nativas suportadas são monitor, área e janela.

`recording_tray.rs` mantém os comandos Pausar, Retomar e Parar/abrir editor na
bandeja do Windows e na barra de menus do macOS. `recording_session.rs` pausa
finalizando o worker nativo: tela, áudio e câmera não continuam gravando durante
a pausa. Retomar inicia outro trecho; ao parar, os trechos são unidos e os
eventos do cursor recebem o deslocamento correspondente. Microfone e webcam
são alinhados à duração dos trechos da tela. Os trechos temporários são
preservados em caso de falha e apagados apenas após a união bem-sucedida.

`App.tsx` configura Motion e monta o editor. Não contém estado do projeto,
eventos nativos, cálculos de câmera ou markup de painéis.

`editor/useEditorController.ts` conecta os módulos e fornece contratos
tipados à view: captura, diálogos, cabeçalho, preview, ferramentas, inspector, timeline
e status. `editor/EditorView.tsx` apenas compõe essas áreas. A UI não depende
do tipo de retorno do controller; os contratos vêm dos componentes.

## Responsabilidades

| Área                      | Módulos                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Projeto e histórico       | `useProjectHistory`, `useProjectLifecycle`, `useProjectFiles`, `useProjectRecovery`                        |
| Seleção e propriedades    | `useEditorSelection`, `editorMutations`, `editorInteractions`, `useTimelineCommands`                       |
| Captura                   | `useCaptureSetup`, `recordingOperations`                                                                   |
| Preview e playback        | `usePreviewSession`, `usePreviewModel`, `usePreviewRenderer`, `renderPreviewCanvas`, `usePlaybackControls` |
| Áudio, legendas e ritmo   | `usePacingAnalysis`, `mediaTools`                                                                          |
| Exportação                | `useExportSettings`, `videoExport`                                                                         |
| Assets e comandos nativos | `useStudioAssets`, `useNativeAction`                                                                       |

Hooks possuem estado ou efeitos React. Fábricas `create*` montam comandos
com dependências explícitas. Os algoritmos de zoom, crop, webcam e timeline
continuam nos módulos de domínio existentes.

## Interface

`src/ui` contém cabeçalho, timeline, transporte, diálogos, feedback e um
componente para cada painel. `EditorInspector` faz o roteamento e mantém os
campos compartilhados de exportação fora do painel ativo.

`ui/preview` separa toolbar, composição da cena, elementos de mídia e webcam.
Refs de mídia permanecem estáveis em `usePreviewSession`; trocar de painel
não remonta o vídeo.

## Identidade e animação

A identidade usa grafite quente, acento lima e âmbar, com tokens em
`styles/studio.css`. As regras legadas permanecem em `App.css`, `timeline.css`
e `webcam.css`; novos estilos devem usar tokens e ficar próximos de sua área,
sem acrescentar sobrescritas ao CSS legado.

Motion anima a entrada dos painéis e a seleção de ferramentas.
`MotionConfig reducedMotion="user"` respeita a preferência do sistema.
`LazyMotion` carrega os recursos de animação em um chunk separado. O motor de
vídeo e a exportação não dependem das animações da interface.

## Verificação

- `npm run build`: TypeScript estrito e build de produção.
- `npm test`: testes de domínio, incluindo validação da área de captura.
- `npm run test:frontend`: testes em Edge headless com fixtures de vídeo e
  uma ponte Tauri simulada. Requer Edge e o FFmpeg já usado pelo projeto.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: testes Rust.
- `npm run test:recording:native`: no Windows, compila o app e verifica a união
  dos trechos e o fluxo real no Tauri/WebView2. O teste usa um worker de vídeo
  sintético habilitado apenas em debug e por configuração explícita; não captura
  a tela, câmera ou microfone do usuário.

Os testes de navegador verificam layout em quatro tamanhos, troca dos painéis,
campos compartilhados, arraste de zoom, undo/redo, preferência de movimento
reduzido, reprodução com faixas auxiliares, recorte e configurações exportadas.
A suíte de recorte também inspeciona pixels do preview com motion blur.
Esses testes não substituem a validação de permissões e captura no desktop nativo.

A suíte do launcher também verifica inicialização sem editor, seleção de
dispositivos, envio das opções ao motor, ocultação durante captura/pausa, espera
pela finalização, retorno à edição, importação e recuperação de falhas.
O teste nativo confirma que pausar encerra o worker, retomar cria outro trecho e
parar durante a pausa finaliza o projeto e restaura a janela do editor.
