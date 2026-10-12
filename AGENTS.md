# AutoDM: guia de instalação para agentes (Codex, Claude Code etc.)

Você é o agente que vai instalar o AutoDM no computador da pessoa e guiá-la pelos passos que só ela pode fazer no navegador. Fale com ela em **português do Brasil**, com frases curtas e um passo de cada vez. Ela não é programadora.

O AutoDM é um clone enxuto do ManyChat para **uma conta do Instagram** (e, opcionalmente, um canal do YouTube). Funciona assim: alguém comenta uma palavra-chave num post, recebe uma resposta pública e uma DM com botão, e o link chega depois de confirmar que segue a conta. Roda de graça na Cloudflare (Workers + D1), 24/7, sem depender do computador ligado.

## Regras para você, agente

- **Segredos:** nunca escreva no chat, em arquivo ou em commit as chaves da Meta/Google nem a senha do painel. Quando precisar de um segredo, peça para ela rodar o comando `npx wrangler secret put NOME` no terminal e colar o valor ali. Se o seu ambiente não permitir isso, peça o valor e passe por stdin (`printf '%s' "$VALOR" | npx wrangler secret put NOME`) sem repetir o valor na resposta.
- **Passos no navegador são dela.** Login, criação de app na Meta, aceitar termos e publicar o app: explique o que clicar e espere ela confirmar. Peça prints quando ela travar.
- **Não faça push** das mudanças locais (`wrangler.jsonc` com o ID do banco e o e-mail dela) para o repositório original.
- Depois de cada etapa, confira se deu certo (comando de verificação ou print) antes de seguir.
- Se algo falhar, leia a mensagem de erro e consulte **Problemas conhecidos** no fim deste arquivo antes de improvisar.

## O que ela precisa ter

- Conta do Instagram **Profissional** (Criador ou Comercial). Se for pessoal, ela troca em Instagram → Configurações → Tipo de conta e ferramentas.
- Conta no Facebook (para o painel de desenvolvedor da Meta).
- E-mail para criar uma conta grátis na Cloudflare.
- **Nenhuma outra ferramenta de DM automática ligada no Instagram** (ManyChat, MLabs Inbox, Kommo etc.). Duas ferramentas disputam as conversas e as DMs falham. Se ela usa alguma, ela desconecta o Instagram dessa ferramenta antes do teste final.

## Etapa 0: preparar o computador

1. Confira se existem `node -v` (versão 20 ou maior) e `git --version`. Se faltar o Node, oriente a instalar a versão LTS em https://nodejs.org (no Mac, também serve `brew install node`).
2. Na pasta do projeto:
   ```bash
   npm install
   npm test          # deve passar
   npm run typecheck # sem erros
   ```

## Etapa 1: Cloudflare (uns 10 min)

1. Se ela não tiver conta, peça para criar uma grátis em https://dash.cloudflare.com/sign-up.
2. `npx wrangler login`: abre o navegador; ela clica em **Allow**. Confira com `npx wrangler whoami`.
3. **Subdomínio workers.dev:** peça para ela abrir dash.cloudflare.com → **Workers e Pages**. Se pedir para escolher um subdomínio, sugira o @ dela sem pontos (ex.: `mentoriarenova`). Anote: a URL final será `https://autodm.<subdominio>.workers.dev`.
4. Banco de dados:
   ```bash
   npx wrangler d1 create autodm
   ```
   Copie o `database_id` da saída para `wrangler.jsonc` (campo `database_id`).
5. Em `wrangler.jsonc`, troque `CONTACT_EMAIL` pelo e-mail dela. Ele aparece na política de privacidade, que a Meta exige.
6. `npm run db:migrate` (responda `y`). Todas as migrações devem ficar ✅.
7. Segredos iniciais:
   - `ADMIN_PASSWORD`: senha do painel, escolhida por ela (usuário do painel: `admin`). Ela roda `npx wrangler secret put ADMIN_PASSWORD` e digita.
   - `IG_VERIFY_TOKEN`: gere um texto aleatório e guarde para a Etapa 2: `openssl rand -hex 16 | tee /tmp/autodm-verify.txt | npx wrangler secret put IG_VERIFY_TOKEN`.
