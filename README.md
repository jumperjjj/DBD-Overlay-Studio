# Fishing Chat Game — v1.0.0

Jogo local para Twitch, com Electron, SQLite, bot autorizado e fontes OBS.

Extraia o ZIP completo e abra INICIAR.bat. Node.js 24 é necessário. Consulte PASSO-A-PASSO.txt.

## Novidades

- Caixinha à esquerda da imagem para habilitar/desabilitar cada peixe ou item, preservando chance, coleção e histórico.

- Aba Eventos com efeitos opcionais: ouro em porcentagem extra, chances por raridade, frenesi e águas amaldiçoadas; duração, prévia de chances e mensagens de início/fim.
- Eventos persistentes por canal, término automático e restauração dos valores normais.
- Raridade Amaldiçoado: faixa de perda, saldo mínimo zero, mensagens e histórico com o desconto real.
- Vara transparente fornecida pelo usuário à direita, com movimento da vara, água fixa e bolhinhas leves; peixes à direita em todos os modelos.
- Escala de imagem de 50–300% e tamanho até 320px, separados da escala do conjunto.
- Aba Comandos compacta, dividida em Pescaria e Consultas. Nomes e mensagens editáveis, com variáveis e detecção de nomes duplicados.
- Consultas !conquistas, !colecao, !rank, !lendarios, !miticos e !evento: somente respostas no chat pela conta do bot autorizada.
- Excluir jogador por canal, com confirmação e proteção contra pescaria pendente.
- 33 ideias de conquistas e 14 condições, incluindo ouro perdido com amaldiçoados.

Ranking, coleção e conquistas têm fontes OBS próprias e exibição manual. Capturas lendárias/míticas substituem o resultado pequeno na mesma fonte de pescaria, com transição, cor e som próprios. O teste mostra a sequência completa e não altera progresso. A fila aguarda o tempo visual e três segundos após o último aviso.

As chances são relativas, sem exigir total de 100%; a porcentagem efetiva aparece na lista. Ordem: Lixo, Comum, Raro, Épico, Lendário, Mítico, Amaldiçoado.

## Desenvolvimento e validação

npm install
npm start
npm run check
npm test

32 testes automatizados, incluindo reset único e preservação do progresso em caso de falha no backup. Interface verificada em navegador com servidor local real a 1260×840. Twitch/OBS reais precisam ser validados pelo streamer.

O workflow Windows usa Node 24 e executa verificações antes do instalador. Não envie node_modules, dist ou bancos pessoais ao GitHub. Os dados ficam no userData do Electron; servidor em 127.0.0.1:8766.

CLIENT-ID-E-BOT.md explica a conta autorizada e o Client ID. DIAGNOSTICO-LAG.txt contém o diagnóstico parcial do mouse.

## Release 1.0.0

Consulte PASSO-A-PASSO-RELEASE-v1.0.0.txt para substituir os arquivos na branch main e publicar a tag v1.0.0. O workflow Build Windows roda automaticamente em cada commit na main e disponibiliza o EXE nos Artifacts. Ao publicar o release, também gera e anexa o instalador ao release.

Na primeira abertura, inclusive por INICIAR.bat, o aplicativo cria um backup e zera uma única vez o progresso de todos os jogadores em todos os canais. Catálogo, imagens, definições de conquistas e configurações são preservados. Eventos ativos de teste são encerrados. As próximas aberturas mantêm o progresso novo. Falha no backup impede a limpeza.

O pacote não inclui bancos pessoais, tokens, node_modules ou dist. O instalador Windows foi gerado localmente com sucesso; Twitch e OBS ainda dependem do teste em live.

## Referência

Inspiração funcional: https://fishingpond.app/ e o print de Eventos fornecido pelo usuário. A página administrativa não pôde ser aberta pela ferramenta; as opções e o comportamento seguem as instruções do usuário.
