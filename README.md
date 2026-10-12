# AutoDM

Clone enxuto do ManyChat para uso próprio. Roda 100% no plano grátis da Cloudflare (Workers + D1).

**Instalar com um agente (Codex, Claude Code):** abra esta pasta no agente e peça *"Leia o AGENTS.md e me guie na instalação do AutoDM"*. O passo a passo completo está em [AGENTS.md](AGENTS.md).

| Recurso | Instagram | YouTube Shorts |
|---|---|---|
| Comentário com palavra-chave → resposta pública | ✅ ~1 min (busca) / tempo real após App Review (webhook) | ✅ a cada 5 min (polling) |
| Comentário → DM (private reply) | ✅ | — (YouTube não tem DM) |
| Exigir seguir antes de mandar o link | ✅ | — |
| DM com palavra-chave → resposta | ✅ | — |
| Botões no direct, várias respostas sorteadas, filtro por post, prioridade | ✅ | ✅ (sem botões) |
| Anti-spam: 1 disparo por pessoa por automação a cada 24h | ✅ | ✅ |
| Métricas (disparos → DMs → cliques → links) e log de atividade | ✅ | ✅ |

TikTok ficou de fora: a Business Messaging API exige revisão de segurança (DSPR) para parceiros, e comentário → DM só existe no Vietnã, na Tailândia e na Indonésia. Para DM por palavra-chave no TikTok, use o recurso nativo: Ferramentas de negócios → Mensagens automáticas.

## Como funciona o "exigir seguir"

1. Pessoa comenta `ebook` → recebe resposta pública + DM com botão "Quero o link!".
2. Clica no botão → o app consulta `is_user_follow_business` na API.
3. Não segue → recebe "me segue e toca de novo" com o mesmo botão. Segue → recebe o link.

O clique é necessário: é ele que abre a janela de 24h de conversa e permite consultar se a pessoa segue (mesmo fluxo do ManyChat).

## 1. Deploy na Cloudflare (10 min)

```bash
npm install
npx wrangler login
npx wrangler d1 create autodm            # copie o database_id para wrangler.jsonc
npm run db:migrate
npx wrangler secret put ADMIN_PASSWORD   # senha do painel (usuário: admin)
npx wrangler secret put IG_VERIFY_TOKEN  # qualquer texto aleatório
npm run deploy                           # gera https://autodm.<seu-subdominio>.workers.dev
```

Abra `https://autodm.<...>.workers.dev/admin`. Em **Configuração das plataformas** estão as URLs que você vai colar abaixo.

## 2. Instagram (app da Meta)

Pré-requisito: conta Instagram **Profissional** (Criador ou Comercial). Não precisa de Página do Facebook.

1. developers.facebook.com → **Criar app** → caso de uso **"Gerenciar mensagens e conteúdo no Instagram"** (Instagram API com login do Instagram).
2. Em **Configuração da API com login do Instagram**:
   - Copie **ID do app do Instagram** e **Chave secreta**:
     ```bash
     npx wrangler secret put IG_APP_ID
     npx wrangler secret put IG_APP_SECRET
     ```
   - **Configurar webhooks**: URL de callback = `.../webhooks/instagram`, token de verificação = o `IG_VERIFY_TOKEN`. Assine os campos `comments`, `messages`, `messaging_postbacks`.
   - **Configurar login comercial do Instagram** → URL de redirecionamento = `.../auth/instagram/callback`.
3. Em **Funções do app → Testadores do Instagram**, adicione sua conta e aceite o convite no Instagram (Configurações → Apps e sites).
4. Em **Configurações básicas**: URL da política de privacidade = `.../privacy`. Mesma URL para instruções de exclusão de dados.
5. No painel: **Instagram → Conectar**.
6. No Instagram: Configurações → Mensagens → **Permitir acesso às mensagens** (Ferramentas conectadas) ativado.

### Publicar o app (obrigatório) e App Review (opcional)

