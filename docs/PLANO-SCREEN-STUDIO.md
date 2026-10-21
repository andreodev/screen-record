# Frame Studio — plano de implementação a partir do Screen Studio

Referência: Screen Studio 4.1.0-5005 instalado neste Mac; inspeção da interface em 21/10/2026, imagem fornecida pelo usuário e guias oficiais abaixo. Máquina alvo inicial: MacBook Air M1, 8 GB.

Objetivo: gravar → receber zooms automáticos bem enquadrados → ajustar poucos detalhes → exportar. Prioridade: leveza, suavidade e comodidade.

## Atualização de implementação

A primeira implementação das cinco partes foi iniciada. O [estado das entregas](IMPLEMENTACAO.md) distingue o que já funciona, os testes realizados e as pendências. As descrições abaixo preservam o plano original; o estado inicial do repositório é histórico.

## 1. O que foi constatado

Esta é uma análise funcional por observação. Não houve extração do código proprietário, cópia de assets, medição das curvas internas ou benchmark do Screen Studio. As escolhas técnicas adiante são propostas para nosso app, não afirmações sobre a implementação do concorrente.

| Área | Evidência na interface instalada | Prioridade no Frame Studio |
| --- | --- | --- |
| Gravador | Barra compacta; tela, janela, área, dispositivo, câmera, microfone e áudio do sistema | Tela primeiro; janela/área e áudio depois |
| Editor | Prévia central, painel direito contextual, ferramentas verticais, ações no topo | Essencial |
| Timeline | Faixa do clipe âmbar; faixa de zoom separada; playhead; controles de reprodução | Essencial |
| Zoom | Faixa permite adicionar zoom por clique/arraste; guia oficial descreve zoom por cliques e zoom manual | Prioridade máxima |
| Movimento | Painel Animations: tela Focused/Smooth, cursor Smooth/Medium/Rapid/None, intensidade de motion blur | Suavização primeiro; blur depois |
| Cursor | Tamanho, estilo, ocultar parado, loop, ocultar totalmente; efeito de clique None/Circle/Ripple e som | Cursor independente e suavização primeiro |
| Aparência | Wallpaper/Gradient/Color/Image/Unsplash, categorias, blur, padding, cantos, inset, sombra | Gradientes próprios, margens, cantos e sombra primeiro |
| Formato | Auto, Crop e qualidade da prévia | 16:9 primeiro; vertical depois |
| Fluxo | Presets, undo/redo, pasta do projeto, exportação | Salvar/reabrir e exportar no MVP |
| Extras | Interface oferece ocultação de dados sensíveis e rostos; guias incluem câmera, legendas e música | Após o núcleo; funcionamento desses extras não foi testado |

O visual a reproduzir no editor: fundo quase preto, divisórias discretas, prévia com amplo espaço, painel direito arredondado e rolável, roxo para seleção/zoom/exportação e faixa âmbar para o clipe. A barra compacta observada anteriormente é o gravador, não o editor da imagem.

## 2. Estado real do repositório

- React 19 + TypeScript + Tauri 2 + Rust; sem biblioteca adicional de interface/animação.
- `src/App.tsx` e `src/App.css`: interface do gravador adaptada à barra da referência. A representação da tela ainda não é vídeo real.
- `src-tauri/src/lib.rs`: comando assíncrono de gravação, trava de concorrência e acesso ao último arquivo no Finder.
- `src-tauri/src/capture.rs`: `screencapture` temporizado, monitor principal, sem áudio, MOV. Durações de 5/10/30 segundos.
- Ainda faltam: reprodução, timeline, metadados de cursor, zoom automático, compositor e exportação editada.
- Desktop compilado e aberto nesta sessão; build de frontend e bundle debug concluídos. A porta 1420 já estava ocupada por outro servidor; foi aberto o bundle local sem interrompê-lo.

## 3. Entregas em ordem

### Parte 1 — Editor mínimo com vídeo real

