# Paridade funcional — continuação em 21/10/2026

Esta matriz é histórica. O [estado atualizado da execução com FocuSee](PLANO-FRAME-STUDIO-FOCUSEE.md) registra as entregas de 25/10 e corrige os itens que já existiam no código.


Referência: instalação local Screen Studio 4.1.0-5005, interface e módulos recuperados. O objetivo é equivalência de fluxo, aparência e recursos; nenhum percentual de paridade foi medido. O Frame Studio ainda não está completo.

Ideias e critérios de desenvolvimento derivados da leitura do guia oficial: [REFERENCIA-GUIA-SCREEN-STUDIO.md](REFERENCIA-GUIA-SCREEN-STUDIO.md).

## Novas evidências

- O editor instalado continua acessível. Background, Cursor e Animations foram observados nesta sessão ou na anterior. A tentativa de abrir Export mostrou a tela de ativação; não foi possível comparar visualmente esse painel.
- `CHdhxnRg.js:23` contém as listas de formatos MP4, ProRes e GIF; MP4/ProRes oferecem 10, 20, 24, 25, 30, 50 e 60 fps e 720/1080/2160p. GIF oferece outra lista de taxas e 480/720/1080p.
- O mesmo módulo contém MP4 H.264/HEVC, perfis ProRes 422 LT/422/422 HQ/4444 e qualidades Studio/Social Media/Web/Web Low. Isso confirma opções estruturais; não valida o resultado de cada combinação.
- `B0echNca.js:354–378` descreve exportação, progresso, cancelamento e destinos, e relaciona áudio, webcam, máscaras, layouts e legendas ao projeto.
- `CWkC1JGa.js` expõe exportação para arquivo, clipboard e link. Links dependem de serviços e conta do produto.
- `DgH-sR-Y2.js:912–923` limita o canvas a 3840 × 2160, arredonda dimensões para números pares e aplica densidade de pixels. Nosso modo vertical admite o limite rotacionado (2160 × 3840), uma diferença deliberada.

Os caminhos acima são relativos a `~/Screen Studio Recovered/javascript/`. As listas vieram da leitura estática do material existente, sem executar módulos recuperados ou alterar a instalação.

## Ordem de implementação e aceite

| Ordem | Área | Estado do Frame Studio | Critério para fechar a lacuna |
| --- | --- | --- | --- |
| 1 | Exportar 4K/60 | Implementado neste incremento; opções 720/1080/1440/2160p e 24/30/60 fps | Arquivo horizontal 3840×2160/60, timestamps regulares, áudio, corte, geometria e cancelamento verificados |
| 2 | Captura em maior resolução e 60 fps | Pixels físicos preservados até 4K, sem ampliar; 60 fps solicitado ao ScreenCaptureKit | Seleção de qualidade e monitor, medir cadência real, frames perdidos, RAM e sincronismo em gravação longa |
| 3 | Captura por janela/área e áudio | Ainda ausentes | Seletores reais, coordenadas corretas, áudio do sistema/microfone sincronizado, mensagens de permissão e finalização segura |
| 4 | Cursor e zoom | Base funcional; polling, cursor fixo e calibração parcial | Eventos de mouse, forma contextual, clique visual/sonoro, ocultação por inatividade, rotação e trajetórias conferidas nos cantos |
| 5 | Timeline | Trim, cortes internos, múltiplos trechos, exclusão de trechos/zooms, undo, velocidade por trecho na prévia/exportação e cursor configurável por trecho | Ripple visual, zoom/scroll da timeline e miniaturas |
| 6 | Aparência | Wallpapers, gradiente/cor, blur, margens, cantos e sombra | Imagem própria, crop editável, inset/bordas, formatos livres, enquadramento vertical e comparação de frames |
| 7 | Animações | Câmera/cursor independentes, mola pré-calculada, zoom instantâneo e motion blur separado para cursor/zoom/deslocamento | Calibrar resposta visual e medir custo de blur em sessões longas; amostragem TS/Swift comparada em 420 casos |
| 8 | Exportação avançada | MP4 H.264 | HEVC, ProRes/perfis, GIF, qualidade configurável, frame PNG e clipboard; validar cada combinação oferecida |
| 9 | Webcam/layouts | Ausentes | Captura sincronizada, overlay, recorte, espelhamento, layouts e transições editáveis |
| 10 | Áudio/editor | Primeira faixa importada preservada | Mixer de fontes, mute/volume, waveform, música, redução de ruído e fade |
| 11 | Máscaras/legendas | Ausentes | Máscaras editáveis, redação, importação/edição de legenda, reconhecimento e controles de estilo |
| 12 | Comodidade | Pacotes, autosave, undo/redo, presets | Recentes, recuperação de backup, atalhos completos e matriz de compatibilidade |
| 13 | Dispositivos e serviços | Ausentes | Captura de dispositivos, molduras, compartilhamento por serviço próprio e autenticação própria quando houver escopo definido |

## Contrato da exportação deste incremento

O botão Exportar abre opções de resolução e fps, inicialmente 4K/60. A seleção vale para a sessão; projetos existentes permanecem compatíveis. Chamadas antigas sem os novos campos continuam em 1080p30. O compositor avalia câmera e cursor para cada timestamp de saída, sem transportar frames por JavaScript. O bitrate cresce com o número de pixels e a taxa de quadros; em 3840×2160/60 o alvo é 96 Mbps.

Fontes menores são ampliadas na exportação; frames da fonte são repetidos quando sua taxa é inferior à taxa escolhida. Isso não recupera detalhes ou movimento ausentes na gravação. A captura agora solicita 60 fps e preserva a resolução física até 4K, mas ainda exige validação de cadência sustentada no hardware real.

Não foi validada exportação em tempo real, aceleração de hardware obrigatória ou estabilidade de 4K60 por dez minutos no M1/8 GB. A conclusão da matriz exige testes de comportamento e comparação visual, além de compilação.

## Validação realizada neste incremento

- `pnpm build` e `pnpm tauri build --debug --bundles app`: concluídos; bundle debug gerado com 81,92 MiB.
- Testes do motor de zoom e três testes Rust: aprovados.
- `python3 tests/native.test.py`: aprovou MP4 horizontal 3840×2160/60, vertical 2160×3840/60, quadrado 2160×2160/60, 720p24 e 1440p30; manteve a compatibilidade 1080p30 sem novos campos.
- Os testes decodificam os frames para conferir contagem e timestamps, comparam o centro da câmera com a trajetória, verificam duração/áudio e rejeitam resolução/fps inválidos. Cancelamento preservou arquivo anterior e mídia original e removeu temporários.
- A reordenação de frames H.264 foi desativada neste caminho para evitar preroll/offsets na validação de cortes. Não foi medido o impacto no tamanho de arquivo em conteúdo real.
- O aplicativo compilado foi aberto, e o diálogo Exportar foi conferido visualmente e por acessibilidade, com 4K e 60 fps selecionados.
- Os vídeos de integração têm 2,2 segundos e usam mídia sintética. Esses testes não substituem benchmark longo ou calibração de qualidade de texto em uma captura real.
