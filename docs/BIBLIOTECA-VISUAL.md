# Biblioteca integrada

Os recursos recuperados da instalação local estão incorporados ao Frame Studio em `src-tauri/resources/studio-assets/`, com catálogo sincronizado em `src/studio-assets.json`.

- 182 wallpapers, nove coleções, com miniaturas de 160 px e imagens limitadas a 1920 px. O painel carrega apenas a coleção exibida e usa lazy loading.
- 164 arquivos de cursor, 24 grupos. SVGs são desenhados diretamente em PNG de 1024 px, sem a redução intermediária para 192 px que degradava as bordas durante o zoom. Fontes bitmap preservam sua resolução até esse limite. Hotspots e IDs permanecem no catálogo.
- A biblioteca preparada ocupa aproximadamente 59 MiB em disco. Os arquivos originais recuperados permanecem fora do aplicativo. A primeira conversão de JPEG produziu imagens pretas; a versão entregue usa CGContext e foi conferida visualmente.
- Projetos guardam IDs estáveis, não caminhos absolutos dos recursos. Projetos anteriores continuam válidos. As escolhas participam de undo/redo e autosave.
- Rust valida os IDs contra o catálogo e libera ao WebView somente o diretório da biblioteca empacotada. O exportador recebe a raiz de recursos resolvida pelo backend.
- Wallpaper, preenchimento cover, desfoque estático e hotspot do cursor são tratados tanto na prévia como no compositor Swift.
- Animações: cursor Original/Suave/Médio/Rápido e opção de inércia da câmera por mola amortecida. A integração ocorre fora do loop de reprodução; a trajetória resultante é compartilhada com exportação. São implementações do nosso motor orientadas pela análise local, não módulos Electron executados no Tauri.

## Preparar novamente os recursos

```sh
swiftc -O -parse-as-library scripts/PrepareStudioAssets.swift -o /private/tmp/prepare-studio-assets
/private/tmp/prepare-studio-assets "$HOME/Screen Studio Recovered/assets" "$PWD/src-tauri/resources/studio-assets"
cp src-tauri/resources/studio-assets/catalog.json src/studio-assets.json
pnpm tauri build --debug --bundles app
```

Build desktop concluído; checks do motor de zoom incluem estabilidade e limites da mola. Uma exportação curta com wallpaper, cursor escolhido e desfoque foi concluída. Não repetimos benchmarks longos.

Motion blur, rotação automática e troca contextual do cursor continuam pendentes. Os cursores escolhidos são overlays e dependem da trilha de posição existente; vídeos importados com ponteiro já gravado não permitem substituição limpa.

## Conjuntos e tamanho visível

A seleção do painel passou a aplicar um conjunto (`cursorTheme`) em vez de fixar uma imagem para toda a gravação. Os eventos podem conter `kind` (seta, mão, texto e outros tipos reconhecidos). A prévia e o compositor escolhem a imagem correspondente ao tipo registrado; quando o conjunto não contém aquele tipo, usam o equivalente macOS. Projetos anteriores com `cursorAsset` fixo continuam legíveis.

O catálogo inclui `visibleHeight`, medido pela transparência de cada PNG. Tamanho agora representa a altura visível, independentemente das margens transparentes do recurso. Hotspots permanecem relativos à imagem original. A prévia atualiza tamanho durante o movimento do slider, e a exportação usa a mesma escala.

Na prévia, o overlay fica fora da camada de vídeo transformada pela câmera e recebe posição e dimensões finais do zoom. Isso evita ampliar uma camada do cursor previamente rasterizada em tamanho pequeno no WebView. O caminho de motion blur usa interpolação de alta qualidade no canvas. A exportação carrega os mesmos PNGs em alta resolução.

Depois de preparar novamente os recursos, execute:

```sh
swiftc -O scripts/MeasureCursorAssets.swift -o /private/tmp/measure-studio-cursors
/private/tmp/measure-studio-cursors src-tauri/resources/studio-assets src/studio-assets.json
```

A captura consulta a API pública `NSCursor.currentSystem` a 30 Hz para reconhecer cursores do sistema por imagem, separadamente do polling de posição. Essa API é depreciada no SDK atual e pode retornar nil ou um tipo desconhecido; nesse caso, nenhum tipo é inventado. O experimento local observou seta e mão; fontes com cursores personalizados e outras versões do macOS exigem calibração. Gravações anteriores sem `kind` não permitem recuperar mudanças de contexto automaticamente.

Validação: testes TypeScript de seleção de conjunto, fallback, instante da troca, suavização e escala visível; integração Swift verificou diferenças de pixels para cursor escolhido, transições seta/mão/texto e tamanho. As transições exportadas foram verificadas com eventos sintéticos; uma gravação completa com hover ainda depende de renovar a autorização do macOS para o build atual.