**Entrega:** abrir um vídeo e reproduzi-lo no layout da referência, mantendo a captura atual acessível por Nova gravação.

- Prévia central, inspector à direita, transporte e timeline embaixo.
- Importação local por diálogo nativo; leitura limitada aos arquivos escolhidos, sem expor todo o disco ao WebView.
- Play/pause, seek, duração real e ajuste de início/fim. O original permanece intacto.
- Fundo em gradiente/cor próprios, padding, raio e sombra. Sem copiar wallpapers do app instalado.
- Projeto local com versão de schema, referência relativa à mídia e ajustes. Salvamento atômico.
- Verificar suporte ao MOV atual no WKWebView; usar conversão/proxy apenas quando o codec exigir.

**Aceite:** vídeo importado e take recém-gravado abrem na prévia; seek e trim funcionam; salvar/reabrir conserva os ajustes; não há botões aparentando executar recursos inexistentes.

**Arquivos previstos:** separar gravador de `App.tsx` em `Recorder.tsx`; criar `Editor.tsx`, `Editor.css` e modelo simples de projeto conforme necessário. Comandos de diálogo/mídia no backend.

### Parte 2 — Captura sincronizada e cursor separado

**Entrega:** vídeo limpo e trilha de movimentos/cliques com o mesmo relógio.

- Fazer primeiro um experimento nativo pequeno com ScreenCaptureKit + AVFoundation. Confirmar codec, timestamps, permissões e custo no M1 antes de fechar a integração.
- Tauri continua como shell; código nativo fica restrito à captura/codec, com interface explícita para Rust. Escolher bridge Swift ou bindings Rust após o experimento, sem manter as duas opções.
- Iniciar/parar de verdade, sem duração fixa. Finalização segura e mensagens para permissão negada/disco cheio.
- Excluir o cursor dos frames e reconstruí-lo como camada independente. Não aceitar cursor duplo.
- Registrar movimento e botões apenas durante a sessão. Negociar as permissões exigidas pela API escolhida; não registrar teclado/conteúdo digitado.
- Tempo monotônico comum para início efetivo do stream, frames e eventos; incluir offset caso os relógios da API difiram.
- Coordenadas normalizadas relativas à fonte, com origem, orientação, escala Retina e geometria do monitor explícitas. Janela/área exigem transformação própria.
- Gravar dados em lotes no backend, com fila limitada. Sem IPC por frame/evento e sem vídeo codificado em base64.

**Aceite:** cliques no centro e nos quatro cantos coincidem com o vídeo; funciona em Retina e escala alterada; parar/reabrir não corrompe o take; ausência de permissão tem tratamento claro.

**Arquivos previstos:** adaptar `capture.rs`; criar módulo de eventos e backend nativo somente após o experimento; persistir mídia + eventos + projeto em uma pasta por sessão.

### Parte 3 — Zooms dinâmicos: o diferencial principal

**Entrega:** ao terminar de gravar, o vídeo já tem uma primeira edição automática utilizável.

1. Gerar segmentos a partir dos cliques, com antecipação curta e tempo para ler o resultado.
2. Unir cliques próximos no tempo e no espaço. Evitar entrar/sair do zoom repetidamente durante a mesma tarefa.
3. Escolher profundidade que conserve a região de interesse e margem de leitura.
4. Seguir o cursor com zona morta: movimentos pequenos não deslocam a câmera.
5. Quando o alvo muda muito de lugar, abrir o enquadramento ou transitar suavemente em vez de atravessar a tela em zoom fechado.
6. Interpolar centro e escala com velocidade contínua; garantir zoom mínimo 1 e nenhuma borda vazia durante a trajetória.
7. Suavizar cursor separadamente, preservando o ponto do clique no instante correto. Não filtrar o evento de clique para uma posição atrasada.
8. Permitir selecionar, mover, redimensionar, remover e desativar segmentos na timeline. Zoom manual tem prioridade sobre a sugestão automática.

