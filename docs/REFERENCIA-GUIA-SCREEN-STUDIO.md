# Ideias de desenvolvimento a partir do guia do Screen Studio

Consulta: 21/10/2026. Foram lidos o índice e 19 artigos sobre animações, zooms, cursor, edição, captura, aparência, presets e exportação. Não foi feita uma leitura de todos os artigos do guia nem dos vídeos incorporados.

As descrições abaixo resumem o comportamento documentado. A ordem, os critérios de aceite e as soluções para o Frame Studio são propostas nossas, baseadas também na leitura de `App.tsx`, `zoom.ts`, `timeline.ts`, `studio.rs` e `FrameNative.swift`. Não representam funcionalidades já entregues.

## O que o guia esclarece sobre animação

Fonte: [Animations](https://screen.studio/guide/animations).

- Tela e cursor têm estilos separados. Focado prioriza estabilização e leitura; Suave prioriza fluidez. O cursor oferece Suave, Médio, Rápido e sem animação.
- Motion blur tem intensidade ajustável e controles avançados distintos para movimento do cursor, aproximação/afastamento e deslocamento da tela ampliada.

No Frame Studio, os estilos e a inércia já têm implementação. Motion blur ainda falta. O guia não fornece constantes de mola, algoritmo de integração ou calibração: esses detalhes não podem ser deduzidos somente dessa documentação.

Proposta: manter os controles simples na primeira vista e colocar os três ajustes de blur em uma seção avançada. Primeiro validar cursor e câmera separadamente com sequências curtas. Aceite: pausa e busca reproduzem o mesmo quadro; prévia e exportação usam os mesmos parâmetros; blur zero preserva o resultado atual; medir o custo em 1080p30 e 4K60 antes de escolher os valores padrão.

## Próximos incrementos no editor

| Ordem proposta | Recurso e referência | Estado observado no código | Entrega concreta e aceite |
| --- | --- | --- | --- |
| 1 | [Cursor](https://screen.studio/guide/cursor), [ocultação por trecho](https://screen.studio/guide/hiding-the-cursor-in-specific-sections), [suavização por trecho](https://screen.studio/guide/disable-smooth-mouse-movement) | Tamanho, temas e suavização globais; sem opções de cursor nos trechos | Ocultar o cursor ou usar movimento original em um trecho selecionado. Mostrar indicação na timeline. Salvar, desfazer e exportar com o mesmo resultado. Depois acrescentar ocultação por inatividade e opção de seta fixa. |
| 2 | [Zoom instantâneo](https://screen.studio/guide/instant-zoom), [zoom manual](https://screen.studio/guide/manual-zoom), [zoom automático](https://screen.studio/guide/auto-zoom) | Zoom manual, sugestões por clique e seguimento; todos usam transição gradual | Adicionar opção instantânea por zoom e marcador de foco arrastável. No modo automático, explicar trechos sem clique. Distinguir foco em cliques de acompanhamento contínuo do cursor. Conferir início/fim, sobreposição e limites do enquadramento. |
| 3 | [Velocidade por trecho](https://screen.studio/guide/speeding-up-the-video) | Velocidade só da prévia; cortes são intervalos da fonte | Persistir velocidade por trecho e aplicá-la na reprodução e exportação. Recalcular duração e mapear vídeo, áudio, cursor e câmera pelo mesmo tempo da fonte. Testar cortes combinados com velocidades diferentes. |
| 4 | [Crop](https://screen.studio/guide/cropping-the-recording), [fundo](https://screen.studio/guide/background) | Proporção de saída, fundos, margem, cantos e sombra; sem crop da fonte ou imagem própria | Recortar a gravação por alças e dimensões, separadamente da proporção de saída. Recalcular cursor e foco dentro do recorte. Incorporar imagens próprias ao pacote para o projeto continuar portátil. |
| 5 | [Máscaras e destaques](https://screen.studio/guide/adding-a-mask-and-highlight) | Ausentes | Faixa de duração com retângulo editável para ocultação ou destaque. Definir coordenadas e interação com zoom/crop. Verificar quadros nas bordas do intervalo. O guia alerta que a máscara não acompanha o conteúdo durante scroll. |
| 6 | [Presets](https://screen.studio/guide/creating-preset) | Um padrão local e presets fixos | Presets nomeados de aparência e animação. Aplicação deve preservar cortes e mídia. Importar/exportar somente configurações e recursos necessários. |

A ordenação considera a proximidade com o motor atual. Motion blur pode ser desenvolvido junto dos primeiros incrementos, mas exige validação de desempenho antes de ser ativado por padrão.

## Captura e recursos com mais dependências

- **Janela e área:** o guia permite [escolher uma janela](https://screen.studio/guide/recording-single-window) ou [desenhar uma área e informar dimensões](https://screen.studio/guide/recording-area). Nossa captura ainda usa o monitor principal. Implementar seleção de fonte e converter coordenadas do cursor para a região capturada; validar Retina, múltiplos monitores e janela movida durante a captura.
- **Áudio:** o [guia de áudio do sistema](https://screen.studio/guide/recording-system-audio) descreve seleção de todos os aplicativos ou de um grupo. Nossa captura ainda não grava áudio. Começar por sistema e microfone com fontes e permissões explícitas; depois seleção por aplicativo e mixer. Aceite inclui sincronismo e finalização segura.
- **Webcam:** os [layouts dinâmicos](https://screen.studio/guide/dynamic-camera-layouts-) alternam entre câmera em tela cheia, câmera com tela e câmera oculta por intervalos. Isso depende de captura sincronizada da webcam antes de criar a faixa de layouts.
- **Legendas:** o [guia de legendas](https://screen.studio/guide/captions) descreve transcrição local, revisão de texto e exportação da transcrição. Proposta: começar por legendas editáveis/importadas; depois integrar transcrição local e decidir disponibilidade por versão do macOS.
- **Exportação:** o [guia de configurações](https://screen.studio/guide/explanation-of-export-settings) separa qualidade, resolução, formato e fps. Já temos resolução/fps e MP4 H.264. Evoluir qualidade e formatos com testes de arquivo real. As estimativas de tempo apresentadas pelo guia não são benchmarks do nosso compositor.

## Regras para transformar as ideias em entregas

1. Cada controle deve participar do projeto salvo, undo/redo, prévia e exportação.
2. Efeitos por trecho precisam de um contrato comum de tempo da fonte e tempo editado, especialmente ao introduzir velocidade.
3. Adicionar campos opcionais com defaults compatíveis; versionar quando um build antigo puder perder informação da edição.
4. Usar testes pequenos de trajetória, limites e mapeamento de tempo, mais exportações sintéticas para conferir os pixels e timestamps afetados.
5. Comparações visuais e gravações longas continuam necessárias; a leitura do guia não comprova equivalência com o produto.

O inventário geral e as limitações permanecem em [PARIDADE-SCREEN-STUDIO.md](PARIDADE-SCREEN-STUDIO.md).
