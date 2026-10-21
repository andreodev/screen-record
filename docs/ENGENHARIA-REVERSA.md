# Referência local do Screen Studio

Inspeção em 21/10/2026 do Screen Studio 4.1.0-5005 instalado em `/Applications/Screen Studio.app`. A instalação contém JavaScript ofuscado no ASAR e um executável nativo Mach-O universal. Não encontramos o repositório original nem mapas de código do aplicativo. Mapas de bibliotecas de terceiros não recuperam os fontes do produto.

## Recuperação realizada

`node scripts/inspect-screen-studio.mjs` extraiu 209 módulos JS/CSS para `/private/tmp/screen-studio-reference`. O script gera inventário com hashes SHA-256, strings de controles e versões formatadas dos módulos relevantes. Não executa código do app extraído. `node scripts/decode-reference.mjs` resolve estaticamente a rotação das tabelas de strings com validação do checksum: 997 consultas de fundos, 199 de animação, 284 de configurações e 413 do gerenciador de molas (1.893 no total). As versões `.decoded.js` têm os nomes de propriedades recuperados. O avaliador aceita apenas aritmética, índices e parseInt; não usa eval. A formatação normaliza escapes de strings; não restaura nomes locais ofuscados, comentários, tipos ou organização original.

Também extraímos 6.447 símbolos exportados da arquitetura arm64 do auxiliar `screen-studio-native`, com `xcrun nm -arch arm64 -gU`, e nomes Swift demangled via `xcrun swift-demangle`. Arquivos locais: `native-symbols.txt` e `native-symbols-readable.txt`. Isso revela assinaturas, não corpos Swift recuperados. Por exemplo, os eventos nativos têm tempo em ms, posição, tipo e identificação opcional do cursor; há análise de mudanças de hover separada da gravação.

## Mapa funcional confirmado pelos módulos

| Módulo instalado | Evidência estrutural | Aplicação no Frame Studio |
| --- | --- | --- |
| `BncsZwa32.js` | Tipos de fundo, gradiente, cor, wallpaper, aleatório, blur, padding, cantos e sombra | Painel de fundo com gradiente/cor personalizados, aleatório, margem, cantos e sombra |
| `Brm6UpoL2.js` | Configurações distintas `screenMovementSpring` e `mouseMovementSpring`; stiffness/damping; estilos de animação; motion blur | Novo painel Animações e suavização de cursor independente da câmera |
| `DhCS0mTK2.js` | Conversão de configurações de projeto, cursor, fundos, animação e áudio | Novos campos opcionais preservam projetos antigos; aparência acompanha exportação |
| `ChLOT5ZK.js` | Gerenciador de springs e propriedade animada | Referência para evolução do motor; nosso motor atual continua determinístico e pré-calculado |

Essas evidências confirmam a presença de controles e estruturas. Não demonstram por si só os valores ideais, a aparência de cada estado, os algoritmos completos ou paridade visual.

## Entrega deste incremento

- Proporções do editor, painel escuro arredondado, tipografia, espaçamento, transporte, timeline dourada e trilha roxa aproximados da referência enviada.
- Presets Estúdio, Foco e Cinema, além de restaurar o padrão salvo, com undo/redo e autosave existentes.
- Cores personalizadas e cor sólida aplicadas na prévia, pacote de projeto e compositor Swift.
- Controles separados de animação da câmera e do cursor, usados também na trajetória exportada. Em projetos antigos, o cursor mantém o comportamento anterior até ser ajustado.

Não há equivalência com o código-fonte original. Não foram incorporadas bibliotecas, binários ou imagens do produto no nosso bundle. Wallpapers, blur, parâmetros físicos avançados, motion blur e os demais recursos mapeados continuam pendentes. Nenhum benchmark longo foi repetido neste incremento.

## Recuperação ampliada

O material recuperado agora está em `/Users/andreodev/Screen Studio Recovered/`, com README, 208 módulos JavaScript, catálogos TypeScript originais, grafo de imports, hashes e resultados por módulo. A desofuscação foi ampliada a 202 módulos, resolvendo 119.646 consultas fora da inicialização das tabelas; seis módulos não tinham o padrão de tabela. A rotina inicial de rotação foi preservada. O parser TypeScript aceitou todos os arquivos resultantes; execução equivalente não foi comprovada.

Para a parte nativa, o binário arm64 foi extraído por `lipo`, preservando o executável instalado. Foram baixados Ghidra 12.1.4 e Temurin JDK 25 para uma pasta temporária, com SHA-256 conferido. O decompilador C++ do Ghidra foi compilado para Apple Silicon. O script `scripts/RecoverNative.java` exporta pseudocódigo de funções selecionadas de captura, eventos, cursor, scrubbing e encoding. Inventário e falhas ficam em `native/functions.tsv` da pasta recuperada; o assembly completo fica em `native/arm64.asm`.

Ferramenta utilizada: [Ghidra, projeto oficial](https://github.com/NationalSecurityAgency/ghidra). O pseudocódigo C inferido não restaura corpos Swift originais, comentários ou tipos completos; funções com avisos de análise exigem conferência manual. As bibliotecas do sistema não foram importadas na análise, limitando a recuperação de chamadas externas.

Resultado: 195 funções nativas selecionadas tiveram pseudocódigo exportado e uma falhou. A análise global atingiu o limite de 120 s, portanto permanece parcial. Nenhuma equivalência por execução foi validada.

### Recursos encontrados no ASAR

O script `scripts/extract-reference-assets.py` recuperou 182 wallpapers em nove coleções (Energy, Glassmorphism, Iridescent, Midnight, Radiant, Raycast, Spring, Sunset e macOS) e 164 arquivos de cursor: 161 SVGs e três PNGs. Há 24 conjuntos de cursor, incluindo macOS, macOS Tahoe, Halloween, toque e vinte conjuntos customizados. Os recursos estão em `~/Screen Studio Recovered/assets/`; o catálogo navegável está em `~/Screen Studio Recovered/catalogo.html`, com manifesto SHA-256 em `metadata/assets.json`.

Os controles de animação recuperados incluem estilos de tela Focado/Suave, cursor Smooth/Medium/Rapid/None e intensidade de motion blur. As molas têm massa, rigidez e amortecimento. Esses comportamentos são calculados no código; não foi encontrado um conjunto de clips de animação correspondentes nos assets inspecionados. A pasta de wallpapers chamada Spring contém imagens, não simulações de molas. Os recursos foram posteriormente integrados; veja [BIBLIOTECA-VISUAL.md](BIBLIOTECA-VISUAL.md).