**Parâmetros iniciais para calibrar, não valores extraídos do Screen Studio:** escala 1,4–1,8×; antecipação ~200 ms; entrada ~450 ms; permanência mínima ~900 ms; saída ~550 ms. Ajustar com gravações de leitura, formulários e navegação rápida.

**Motor:** função determinística `cameraAt(time, segments)` retorna centro e escala. Trajetórias de câmera e cursor são pré-calculadas por trecho ou avaliadas pelo timestamp, independentes da taxa de frames. Começar com curvas suaves limitadas; adicionar modelo de mola apenas se a comparação visual justificar. Seek e reprodução contínua devem retornar o mesmo enquadramento.

**Controles iniciais:** Autozoom ligado, intensidade, movimento Focado/Suave e tamanho do cursor. Usar bons padrões; configurações avançadas ficam recolhidas.

**Aceite:** sem tremor parado, sem zoom por mero passeio do mouse, sem cursor cortado nas bordas, sem saltos entre cliques próximos; um segmento manual pode substituir o automático sem regenerar todo o projeto.

**Testes necessários:** limites do crop, segmentos sobrepostos, tempos fora do intervalo, seek determinístico, gravação sem cliques, clique duplo, cantos, arraste e alteração de proporção. Usar amostras sintéticas pequenas e vídeos próprios para inspeção visual.

### Parte 4 — Exportação que preserva a prévia

**Entrega:** MP4 H.264 1080p com fundo, zoom e cursor, salvo no Mac.

- Experimento de exportação já na Parte 1 para verificar que a escolha de preview permite o mesmo resultado final.
- Um contrato de cena comum: timestamp, retângulo de origem, transformação, padding, máscara, sombra e cursor. Prévia e exportação consomem os mesmos dados/curvas.
- Composição nativa acelerada e codificação por hardware quando suportada; validar o caminho em vez de assumir aceleração automática.
- Não transportar frames pela ponte JS/Rust e não renderizar o vídeo final por captura de tela da interface.
- Progresso, cancelamento e arquivo temporário; renomear o destino só após sucesso. Não sobrescrever o original.
- Verificar orientação, cores e nitidez de texto. Exportar frames de referência em instantes de entrada, permanência e saída do zoom para comparar com a prévia.

**Aceite:** arquivo abre no QuickTime; duração, cortes, cursor e enquadramento coincidem com o projeto; cancelamento não deixa um MP4 final inválido.

**Marco MVP:** gravar → autozoom → ajuste simples → exportar, sem montagem manual obrigatória.

### Parte 5 — Comodidade e acabamento

**Entrega:** reduzir trabalho repetitivo e aproximar o fluxo diário da referência.

- Preset padrão salvo automaticamente; projetos recentes e recuperação de rascunho.
- Undo/redo de alterações do projeto, atalhos de reprodução, cortes e zoom.
- Captura de janela/área, seleção de monitor, microfone/áudio do sistema com sincronização.
- 9:16 e 1:1 com novo cálculo de enquadramento, sem reaproveitar crops que cortem o alvo.
- Efeito discreto de clique, cursor maior e ocultação quando ocioso.
- Motion blur opcional só após medir custo e legibilidade. Começar pela exportação; não sacrificar resposta da prévia.
- Câmera, legendas, música, serviços online e ocultação automática de dados ficam para entregas posteriores ao MVP.

## 4. Arquitetura para ser leve

```text
ScreenCaptureKit → encoder nativo → arquivo de vídeo
Eventos do cursor → lotes locais → arquivo de eventos
                            ↓
                projeto editável + segmentos
                            ↓
               trajetória determinística
                    ↙              ↘
          prévia acelerada     exportação nativa
```

