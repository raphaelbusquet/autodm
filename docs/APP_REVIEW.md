# App Review — AutoDM

Pedido: **Acesso Avançado** para as 3 permissões abaixo. Textos em inglês (revisores da Meta), prontos para colar.

Onde: developers.facebook.com → app AutoDM → **Análise do app → Permissões e recursos** → em cada permissão, **Solicitar acesso avançado**. Depois **Análise do app → Solicitações** → preencher e enviar.

---

## Descrição geral do app (campo "App details / How will your app use…")

> AutoDM is a private, single-account automation tool used only by the creator @YOUR_HANDLE (Instagram professional account). When a follower comments a keyword the creator chose (e.g. "free") on one of the creator's posts, AutoDM sends that person one private reply with the requested resource (a link) and optionally replies publicly to the comment. When a follower sends a DM with a keyword, AutoDM replies within the 24-hour messaging window. AutoDM only sends messages in response to an action started by the user (a comment or a DM). It never sends unsolicited or bulk messages, and it is not offered to other businesses.

## instagram_business_basic

> Used to identify the connected Instagram professional account (user_id, username) after login and to list the creator's own posts (media id, caption, thumbnail, permalink) in the AutoDM dashboard, so the creator can choose which posts an automation applies to. It is also used to read whether a user who interacted with the creator follows the account (is_user_follow_business) when the creator enables the "follow before receiving the link" option.

## instagram_business_manage_comments

> Used to receive comment webhooks on the creator's own posts and detect the keyword the creator configured (e.g. a follower comments "free" to get a free guide). When it matches, AutoDM publicly replies to that comment (e.g. "Sent to your DMs!") so other followers know how to get the resource, and sends one private reply to the commenter through the Private Replies API. Without this permission the creator cannot respond to the dozens of comments each post receives asking for the resource.

## instagram_business_manage_messages

> Used to send the private reply to a commenter (one message per comment, within 7 days) and to reply to DMs that contain a keyword, always inside the 24-hour window opened by the user. The first message contains a button; when the user taps it, AutoDM sends the requested link. If the creator enabled the follow option and the user does not follow the account yet, AutoDM asks them to follow and tap again. All messages are a direct response to the user's own comment, DM or button tap.

---

## Roteiro do vídeo (screencast) — 2 a 3 min, um vídeo serve para as 3 permissões

Grave a tela do computador + o celular (espelhado ou gravação separada). **Legende cada passo em inglês** (texto na tela). Sem áudio é aceito.

1. **Login** — abrir `https://autodm.YOUR-SUBDOMAIN.workers.dev/admin`, clicar **Conectar** no Instagram, mostrar a tela de login do Instagram e a tela de permissões sendo aceitas. Legenda: *"Creator connects their own Instagram professional account (instagram_business_basic)."*
2. **Lista de posts** — Nova automação → Escolher posts → mostrar as miniaturas carregando. Legenda: *"AutoDM lists the creator's own posts (instagram_business_basic)."*
3. **Criar automação** — palavra-chave `free`, resposta pública, DM com botão, link, "exigir seguir" ligado. Salvar.
4. **Comentário** — com a conta de teste , comentar `free` no post. Mostrar a resposta pública aparecendo. Legenda: *"Comment webhook received; public reply posted (instagram_business_manage_comments)."*
5. **Private reply** — mostrar a DM chegando na conta de teste. Legenda: *"One private reply sent to the commenter (instagram_business_manage_messages)."*
6. **Botão + follow** — tocar no botão sem seguir → mensagem pedindo para seguir; seguir; tocar de novo → link chega. Legenda: *"Follow status checked with is_user_follow_business; link delivered."*
7. **Painel** — aba Atividade mostrando os eventos. Fim.

**Antes de gravar:**
- Pausar o ManyChat (no ManyChat: desligar as automações do Instagram) por ~15 min.
- Usar uma conta de teste que **não** tenha conversa recente com o ManyChat (ver "conversa travada" no README).
- Se a resposta não sair na hora, a fila reenvia em até 5 min — corte o vídeo.

## Instruções para o revisor (campo "Testing instructions")

> AutoDM is a single-account tool, so reviewers cannot connect their own account. The screencast shows the complete flow. Dashboard: https://autodm.YOUR-SUBDOMAIN.workers.dev/admin (user: admin, password: provided in this field). Privacy policy: https://autodm.YOUR-SUBDOMAIN.workers.dev/privacy

Colocar a senha do painel no campo. **Trocar a senha depois da aprovação** (`npx wrangler secret put ADMIN_PASSWORD`).

## Possíveis pedidos da Meta

- **Verificação do negócio** (Configurações do app → Básico → Verificação): pode ser exigida para Acesso Avançado. Pessoa física/MEI costuma passar com CNPJ ou documentos do negócio.
- **Rejeição comum**: vídeo sem mostrar o login, sem legendas, ou sem mostrar a mensagem chegando no celular. Siga o roteiro à risca.
