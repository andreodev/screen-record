# Zoom e desempenho — 21/10/2026

## Mudanças entregues

- Sobreposições mantêm continuidade de posição/escala. Cliques próximos são agrupados; cliques distantes abrem o enquadramento na passagem entre focos.
- Entrada antecipada, permanência após o clique, curvas suaves e seguimento com zona de tolerância. Rajadas de cliques não geram segmentos quase vazios.
- Cursor interpolado linearmente entre amostras já suavizadas, eliminando pequenas paradas entre amostras. Prévia e exportação compartilham a trajetória.
- Prévia anima a câmera mesmo quando a gravação mantém um frame estático. Pausar interrompe o loop; o cursor usa transformação CSS e React recebe o relógio a 4 Hz.

## Método e limites

MacBook Air M1, 8 GB, macOS 26, bundle Tauri debug com frontend Vite de produção e auxiliar Swift compilado com `-O`. Fonte sintética H.264 SDR, 1280 × 800, 30 fps, 600 segundos, 72.000 amostras de cursor e 200 zooms. Exportação 1728 × 1080, 30 fps. Janela visível durante a reprodução; 20 segundos pausada antes e depois. O encerramento com código -15 é intencional pelo runner após a última fase.

CPU é percentual de **um núcleo**, obtido de tempo de processo convertido de mach ticks. Memória é physical footprint, incluindo memória comprimida, somada entre app, novos serviços WebKit/VideoToolbox e auxiliar nativo. Pico inclui aquecimento. Amostragem aproximadamente a cada segundo.

A descoberta de serviços novos do macOS é conservadora: serviços compartilhados iniciados por outros aplicativos podem entrar na soma. O teste de prévia incluiu um encoder que a prévia não utiliza; portanto CPU/RAM são **limites superiores da sessão observada**, não atribuição exata ao Frame Studio. Os dados não comprovam a meta de 450 MB, ausência de vazamento ou comportamento de captura longa. Não foi executado um benchmark equivalente do Screen Studio.

## Reprodução longa

- 598,6 segundos medidos após aquecimento: **59,996 callbacks/s**.
- Intervalo mediano 17 ms; p95 18 ms; um intervalo acima de 50 ms entre 35.914 callbacks.
- CPU agregada média 35,9% de um núcleo; pico de footprint 468,5 MiB (com a ressalva de atribuição acima).
- A memória oscilou e caiu durante a reprodução. Após pausar, caiu de 354 para 252 MiB em 20 segundos. Uma execução não permite concluir ausência de vazamento.
- Pausado antes de reproduzir: nenhum callback do loop de animação, CPU média agregada 2,6%.

Estes são números de cadência da animação, não prova de que cada quadro foi apresentado pela GPU. O contador `getVideoPlaybackQuality` do WebKit atualizou quadros decodificados de forma tardia após pausar; seus zeros de descarte não foram usados como comprovação de ausência de perdas. O p95 de 18 ms também não cumpre literalmente a meta inicial de 16,7 ms.

## Exportação

O auxiliar nativo, incluindo serviços de codec novos, concluiu os 600 segundos em 137,6 segundos, média de 77,7% de um núcleo e pico de 272,3 MiB. A duração e a resolução do arquivo final foram verificadas. Esta medição não inclui o editor; o teste do fluxo completo foi interrompido a pedido do usuário e não foi repetido. Durante o trecho observado, o pico agregado chegou a 662,8 MiB; não representa uma exportação concluída. Portanto a meta de memória ainda exige trabalho. Os dados parciais estão no arquivo de resultados.

## Verificação e reprodução

Build TypeScript/Vite e bundle Tauri passaram. Testes de zoom cobrem limites, continuidade, follow, overlaps, rajadas, passagem entre cliques distantes e interpolação do cursor. Dois testes Rust passaram. Integração nativa verificou exportações horizontal/vertical/quadrada, áudio, cancelamento e geometria de pontos no compositor.

```sh
source "$HOME/.cargo/env"
pnpm tauri build --debug --bundles app
mkdir -p /private/tmp/frame-studio-perf
swiftc -O -parse-as-library tests/MakeFixture.swift -o /private/tmp/frame-fixture
/private/tmp/frame-fixture /private/tmp/frame-studio-perf/short.mov
swiftc -O -parse-as-library tests/MakeLongFixture.swift -o /private/tmp/frame-long
/private/tmp/frame-long /private/tmp/frame-studio-perf/short.mov /private/tmp/frame-studio-perf/long.mov 600
node --experimental-strip-types tests/prepare-benchmark.ts /private/tmp/frame-studio-perf
python3 tests/performance.py preview /private/tmp/frame-studio-perf
python3 tests/performance.py export-desktop /private/tmp/frame-studio-perf
```

Use uma pasta nova se os MOV já existirem. Os testes abrem uma janela temporária sempre à frente, com botão para interromper, e exportam apenas para essa pasta. Instrumentação depende de `FRAME_STUDIO_BENCHMARK` e fica desativada sem essa variável e em release. Dados permanecem locais. Resultados desta execução: [performance-results.json](performance-results.json).

Ainda faltam gravação real longa, cinco ciclos de abrir/buscar/fechar, fontes 1080p/4K variadas, HDR e comparação visual mais ampla em monitores diferentes.
