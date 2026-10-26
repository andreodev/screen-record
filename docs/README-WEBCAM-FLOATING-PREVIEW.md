# Preview flutuante da webcam

## Objetivo

Exibir a webcam em tempo real em uma janela flutuante, sempre visível enquanto o usuário utiliza outros aplicativos. A janela serve apenas para monitoramento e não pode aparecer no vídeo gravado.

Implementado no aplicativo. Ative **Webcam** na barra de gravação para abrir a prévia. O cabeçalho permite arrastar ou mover com as setas; o canto inferior direito permite redimensionar ou usar as setas. A câmera pode ser escolhida na janela e no painel **Webcam**. Durante a captura, o seletor é substituído por **Parar gravação**.

## Comportamento esperado

1. O usuário ativa a webcam no Frame Studio.
2. O aplicativo abre uma janela nativa independente da interface principal.
3. A janela fica sempre no topo, sem bordas e pode ser arrastada.
4. O preview continua visível enquanto o usuário trabalha em qualquer aplicativo.
5. A tela é gravada sem incluir essa janela flutuante.
6. A webcam é gravada separadamente em `webcam.mov`.
7. A webcam só é composta sobre o vídeo durante a exportação, permanecendo editável.
8. A janela é fechada quando a gravação termina ou a webcam é desativada.

## Arquitetura

```text
Captura da webcam
        ├──> webcam.mov ----------------------┐
        └──> frames ao vivo                   │
                    │                          │
                    v                          v
        Janela flutuante independente     Exportação/editing
        visível sobre outros apps         compõe webcam no vídeo
                    │
                    └── excluída da captura da tela
```

## Implementação

- `src-tauri/src/camera_preview.rs`: estado, criação, posição, proteção, frames e encerramento da janela nativa; controle serializado da câmera para trocar dispositivos sem abrir sessões concorrentes.
- `src-tauri/src/studio.rs`: transição entre prévia e gravação, encaminhamento de frames e finalização segura da captura.
- `src-tauri/src/lib.rs`: registrar o estado e os comandos da janela.
- `src-tauri/src/windows_media.rs`: continuar enviando os frames da câmera e controlar a integração durante a captura.
- `src-tauri/native/FrameNative.swift`: fornecer os frames no macOS e excluir a janela do preview da captura de tela.
- `src/App.tsx`: abrir o preview ao ativar a webcam e enviar atualizações de posição e dispositivo.
- `src/CameraPreview.tsx`: interface independente, câmera, mensagens de permissão, movimento, tamanho e parada da captura.
- `src/main.tsx`: montar apenas a interface correspondente à janela.
- `src-tauri/capabilities/camera-preview.json`: permissões para eventos, movimento e tamanho da prévia.
- `src/webcam.css`: manter os estilos visuais da janela e da imagem da câmera.
- `src-tauri/src/windows_media/render.rs`: manter a composição da webcam somente na exportação.

O compositor existente foi reutilizado. Não foram adicionadas dependências nem alterado o formato do projeto para esse recurso.

## Regra essencial

A janela flutuante precisa ser excluída explicitamente da captura de tela. Se a plataforma não permitir essa exclusão diretamente, a captura deverá ignorar a janela do Frame Studio por identificação nativa.

Esconder a janela durante a gravação não atende ao objetivo, porque o usuário precisa continuar vendo a webcam enquanto trabalha em outros aplicativos.

No macOS, o helper recebe o PID do aplicativo e exclui a janela com título **Frame Studio — Webcam** pelo filtro `SCContentFilter(display:excludingWindows:)`, além da proteção nativa da janela. A identificação combina PID e título para não excluir janelas homônimas de outros aplicativos. Capturas de janela usam a fonte independente e recusam a própria prévia. [Filtro do ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:excludingwindows:)).

