# Plano do episódio: Frame Studio + FocuSee

Data do mapeamento: 25/10/2026. Esta página junta o estado do Frame Studio com os recursos publicados pelo FocuSee. Ela define um produto local de gravação e edição rápida de demonstrações; não implica copiar implementação, identidade visual ou assets de terceiros.

## Execução em 25/10/2026

O usuário autorizou a execução. As entregas abaixo estão implementadas; o quadro original de lacunas, mais abaixo, preserva a proposta e deve ser lido junto deste estado atualizado.

| Entrega | Estado e alcance | Verificação |
| --- | --- | --- |
| Seleção da captura | Monitor, janela e área; 1080p/4K e 30/60 fps, com limites e validação das coordenadas. Implementações macOS e Windows | Build macOS e checagem do motor para o alvo Windows; captura física, Retina, janela móvel e desconexão ainda exigem uso real |
| Anotações | Texto, seta, retângulo, elipse, spotlight e lupa, além de máscara/destaque; camadas simultâneas, arraste, teclado e controles temporais | Persistência Rust, composição nativa e fluxo automatizado no aplicativo: criar, pré-visualizar, salvar e exportar |
| Cursor | Círculo/onda de clique e ocultação por inatividade com fade; monitor de down/up complementa a posição amostrada no macOS | Teste da atividade e composição nativa; precisão dos eventos e permissões ainda precisam de calibração física |
| Ritmo | Análise RMS local, forma de onda e sugestões revisáveis de silêncio; aceleração de digitação para 2×, preservando cortes e ajustes por trecho | Testes de intervalos, preservação da edição e análise de áudio sintético |
| SRT | Importar e editar texto, tempo, cor e geometria; posição fixa no canvas; cortes/velocidade seguem os tempos da mídia original | Parser com rejeição de intervalos inválidos e composição nativa |
| Marca d’água | Texto configurável com geometria, opacidade e duração, fixo no canvas | Preview, autosave e exportação no aplicativo |
| Exportação | H.264, HEVC, ProRes 422 LT/422/422 HQ/4444; qualidade Web/Equilibrada/Alta em H.264/HEVC | Arquivos curtos decodificados; codec, resolução, duração e timestamps conferidos no macOS |
| Recentes e recuperação | Até 20 projetos; recuperação por backup válido, preservando o manifesto danificado e recusando schema futuro | Testes de pacote e recuperação; abrir projetos mantém as validações dos caminhos internos |
| Compatibilidade | Schema 12; migração das máscaras antigas com crop para manter o posicionamento exportado | Round-trip de pacote e teste de migração idempotente |

O empacotamento macOS agora usa o auxiliar compilado em `target/frame-native/`, evitando que o bundle debug inclua o binário antigo de `native/FrameNative.app`.

Correções do levantamento: captura de áudio do sistema/microfone no macOS, som de clique e keyframes/layouts por proporção da webcam **já existiam**. O trabalho reaproveitou essa base. A prévia de efeitos exibia só a seleção; agora mantém as camadas ativas. O arraste acumulava o deslocamento total; agora parte da geometria inicial. O backend rejeitava `video-blur`, apesar de os compositores o suportarem; a validação foi corrigida.

### Pendências que permanecem no plano

1. **Confiabilidade em hardware:** gravações reais longas, Retina/múltiplos monitores, movimento de janela, sincronismo e consumo de memória/CPU. A compilação Windows não comprova execução nesse sistema.
2. **Webcam principal e tela em apoio:** os keyframes e as variantes por proporção existem; o novo layout composto, com inversão do papel das fontes, continua pendente.
3. **Áudio completo:** fades e waveform na timeline, mixer mais completo e tratamento de voz no macOS. A forma de onda desta entrega fica na ferramenta Ritmo; o processamento de captura Windows continua existente.
4. **Legendas e fala:** dividir/unir blocos na interface, transcrição e remoção de fillers. A análise de silêncio não reconhece palavras; transcrição depende de definir o motor local, privacidade e custo.
5. **Saídas e produtividade:** GIF, frame PNG/clipboard, presets completos de marca/destino, timeline com zoom/scroll/miniaturas e múltiplos takes.
6. **Após o MVP:** teleprompter, atalhos sobrepostos, 3D, avatar, remoção de fundo, dispositivos móveis e serviços online seguem fora desta implementação inicial.

## Proposta

Gravar tela, câmera e áudio em um fluxo local; gerar uma edição inicial com foco automático; permitir corrigir zooms, cursor e explicações visuais; exportar versões prontas para diferentes formatos sociais. O diferencial é combinar a composição visual e o acabamento do Screen Studio com a edição guiada, anotações e ritmo automático apresentados pelo FocuSee.

## Já existe no Frame Studio

- Captura de tela, cursor separado e geração de zoom automático/manual/híbrido.
- Preview e exportação nativos, H.264 até 4K60, com fundo, cursor, motion blur e transições de câmera.
- Timeline com cortes, velocidade por trecho, undo/redo e pacotes de projeto locais.
- Webcam em picture-in-picture, formatos circular/quadrado/arredondado e zoom/movimento próprios.
- Áudio do sistema e microfone em Windows; áudio preservado/importado e música de fundo no editor.
- Máscara de desfoque e destaque temporizados; presets, fundos, gradientes, sombras e proporções vertical/quadrada.
- Processamento de voz (supressão, filtro de graves, compressor e limitador) na captura Windows.

## Proposta original antes da execução

