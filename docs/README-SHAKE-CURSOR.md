# Cursor com movimento orgânico e zoom guiado

## Objetivo

Deixar a gravação mais viva quando o mouse se desloca, mantendo a leitura da interface. O efeito deve chamar atenção para a ação sem transformar o cursor em uma câmera tremida.

Implementado no editor, nos projetos e na exportação. Novos projetos começam em Cinematic, com acompanhamento Equilibrado e antecipação de 30%. Projetos anteriores abrem com o shake do cursor desligado; selecione um perfil em **Animações** para ativá-lo.

## Referências

O Screen Studio destaca três ideias que devemos preservar: cursor suave, zoom automático e motion blur separado para cursor, zoom e deslocamento da tela. A documentação também trata o blur como parte da aproximação e da saída da câmera, e não como tremor contínuo [Screen Studio — Animations](https://preview.screen.studio/guide/animations).

O FocuSee combina autozoom, acompanhamento do mouse, destaque de cliques e spotlight para guiar a atenção depois da gravação [FocuSee — Auto Zoom and Cursor Animation](https://focusee.imobie.com/features/auto-zoom-and-cursor-animation.htm). O guia do produto também permite personalizar cursor, posição final e animação de encerramento [FocuSee — Cursor Effect](https://focusee.imobie.com/guide/cursor-effect.htm).

## Base utilizada

- O cursor já é reconstruído separadamente, suavizado e acompanhado pela câmera.
- O zoom já reage a cliques, digitação, pausas e movimentos relevantes.
- O Camera Motion já cria impactos em início, parada e mudança de direção.
- O shake de câmera foi preservado. O cursor recebe uma camada independente de resposta direcional ao deslocamento, com velocidade, aceleração, atenuação nas bordas e impacto opcional ao inverter a direção.

## Comportamento implementado

### 1. Shake de deslocamento

Velocidade e aceleração são calculadas em uma janela de 40 ms. Senoides geram o deslocamento direcional, com entrada e saída amortecidas:

```text
speed = distância(cursor atual, cursor anterior) / delta
energy = clamp((speed - 0.08) / 0.35, 0, 1)
offset = noise suave * energy * intensidade
```

Regras:

- Não aplicar shake com o mouse parado.
- Não aplicar shake durante o clique parado.
- Reduzir a intensidade perto das bordas do quadro.
- Zerar o efeito em até 120 ms depois da parada.
- Preservar a posição exata do clique.
- Usar uma onda determinística baseada no tempo, para prévia e exportação produzirem o mesmo resultado.

### 2. Shake com direção

O deslocamento deve acompanhar a direção do movimento:

- movimento horizontal: maior componente horizontal;
- movimento vertical: maior componente vertical;
- mudança brusca de direção: micro impacto único, com duração de 80–140 ms;
- movimento diagonal: combinar os dois eixos sem aumentar o volume total.

O shake deve ser pequeno em relação ao cursor. Como ponto de partida:

| Perfil | Deslocamento máximo | Duração | Uso |
| --- | ---: | ---: | --- |
| Suave | 0,15% do quadro | 90 ms | tutoriais e suporte |
| Cinematic | 0,25% do quadro | 120 ms | demos de produto |
| Dynamic | 0,35% do quadro | 150 ms | vídeos curtos e anúncios |

### 3. Zoom que acompanha a intenção

Durante um zoom automático:

1. detectar a direção do cursor em uma janela de 80–120 ms;
2. antecipar no máximo 25–35% desse deslocamento;
3. manter uma zona interna de segurança de 8–10% do crop;
4. mover a câmera com spring e limitar aceleração;
5. reduzir o zoom durante uma mudança longa de região;
6. reter o enquadramento por alguns frames depois da parada.

O cursor continua sendo a âncora visual. Durante um foco automático acompanhado, a posição final da câmera mantém o ponto dentro da janela de segurança, limitada pelos pixels disponíveis nas bordas da gravação. Zooms manuais preservam o enquadramento escolhido.

### 4. Clique e pausa

- Clique: preservar a posição real e usar círculo ou ripple.
- Pausa depois do deslocamento: adicionar um impacto curto na câmera, se a distância percorrida superar o limiar.
- Digitação: manter o foco atual sem gerar tremor a cada tecla.
- Cursor parado por mais de um segundo: aplicar fade, como já ocorre hoje.

## Controles de produto

Disponíveis no painel **Animações**:

- **Resposta ao movimento:** Desligada, Suave, Cinematic, Dynamic.
- **Intensidade do shake do cursor:** 0–100%.
- **Acompanhar cursor:** desligado, equilibrado, próximo.
- **Antecipação do zoom:** 0–35%.
- **Impacto ao mudar de direção:** ligado/desligado.
- **Preservar cliques:** sempre ligado e não editável.

Os presets devem escolher valores seguros. O usuário pode desligar o shake sem perder o acompanhamento ou os efeitos de clique.

O slider de intensidade multiplica o limite do perfil: 50% de Dynamic permite até 0,175% do quadro. **Próximo** usa uma zona de 8% e responde mais rápido; **Equilibrado** usa 10%. **Desligado** mantém o foco escolhido e suspende também o acompanhamento do crop. A antecipação permite 0% para acompanhar sem prever o caminho. O aviso **Cliques preservados sempre** não possui opção para desativar a precisão.

O controle **Movimento original** de um trecho continua usando a trilha capturada, sem suavização nem shake. Os efeitos de clique e a ocultação por inatividade permanecem no painel **Cursor**. A intensidade zero desativa apenas o shake; os demais controles continuam independentes.

## Implementação no Frame Studio

Arquivos envolvidos:

- `src/zoom.ts`: previsão do cursor, zona de segurança e acompanhamento da câmera.
- `src/cinematic.ts`: impactos de movimento e shake amortecido.
- `src/motion.ts`: amostragem usada por preview e exportação.
- `src/App.tsx`: controles do painel Animações.
- `src-tauri/native/FrameNative.swift`: composição macOS.
- `src-tauri/src/windows_media/render.rs`: composição Windows.
- `src-tauri/src/studio.rs`: validação dos controles, persistência no schema 13 e exportação das trajetórias.
- `tests/zoom.test.ts`: continuidade, limites, antecipação e preservação do clique.
- `tests/native.test.py`: comparação de pixels em exportações curtas.

O cursor é calculado uma vez em `responsiveCursor`, depois do planejamento da câmera. A prévia e os dois exportadores interpolam a mesma trilha. Os motores nativos não recalculam o ruído. A suavização ancora pressionamento e soltura dos botões esquerdo, direito e do meio; o motion blur mantém o ponto atual enquanto um botão está pressionado.

As opções e os tamanhos da região de interesse dos zooms são preservados ao salvar, autosalvar e reabrir. O schema 13 impede que builds anteriores abram a edição e descartem essas configurações. Não há dependências novas.

## Critérios de aceitação

- O shake não empurra o cursor para fora do quadro; o foco automático acompanhado mantém a janela segura, respeitando as bordas da fonte.
- Um clique mantém a posição original com erro menor que 1 pixel no espaço normalizado.
- Um cursor em movimento contínuo recebe uma resposta visual perceptível, mas não ultrapassa 0,35% da dimensão do quadro.
- O shake termina em até 120 ms após a parada.
- O zoom acompanha movimentos rápidos sem esperar o cursor encostar na borda.
- Preview e exportação têm a mesma trajetória para o mesmo timestamp.
- Os presets antigos continuam abrindo sem migração destrutiva.
- O número de amostras de composição por frame é limitado (até cinco); a consulta à trajetória usa busca binária, sem percorrer o histórico de eventos a cada frame.

## Validação visual

Os testes usam quatro trajetórias sintéticas curtas:

1. movimento horizontal lento;
2. movimento diagonal rápido com clique;
3. arraste com mudança de direção;
4. digitação com cursor parado.

Exportar cada caso em 720p/30 fps e comparar preview, MP4 e o frame do clique. Rejeitar o efeito se ele parecer uma vibração contínua, deslocar o clique ou tornar texto pequeno difícil de ler.

```sh
node --experimental-strip-types tests/cursor-response.test.ts
node --experimental-strip-types tests/zoom.test.ts
node --experimental-strip-types tests/cinematic.test.ts
python3 tests/native.test.py
```

Os testes verificam amplitude no quadro final, direção dominante, atenuação nas bordas, fim do shake, preservação dos três botões com blur, troca de modos, formatos 16:9/9:16/1:1, repetição por timestamp e persistência. A validação nativa compara as amostras com a prévia e os pixels dos MP4, incluindo clique e pausa. A calibração visual com gravações reais e a execução no Windows ainda dependem de avaliação no hardware.

Validação executada: build do aplicativo macOS, testes TypeScript e Rust, comparação de 981 amostras entre prévia e motor nativo, os quatro cenários exportados em 720p30 e fluxo real dos controles, autosave e exportação no aplicativo compilado. A checagem de tipos do compositor Windows também passou.

## Limites

O shake deve reforçar a intenção da ação. Ele não deve substituir spotlight, zoom ou destaque de clique. Para movimentos longos, o acompanhamento e a antecipação têm prioridade; o shake entra apenas como acento.