8. `npm run deploy`. Abra `https://autodm.<subdominio>.workers.dev/admin` e confira com ela que o painel pede a senha e abre. No painel, em **Configuração das plataformas**, aparecem as URLs usadas a seguir.

## Etapa 2: app da Meta para o Instagram (uns 30 min, é a parte mais longa)

Guie um item por vez. Nos passos abaixo, `<URL>` significa `https://autodm.<subdominio>.workers.dev`.

1. https://developers.facebook.com → **Meus apps → Criar app**.
   - Nome: `AutoDM` (ou outro nome).
   - Caso de uso: **"Gerenciar mensagens e conteúdo no Instagram"**.
   - Portfólio empresarial: pode deixar sem.
2. No app, abra **Casos de uso → Personalizar → Configuração da API com login do Instagram**:
   - **Permissões:** confira que estão adicionadas `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_business_manage_comments`.
   - **Passo 1, "Gerar tokens de acesso":** ela NÃO precisa gerar token aqui. Só precisa copiar o **ID do app do Instagram** e a **Chave secreta do app do Instagram** (botão "Mostrar"). Ela roda:
     ```bash
     npx wrangler secret put IG_APP_ID
     npx wrangler secret put IG_APP_SECRET
     ```
   - **Passo 2, "Configurar webhooks":**
     - URL de callback: `<URL>/webhooks/instagram`
     - Token de verificação: o conteúdo de `/tmp/autodm-verify.txt` (mostre o valor para ela; não é um segredo crítico).
     - Clique em **Verificar e salvar**. Depois assine os campos `comments`, `messages` e `messaging_postbacks`.
   - **Passo 3, "Configurar login comercial do Instagram":** em URL de redirecionamento OAuth, coloque `<URL>/auth/instagram/callback`.
3. **Configurações do app → Básico:**
   - Copie a **Chave secreta do app** (é outra chave, a do app da Meta). Ela roda `npx wrangler secret put META_APP_SECRET`. Isso serve para validar os webhooks.
   - URL da Política de Privacidade: `<URL>/privacy`.
   - URL de instruções de exclusão de dados: `<URL>/privacy`.
   - Ícone do app (1024×1024): pode usar `assets/icon.png` deste repositório.
   - Categoria: "Negócios e páginas" (ou similar). Salvar.
4. **Funções do app → Funções → Testadores do Instagram:** adicione o @ dela. Ela aceita o convite pelo **navegador**, não pelo app: instagram.com → Configurações → Apps e sites → Convites de testador → Aceitar. Pelo celular/Safari às vezes não aparece; use o computador.
5. `npm run deploy` (para carregar os segredos novos). No painel, clique em **Instagram → Conectar**, faça login com a conta dela e aceite tudo. O chip deve ficar **conectado com o @ dela**.
6. No Instagram dela: Configurações → Mensagens e respostas a stories → Ferramentas conectadas → **Permitir acesso às mensagens**: ligado.
7. **Publicar o app (obrigatório).** No topo do painel da Meta, troque **Modo de desenvolvimento** para **Publicado/Live**. Sem isso, a Meta não manda nada e ninguém além dela recebe DM. Se reclamar de algum campo, é algo do item 3.
8. **Roteamento de conversas** (só se o Instagram dela estiver ligado a uma Página do Facebook): ela abre `https://www.facebook.com/settings/?tab=ig_conversation_routing` com a Página selecionada e coloca o app dela como **app padrão de encaminhamento**. Sem isso, as DMs falham com *"not the thread owner"*.

Não é preciso fazer o **App Review**. Com o app publicado, o AutoDM busca os comentários novos a cada minuto pela API e responde qualquer pessoa. O App Review (veja `docs/APP_REVIEW.md`) só deixa a resposta instantânea via webhook, e é opcional.

## Etapa 3: primeira automação e teste