Coloque o app em **Publicado (Live)**: com isso o AutoDM busca comentários a cada minuto e responde qualquer pessoa. O App Review só serve para receber comentários em tempo real por webhook:

1. **Análise do app → Permissões**: solicite *Acesso avançado* para `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.
2. Para cada uma: descrição de uso + screencast (1–2 min) mostrando: conectar a conta no painel, criar automação, comentar de outra conta, DM chegando, clique no botão, link recebido.
3. Coloque o app em **Publicado (Live)**.

Texto sugerido para a descrição:
> App de uso próprio do criador @SEU_USUARIO. Quando um seguidor comenta uma palavra-chave em um post, o app envia uma resposta privada (Private Reply) com o material solicitado e responde publicamente ao comentário. Mensagens só são enviadas em resposta a uma interação iniciada pelo usuário.

Prazo típico: alguns dias a algumas semanas. Rejeições comuns: vídeo sem mostrar o fluxo completo ou sem legenda explicando cada passo.

## 3. YouTube (Google Cloud)

1. console.cloud.google.com → novo projeto → **APIs e serviços → Biblioteca** → ative **YouTube Data API v3**.
2. **Tela de consentimento OAuth**: tipo Externo, adicione seu e-mail. Depois **publique o app** (status "Em produção"). Em modo "Teste" o token expira a cada 7 dias. Sem verificação, o Google mostra um aviso "app não verificado" só para você; clique em Avançado → continuar.
3. **Credenciais → Criar ID do cliente OAuth** (Aplicativo da Web). URI de redirecionamento = `.../auth/youtube/callback`.
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
4. No painel: **YouTube → Conectar**.

Cota grátis: 10.000 unidades/dia. Leitura de comentários a cada 5 min ≈ 300/dia; cada resposta custa 50 → ~190 respostas/dia.

## Coisas que aprendemos na prática

- **Webhooks só chegam com o app Publicado (Live).** Em modo desenvolvimento a Meta não manda nada, nem de testador.
- **Webhook de comentário exige Acesso Avançado (App Review).** Por isso o app também **busca comentários a cada minuto** pela API, o que funciona com acesso padrão e responde qualquer pessoa. Os dois caminhos compartilham a deduplicação.
- **Roteamento de conversas:** na Página do Facebook ligada ao Instagram, `facebook.com/settings/?tab=ig_conversation_routing` → App padrão de encaminhamento = **AutoDM-IG**. Sem isso, o envio falha com *"not the thread owner"*.
- **Conversa travada:** se outra ferramenta (ex.: ManyChat) ou uma resposta manual pegou o controle de uma conversa, a DM vai para a **fila** e o app tenta de novo a cada 5 min por até 24h. A trava expira sozinha.
- **Não rode duas ferramentas de DM na mesma conta** (ex.: ManyChat + AutoDM). Elas disputam as conversas.
- **Primeiro toque no botão:** a Meta pode demorar alguns segundos para liberar a checagem de "segue"; o app tenta de novo e, se não confirmar, pede para seguir (nunca libera o link sem confirmar).
- **Toques repetidos** (inclusive o seu, pela sua caixa de entrada) são ignorados depois que o link foi entregue.

## Limites da plataforma (não são do app)

- Instagram permite **1 resposta privada por comentário**, até **7 dias** depois do comentário.
- Mensagens extras só dentro de 24h após a última mensagem/clique da pessoa.
- Botão: até 20 caracteres. Texto da DM com botão: até 640.
- O app ignora comentários da sua própria conta e comentários antigos ao conectar o YouTube.

## Desenvolvimento

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev        # http://localhost:8787/admin
npm test           # testes do matcher
npm run typecheck
```

`IG_GRAPH_BASE` / `YT_API_BASE` em `.dev.vars` apontam as APIs para um mock local.

Estrutura: `src/index.ts` (rotas, cron), `src/instagram.ts`, `src/youtube.ts`, `src/match.ts` (palavras-chave), `src/db.ts`, `src/admin.html` (painel), `migrations/`.
