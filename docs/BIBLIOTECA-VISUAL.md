# Biblioteca integrada

Os recursos recuperados da instalação local estão incorporados ao Frame Studio em `src-tauri/resources/studio-assets/`, com catálogo sincronizado em `src/studio-assets.json`.

- 182 wallpapers, nove coleções, com miniaturas de 160 px e imagens limitadas a 1920 px. O painel carrega apenas a coleção exibida e usa lazy loading.
- 164 arquivos de cursor, 24 grupos. SVGs foram rasterizados para PNG de até 192 px para o compositor nativo não depender de um renderer SVG durante a exportação. Os hotspots indicados nos nomes são percentuais e permanecem no catálogo.
- A biblioteca preparada ocupa aproximadamente 50 MiB em disco. Os arquivos originais recuperados permanecem fora do aplicativo. A primeira conversão de JPEG produziu imagens pretas; a versão entregue usa CGContext e foi conferida visualmente.
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