1. No painel: **Nova automação**:
   - Plataforma Instagram, gatilho "Comentário".
   - Escolher posts → selecione um Reel.
   - Palavra-chave, por exemplo `quero`.
   - Uma ou mais respostas públicas, uma por linha.
   - Mensagem no direct com `{nome}`.
   - Ligue **Exigir que a pessoa me siga**.
   - Link e mensagem final. **Esperar antes do link**: 20 min. Isso evita quem segue, pega o link e deixa de seguir; na hora de enviar, o app confere de novo.
   - Salvar.
2. Teste com **outra conta** que não segue ela: comentar a palavra-chave no Reel.
   - Em até ~2 min chegam a resposta pública e a DM com botão.
   - Tocar sem seguir → pede para seguir.
   - Seguir e tocar de novo → "já já te mando o link".
   - Depois do tempo de espera, chega o link.
3. A aba **Atividade** do painel mostra cada passo. Se algo ficar "na fila", veja os Problemas conhecidos.

## Etapa 4 (opcional): YouTube Shorts

No YouTube não há DM. O app responde publicamente ao comentário, e o link pode ir na resposta. O limite grátis dá umas 190 respostas por dia.

1. https://console.cloud.google.com → **Novo projeto** "AutoDM".
2. **APIs e serviços → Biblioteca** → ativar **YouTube Data API v3**.
3. **Google Auth Platform**:
   - **Branding:** nome AutoDM, e-mail de suporte, página inicial e política de privacidade = `<URL>/privacy`, domínio autorizado = `<subdominio>.workers.dev`, e-mail do desenvolvedor. Não envie logo (exige verificação).
   - **Público-alvo:** Externo → **Publicar app** (status "Em produção"). Em "Teste", o login expira a cada 7 dias.
   - **Clientes → Criar cliente → Aplicativo da Web**, com URI de redirecionamento `<URL>/auth/youtube/callback`.
4. Ela roda `npx wrangler secret put GOOGLE_CLIENT_ID` e `npx wrangler secret put GOOGLE_CLIENT_SECRET`, e depois `npm run deploy`.
5. No painel, clique em **YouTube → Conectar**. No aviso "app não verificado", clique em **Avançado → Acessar**.
6. Crie a automação: plataforma YouTube, escolha o Short, palavra-chave e resposta pública com o link.

## Problemas conhecidos (já resolvidos no código ou na configuração)

| Sintoma | Causa e solução |
|---|---|
| Nada acontece ao comentar | App não está **Publicado/Live** (Etapa 2.7), automação pausada, palavra-chave diferente ou outro post selecionado. O comentário pode levar até ~1 min para ser lido. |
| DM "na fila" / erro `not the thread owner` (2534037) | Outra ferramenta ou o inbox controla a conversa. Faça o roteamento (2.8) e desligue outras ferramentas de DM. A fila tenta de novo a cada 5 min por 24h. |
| `User consent is required` | Normal antes da pessoa tocar no botão: a Meta só libera a checagem de "segue" depois de uma interação. O app tenta de novo e nunca libera o link sem confirmar. |
| Rate limit / `(#4)` / `(#613)` | Limite da Meta (~750 respostas privadas por hora). Tudo vai para a fila e sai sozinho. |
| Tester não consegue aceitar convite | Aceitar pelo navegador do computador em instagram.com → Configurações → Apps e sites. |
| Google "Acesso bloqueado: app não concluiu verificação" | O app do Google está em "Teste". Preencha Branding e clique em **Publicar app**. |
| Webhook não verifica na Meta | O deploy não estava feito ou o `IG_VERIFY_TOKEN` é diferente do digitado. Refaça o `wrangler secret put` e o `npm run deploy`. |

## Comandos úteis

```bash
npm run deploy                                   # publicar mudanças
npx wrangler tail                                # ver logs ao vivo
npx wrangler secret list                         # ver quais segredos existem (sem valores)
npx wrangler d1 execute autodm --remote --command "SELECT type, username, detail, datetime(created_at,'unixepoch') FROM events ORDER BY id DESC LIMIT 20"
```
