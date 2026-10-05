# Client ID e a conta que envia as mensagens

O Client ID identifica a aplicação registrada na Twitch. Ele não escolhe a conta que fala no chat. O dono do cadastro da aplicação pode ser JumperJJJ, enquanto a conta que autoriza o aplicativo é FishingBotJJJ. O remetente das mensagens é a conta autorizada.

Um mesmo Client ID pode identificar cópias do aplicativo usadas por várias pessoas. O Client ID é público; não é a senha da Twitch. Nesta versão o campo continua editável, pois não recebemos um ID padrão para embutir. Podemos preencher e bloquear esse campo numa versão de distribuição quando o ID do produto estiver definido.

O programa usa Device Code Flow com um token de usuário, sem embutir Client Secret no instalador. Para um aplicativo distribuído para Windows, a Twitch recomenda o tipo Public para esse fluxo.

## Sua amiga testando agora

Ela pode usar o mesmo Client ID, informar o próprio canal e autorizar uma conta da Twitch que ela controla. Precisa alterar o campo “Conta do bot esperada” para o login dessa conta. Nesse caso, as mensagens aparecem como essa conta, e não como FishingBotJJJ.

Para usar FishingBotJJJ em uma instalação de teste dela: ela coloca o canal dela, mantém a conta esperada como fishingbotjjj e clica para conectar. Ela te passa o código que o programa dela gerou. Você abre a página oficial da Twitch indicada pelo aplicativo, entra em FishingBotJJJ e autoriza aquele código antes de expirar. O programa dela deve permanecer aberto esperando a autorização. Não é um código gerado no seu PC que você envia para ela.

Ao conectar, “Canal da live” determina o chat que será acompanhado e receberá respostas. O programa atual permite informar outro canal: se a Twitch aceitar a conexão e o envio, o bot responderá naquele canal. Apenas digitar o nome não muda uma conexão já aberta. Para testes pessoais, use seu próprio canal.

## Sua FishingBotJJJ aparecendo em todos os canais

O Client ID sozinho não dá à instalação da sua amiga permissão para falar como FishingBotJJJ. No modelo atual, a conta FishingBotJJJ precisaria ser autorizada para aquela instalação. Essa instalação receberia um token com acesso ao bot.

Para distribuir o produto mantendo sua FishingBotJJJ central, a arquitetura indicada é um serviço remoto: você autoriza o bot no serviço, cada streamer autoriza o próprio canal e o programa conversa com o serviço. O token do bot fica no servidor. Banco, ranking, catálogo e overlay podem continuar locais. Esse serviço não está incluído na versão 0.5.0.

Não é necessário passar a senha do bot para sua amiga. O fluxo com bot central terá uma autorização do canal dela, separada da autorização do seu bot.

## Documentação oficial

- Registro da aplicação e Client ID: https://dev.twitch.tv/docs/authentication/register-app/
- Device Code Flow e tipo Public: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
- Autenticação de chatbots locais e em nuvem: https://dev.twitch.tv/docs/chat/authenticating/
- Remetente das mensagens (sender_id): https://dev.twitch.tv/docs/chat/send-receive-messages/