| Prioridade | Área | Estado atual | Entrega que fecha a lacuna |
| --- | --- | --- | --- |
| P0 | Edição explicativa | Há máscara e destaque; não há suite geral de anotações | Texto, setas e formas com posição e duração na timeline; spotlight/magnifier e blur reutilizando as primitivas existentes |
| P0 | Captura macOS completa | Tela e webcam existem; seleção de janela/área e áudio de sistema/microfone ainda faltam no macOS | Capturar região/janela e sincronizar tela, câmera, microfone e áudio de sistema com tratamento claro de permissões |
| P0 | Cursor e foco | Autozoom, cursor configurável, suavização e motion blur existem | Efeito e som de clique; ocultação por inatividade; validar eventos breves, precisão dos cliques, forma contextual e cantos em sessões reais |
| P0 | Ritmo de edição | Cortes, velocidade por trecho e música existem | O corte de silêncio/fillers e a aceleração de trechos de digitação ainda não existem; começar com detecção local revisável, sem remover conteúdo automaticamente sem prévia |
| P0 | Webcam/layouts | PiP básico e geometria salva existem | Layouts alternáveis ao longo da gravação/timeline, transições e opção de webcam como quadro principal com tela em apoio |
| P1 | Legendas | Ausentes | Importar SRT e editar texto/tempo/estilo na timeline; geração automática de fala fica condicionada a solução local/privacidade e custo definidos |
| P1 | Exportação social | Resoluções e 16:9, 9:16, 1:1 já existem | Presets de destino com área segura e enquadramento ajustável; validar qualidade e conteúdo em cada proporção |
| P1 | Identidade visual | Presets locais existem | Marca d'água configurável e preset completo reutilizável |
| P1 | Áudio | Música, áudio de origem e processamento de voz Windows existem; mixer e waveform são limitados | Waveform/monitoramento, mute/volume/fades por fonte e redução de ruído macOS |
| P1 | Formatos | MP4 H.264 é o caminho suportado | Qualidade configurável e avaliação de HEVC/ProRes/GIF, frame PNG e cópia para clipboard; manter apenas opções com saída validada |
| P2 | Animação avançada | Câmera, cursor e motion blur configuráveis | Efeito 3D/perspectiva opcional; exige protótipo e medição antes de entrar no fluxo principal |
| P2 | Ferramentas de apresentação | Ausentes | Teleprompter e exibição de teclas/atalhos; ficam fora do MVP até confirmar prioridade de uso |
| P2 | Organização | Projetos locais e autosave existem | Recentes, recuperação automática de backup e captura de múltiplos takes em um projeto |
| P2 | Recursos de IA/serviço | Não fazem parte do produto local atual | Avatar virtual, remoção de fundo de webcam, publicação/link online e integrações externas; não entram sem decisão explícita sobre privacidade, operação e custo |

## Sequência proposta

1. **Fechar confiabilidade do núcleo:** captura macOS completa, áudio sincronizado, precisão do cursor e medições de sessões longas/4K.
2. **Edição de demonstração:** anotações temporizadas, spotlight/magnifier e refinamento do cursor/cliques, aproveitando os tipos de efeito e a timeline atuais.
3. **Ritmo inteligente revisável:** detectar silêncio, fillers e trechos de digitação; apresentar sugestões/cortes na timeline para revisão antes da exportação.
4. **Composição de câmera:** layouts e transições editáveis por trecho, incluindo vertical com câmera dominante.
5. **Entrega social:** presets de proporção/destino, marca d'água e exportação adicional somente após validação de cada formato.
6. **Acabamento:** waveform/mixer, SRT, recentes/recuperação; avaliar teleprompter e efeitos 3D depois do MVP.

## Continuação

A implementação já começou pela captura e pelas anotações e alcançou ritmo, SRT, marca d’água, codecs e recuperação. O próximo incremento deve tratar as pendências acima, começando pela calibração de captura e pelo layout de webcam principal. Não é necessário aprovar novamente as etapas já autorizadas; recursos de IA e serviços mantêm as decisões de escopo registradas neste plano.

## Referências

- FocuSee [página do produto](https://focusee.imobie.com/): autozoom, cursor, IA, áudio, gravação, layouts, motion blur, legendas, presets e exportação.
- FocuSee [auto zoom e cursor](https://focusee.imobie.com/features/auto-zoom-and-cursor-animation.htm): zoom ajustável, estilo/efeito/som de clique e ocultação em inatividade.
- FocuSee [anotações](https://focusee.imobie.com/features/annotation.htm): texto, setas, formas, spotlight, magnifier, blur e controle temporal.
- FocuSee [roadmap público](https://focusee-voice.imobie.com/roadmap): pedidos e itens em andamento; usado como sinal secundário, não como garantia de produto.
- Estado interno detalhado: [IMPLEMENTACAO.md](IMPLEMENTACAO.md), [PARIDADE-SCREEN-STUDIO.md](PARIDADE-SCREEN-STUDIO.md), [BIBLIOTECA-VISUAL.md](BIBLIOTECA-VISUAL.md), [DESEMPENHO.md](DESEMPENHO.md) e [README.md](../README.md).

## Limites do levantamento

Recursos do FocuSee foram levantados das páginas públicas, não de uma avaliação prática do aplicativo. IA de legendas/avatar/remoção de fundo e publicação em nuvem não são requisitos assumidos para o produto local. Os estados do Frame Studio foram cruzados com documentação e busca no código; não houve nova execução manual de todos os fluxos.
