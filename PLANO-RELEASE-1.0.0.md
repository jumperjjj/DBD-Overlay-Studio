# Release 1.0.0 preparado

O usuário solicitou o primeiro release e confirmou a versão 1.0.0.

A migração src/first-release.js salva backup consistente do banco e das imagens antes de limpar o progresso de todos os jogadores em todos os canais. Também encerra eventos ativos. Catálogo, imagens, definições de conquistas e configurações são preservados.

A marca release_1_0_0_progress_reset é salva na mesma transação da limpeza. A próxima abertura preserva o progresso novo. Falha no backup impede a limpeza. A migração é executada na primeira abertura do aplicativo, inclusive por INICIAR.bat; nenhum banco pessoal foi alterado durante a preparação.

O ZIP completo substitui os 14 arquivos existentes no repositório e adiciona os módulos, imagens do aplicativo, testes, lockfile e documentação necessários. O workflow gera o instalador e anexa ao release v1.0.0 publicado. Publicação e teste em live serão feitos pelo usuário.