- React controla interface, seleção e inspector. Não chamar `setState` para cada frame do vídeo.
- Atualizar transformações/overlay pelo relógio de reprodução; parar o loop quando pausado, oculto ou sem mudança. Usar requestAnimationFrame durante reprodução para animar zoom/cursor também sobre frames estáticos.
- Ler mídia por streaming. Não carregar o arquivo inteiro em memória nem desenhar frames em canvas 2D por CPU como caminho padrão.
- Manter apenas um decoder ativo por prévia. Thumbnails sob demanda, cache limitado e cancelamento de tarefas antigas de seek.
- Preferir fontes do sistema, SVGs próprios e CSS; manter as dependências atuais até surgir necessidade concreta.
- Guardar edição como metadados; não transcodificar a cada ajuste. Gerar proxy reduzido só quando a fonte exceder o orçamento da prévia.
- Distinguir memória própria do app e custo dos processos WebKit; medir o conjunto para não esconder consumo.

## 5. Metas de desempenho a validar

Estas são metas propostas, não resultados já obtidos. Medir na máquina M1/8 GB com resolução, versão do macOS, codec e apps concorrentes registrados.

| Cenário | Meta inicial | Verificação |
| --- | --- | --- |
| Editor pausado | Sem loop contínuo de renderização; CPU próxima de idle | Instruments/Activity Monitor por 60 s |
| Projeto de 10 min em 1080p | Memória agregada idealmente abaixo de 450 MB; sem crescimento contínuo | Abrir, reproduzir, buscar e fechar 5 vezes |
| Prévia de movimento | 60 fps quando viável; reduzir resolução antes de perder responsividade | p95 de frame ≤16,7 ms; fallback 30 fps explícito |
| Inspector/timeline | Resposta p95 abaixo de 100 ms | Arrastar playhead e sliders com vídeo aberto |
| Captura padrão | 1080p30 estável, meta de frames perdidos <1% | Gravação de 10 min; contar timestamps/frames |
| Cursor/clique | Diferença ideal de até um frame da captura | Cliques visuais com timestamps conhecidos |
| Exportação | Memória limitada e UI responsiva | 10 min com zoom; medir tempo, RAM e cancelamento |

Não prometer exportação em tempo real, zero CPU ou 4K60 sem medição. Se a meta falhar, corrigir cópias de buffers, filas, decoder e resolução antes de adicionar cache ou dependências.

## 6. Primeira sequência de trabalho

1. Editor real com importação, play/pause e seek; preservar o gravador atual.
2. Experimento nativo de captura sincronizada e composição/exportação de uma cena curta.
3. Modelo de projeto e zoom manual determinístico, com testes de geometria.
4. Eventos do cursor e geração de zooms automática.
5. Cursor suavizado, presets Focado/Suave e calibração visual.
6. MP4 final com o mesmo resultado da prévia; benchmark do fluxo completo.

A Parte 1 melhora a interface; as Partes 2–4 entregam o produto. Não confundir uma animação demonstrativa com zoom automático aplicado a uma gravação real.

## 7. Fontes e limites da análise

- Interface do app instalado: captura enviada pelo usuário e inspeção dos painéis Background, Cursor e Animations. Somente navegação de painéis; sem alterar parâmetros do projeto da referência.
- [Zooms: geração por cliques, timeline e ajustes manuais](https://preview.screen.studio/guide/adding-editing-zooms).
- [Animações: perfis de movimento e motion blur](https://preview.screen.studio/guide/animations).
- [Cursor: tamanho, estilos, ocultação e tratamento do movimento](https://screen.studio/guide/cursor).
- [Apple: ScreenCaptureKit para captura de alto desempenho](https://developer.apple.com/documentation/screencapturekit).

Os guias podem descrever recursos de versões diferentes; a interface instalada é a referência visual principal. Algoritmo interno, uso de GPU e consumo do Screen Studio não foram determinados. O motor de zoom foi implementado e recebeu uma primeira medição de prévia/exportação longa, registrada em [DESEMPENHO.md](DESEMPENHO.md). Isso ainda não valida todas as metas acima.