No Windows, a janela usa `WDA_EXCLUDEFROMCAPTURE`. O aplicativo lê a afinidade de volta e recusa abrir a prévia se a proteção não tiver sido aplicada. A prévia também é removida da lista de fontes e não pode ser selecionada diretamente. A exclusão exige Windows 10 versão 2004 ou posterior. [SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

## Requisitos da janela

- Sempre no topo.
- Independente da janela principal.
- Sem bordas do sistema.
- Arrastável.
- Com tamanho inicial pequeno e redimensionável, se a plataforma permitir sem complexidade extra.
- Com fechamento automático ao terminar a gravação.
- Sem áudio próprio.
- Sem alterar o conteúdo de `recording.mov`.

## Fluxo de estados

### Antes da gravação

- Ativar a webcam inicia a captura dos frames.
- A janela flutuante aparece.
- O usuário escolhe a câmera e posiciona o preview.
- O último posicionamento é conservado durante a sessão, desde que o monitor continue disponível.

### Durante a gravação

- A janela permanece visível sobre outros aplicativos.
- O motor grava a tela separadamente da webcam.
- A posição da janela pode ser alterada sem alterar a gravação da tela.

### Depois da gravação

- O preview é fechado.
- `recording.mov` contém somente a tela.
- `webcam.mov` contém somente a webcam.
- A exportação compõe a webcam sobre a tela conforme as opções do projeto.
- Fechar o aplicativo durante a captura pede a parada do motor e espera a finalização do arquivo antes de sair.

## Validação

Verificações executadas nesta implementação:

- Build macOS e testes Rust/TypeScript.
- Janela independente e sempre no topo, sem bordas; movimento e tamanho pelo teclado, troca de dispositivo e tela de permissão negada em cenário sintético.
- Captura real pelo ScreenCaptureKit com um marcador visível na prévia: 120.701 pixels antes da exclusão e zero depois. Nesse teste, a proteção nativa foi temporariamente desligada para verificar o filtro explícito.
- Gravação real de `recording.mov` com a prévia ainda visível: o marcador não apareceu no arquivo.
- Repetição com a proteção nativa ligada, como no uso normal: zero pixels do marcador na captura e no arquivo gravado.
- Checagem de tipos do worker Windows, incluindo a exclusão da prévia na seleção de fontes.
- Exportação 720p30 comparada com e sem uma webcam sintética, mantendo a câmera como camada independente.
- Saída com ⌘Q durante uma captura real: MOV válido de 5,08 segundos, projeto schema 13 e 604 amostras de cursor preservadas. O menu de saída passa pela finalização do motor, com proteção adicional no evento de encerramento nativo.

O teste automatizado usa imagens sintéticas para a webcam. A câmera física, a troca entre dois dispositivos reais e a execução do aplicativo no Windows ainda precisam de validação no hardware.

Arquivos de verificação: `tests/floating-preview-benchmark.js` e `tests/FloatingPreviewCapture.swift`. O primeiro é ativado somente pelo diagnóstico de build debug; o segundo reutiliza o mesmo filtro e a mesma classe de captura usados na gravação normal.

- Abrir a janela e confirmar que ela permanece visível sobre outros aplicativos.
- Arrastar a janela e confirmar que a posição acompanha o preview.
- Gravar a tela usando outro aplicativo enquanto o preview permanece visível.
- Verificar que `recording.mov` não contém o preview flutuante.
- Verificar que `webcam.mov` foi criado separadamente.
- Exportar o projeto e confirmar que a webcam aparece como camada editável.
- Testar permissão negada.
- Testar troca de câmera.
- Testar parada da gravação.
- Testar fechamento do aplicativo durante a captura.

## Riscos

- Cada sistema operacional pode oferecer uma API diferente para excluir uma janela da captura.
- No macOS, a exclusão foi validada com o ScreenCaptureKit e com o arquivo gravado; faltam sessões longas e múltiplos monitores.
- No Windows, a proteção é verificada ao abrir a janela, mas a execução real com o capturador GDI ainda precisa de validação.
- Se a exclusão nativa não funcionar, o preview poderá aparecer no vídeo final mesmo estando separado da webcam.

