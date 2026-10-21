# AutoDM

Automação de respostas a comentários e mensagens para **uma conta profissional do Instagram**, com integração opcional a **um canal do YouTube**. Crie regras por palavra-chave, entregue materiais solicitados e acompanhe a atividade pelo painel web.

Feito com **TypeScript, Hono, Cloudflare Workers e D1**. Você pode instalar o ambiente de desenvolvimento na sua máquina. Para automações contínuas e webhooks, publique na **sua própria conta Cloudflare**; depois disso, seu computador pode ficar desligado.

Cada instalação usa contas, banco e credenciais próprios. O repositório não inclui acesso à instalação do autor, seguidores, senhas ou tokens.

## Índice

- [Recursos e limites](#recursos-e-limites)
- [Instalação local](#instalação-local)
- [Publicação na Cloudflare](#publicação-na-cloudflare)
- [Instagram](#conectar-o-instagram)
- [YouTube](#conectar-o-youtube-opcional)
- [Primeira automação](#criar-uma-automação)
- [Boas-vindas e ebook](#boas-vindas-e-ebook)
- [Configurações e comandos](#configurações-e-comandos)
- [Arquitetura e rotas](#arquitetura-e-rotas)
- [Segurança e manutenção](#segurança-dados-e-manutenção)
- [Problemas comuns](#problemas-comuns)

## Recursos e limites

| Recurso | Instagram | YouTube |
| --- | --- | --- |
| Palavra-chave em comentário → resposta pública | Sim | Sim |
| Comentário → resposta privada | Sim, conforme acesso da Meta | Não há DM |
| Palavra-chave em DM → resposta | Sim, por webhook | Não |
| Confirmar follow antes de entregar um link | Sim, se a API disponibilizar a informação | Não |
| Filtro por post, prioridades e variações de resposta | Sim | Sim |
| Link com espera configurável após confirmar follow | Sim | Não |
| Atividade, contatos e métricas de eventos | Sim | Sim |
| Painel adaptado ao celular e ícone na tela inicial | Mesmo painel | Mesmo painel |

- O matcher ignora maiúsculas e acentos e procura palavras completas: `link` não dispara em `linkedin`. Também aceita frases e modo de correspondência exata.
- Prioridade maior vence; depois, regras específicas por post; depois, o menor ID.
- Há deduplicação de eventos e proteção de repetição por pessoa/regra em 24 horas, baseada nos envios e itens de fila registrados.
- O cron de produção roda a cada minuto: comentários do Instagram e fila nesse ciclo; YouTube, limpeza e verificação de renovação do token do Instagram a cada cinco minutos.
- No Instagram, regras globais consultam os **cinco posts mais recentes**. Posts explicitamente selecionados também são consultados. Há limites de páginas e comentários por ciclo.
- O polling parte dos comentários novos ao começar a observar um post/canal, evitando responder em massa ao histórico.
- TikTok, Telegram, geração de vídeos, checkout e entrega de ebook por email não fazem parte deste repositório.

**Polling não contorna permissões nem substitui App Review quando exigido.** Disponibilidade de mensagens, dados de follow e janelas de resposta depende da plataforma e do acesso concedido ao seu app.

O uso pode caber nos planos gratuitos da Cloudflare conforme o volume. Requisições, consultas D1, armazenamento, CPU e cotas das APIs têm limites. Não há garantia de custo zero ou de latência fixa para qualquer instalação.

## Instalação local

### Pré-requisitos

- [Git](https://git-scm.com/downloads).
- [Node.js](https://nodejs.org/) **22.12 ou superior**, em versão LTS compatível. `.nvmrc` seleciona Node 22 para quem usa nvm.
- npm, incluído no Node.js.
- macOS, Linux ou Windows com essas ferramentas instaladas.

### Clonar e iniciar o painel

```bash
git clone https://github.com/raphaelbusquet/autodm.git
cd autodm
npm ci
cp .dev.vars.example .dev.vars
```

No PowerShell, use `Copy-Item .dev.vars.example .dev.vars` no lugar de `cp`.

Abra `.dev.vars` no editor e preencha **ADMIN_PASSWORD** com uma senha sua. Os demais campos podem ficar vazios para explorar o painel sem conectar plataformas. O exemplo não contém uma senha padrão.

```bash
npm run db:migrate:local
npm run dev
```

Abra **http://localhost:8787/admin** e entre com a senha definida. O formulário pede apenas a senha; para HTTP Basic em scripts, o usuário é `admin`.

Esse caminho usa `wrangler.local.jsonc` e um D1 emulado em `.wrangler/`. Não requer criar banco remoto ou acessar recursos do autor. Para parar, pressione `Ctrl+C`; para voltar, execute `npm run dev`. Os dados locais permanecem em `.wrangler/`.

As APIs sociais não ficam conectadas apenas por abrir o painel. Webhooks reais precisam de URL pública acessível pela plataforma. Para desenvolver callbacks/webhooks na máquina, providencie um endereço HTTPS público e registre-o nas plataformas. Para uso contínuo, siga o deploy abaixo.

## Publicação na Cloudflare

### 1. Preparar sua configuração

Crie uma conta em [Cloudflare](https://dash.cloudflare.com/). Configure seu subdomínio `workers.dev` em Workers e Pages, se ainda não existir.

```bash
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler login
npx wrangler whoami
npx wrangler d1 create autodm
```

No PowerShell: `Copy-Item wrangler.example.jsonc wrangler.jsonc`.

Edite **wrangler.jsonc**, não o exemplo:

- `d1_databases[0].database_id`: ID do **seu** banco, devolvido pelo comando anterior. O UUID zerado é apenas um marcador.
- `vars.CONTACT_EMAIL`: seu email de contato, que aparecerá publicamente em `/privacy`.
- `name`: nome do Worker, por padrão `autodm`.
- `services[0].service`: mantenha igual ao `name`; `SELF` aponta para o próprio Worker para distribuir tarefas.

Se mudar o nome do banco, ajuste `database_name` e os comandos/scripts que usam `autodm`. A configuração padrão não depende de um serviço de ebook.

`wrangler.jsonc` é ignorado pelo Git. Seu ID de banco e contato de instalação não precisam ser publicados.

### 2. Aplicar migrações

```bash
npm run db:migrate
```

Confira conta e banco antes de confirmar. Esse comando aplica as cinco migrações disponíveis no remoto. `npm run db:migrate:local` usa apenas a configuração/banco locais.

### 3. Cadastrar os segredos iniciais

```bash
npx wrangler secret put ADMIN_PASSWORD --config wrangler.jsonc
npx wrangler secret put IG_VERIFY_TOKEN --config wrangler.jsonc
```

Digite os valores nos prompts. Escolha uma senha forte e um token aleatório; guarde o token em um gerenciador de senhas para informar à Meta depois. O Wrangler pode pedir a criação inicial do Worker: confira o destino antes de confirmar.

**`.dev.vars` serve para desenvolvimento local.** Ele não configura os segredos de produção; esses ficam nos secrets da sua conta Cloudflare.

### 4. Publicar

```bash
npm run deploy
```

Abra a URL informada pelo Wrangler, normalmente `https://autodm.SEUSUBDOMINIO.workers.dev/admin`. Entre com sua senha. Em **Configuração das plataformas**, o painel mostra as URLs dos callbacks e da política de privacidade.

Se o primeiro deploy reclamar que o serviço de `SELF` ainda não existe, retire temporariamente a entrada `SELF` de `services`, publique uma vez, restaure a entrada e publique novamente. O código tem fallback em linha quando `SELF` não existe; o binding distribui o trabalho no uso normal.

## Conectar o Instagram

Requer uma conta **profissional** e um app próprio da Meta. O fluxo implementado é **Instagram API com Instagram Login**, não Facebook Login.

1. Em [Meta for Developers](https://developers.facebook.com/), crie um app e configure o produto/caso de uso de mensagens e conteúdo do Instagram. Os nomes das telas podem mudar.
2. Na configuração de Instagram Login, obtenha o ID e o segredo **do app do Instagram** e cadastre:

   ```bash
   npx wrangler secret put IG_APP_ID --config wrangler.jsonc
   npx wrangler secret put IG_APP_SECRET --config wrangler.jsonc
   ```

3. Confira o acesso às permissões solicitadas pelo código:
   - `instagram_business_basic`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`
4. Callback OAuth: `https://SEU-WORKER/auth/instagram/callback`.
5. Webhook: `https://SEU-WORKER/webhooks/instagram`, com o mesmo `IG_VERIFY_TOKEN`. Assine `comments`, `messages` e `messaging_postbacks`, conforme o acesso disponível.
6. Se o app principal da Meta tiver um segredo diferente do segredo do Instagram, cadastre também:

   ```bash
   npx wrangler secret put META_APP_SECRET --config wrangler.jsonc
   ```

   O código aceita assinaturas de webhook com ambos os segredos.
7. Informe contato, política de privacidade e instruções de exclusão (`https://SEU-WORKER/privacy`) e demais campos exigidos. Revise a política para sua operação. O ícone está em `assets/icon.png`.
8. Para testar em desenvolvimento, configure funções/testadores do app e aceite o convite na conta correspondente. Habilite acesso às mensagens nas ferramentas conectadas do Instagram, quando solicitado.
9. No AutoDM, clique em **Instagram → Conectar** e conclua o OAuth. O painel deverá mostrar a conta conectada.
10. Para uso fora do escopo de teste, cumpra os requisitos de publicação, revisão, acesso avançado e eventual verificação empresarial apresentados pela Meta. **Apenas mudar para Live não garante acesso a todas as pessoas e recursos.** Veja [docs/APP_REVIEW.md](docs/APP_REVIEW.md).

Não cole um access token no código: o OAuth grava os tokens no banco da sua instalação. O código tenta renovar o token longo periodicamente; revogação ou falha de acesso pode exigir reconectar.

O fluxo de follow consulta `is_user_follow_business` após a interação apropriada. Se a API não confirmar o follow, uma regra que exige seguir não libera o link.

## Conectar o YouTube (opcional)

O projeto responde **publicamente** a comentários. Não existe DM nesse fluxo. A listagem usa uploads do canal e monta links de Shorts, mas não filtra exclusivamente vídeos classificados como Shorts.

1. Crie seu projeto no [Google Cloud Console](https://console.cloud.google.com/) e ative **YouTube Data API v3**.
2. Configure o consentimento OAuth. Se estiver em teste, cadastre sua conta como usuário de teste. O escopo solicitado é `https://www.googleapis.com/auth/youtube.force-ssl`.
3. Crie um cliente OAuth do tipo **Aplicativo da Web** com callback `https://SEU-WORKER/auth/youtube/callback`.
4. Cadastre:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.jsonc
   npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.jsonc
   ```

5. No AutoDM, clique em **YouTube → Conectar** e autorize sua conta.

O Google pode exigir revisão, domínios autorizados e publicação conforme o uso. Apps externos em teste podem ter refresh tokens de curta duração. Publicar o consentimento não substitui uma revisão exigida; confira o motivo de eventuais bloqueios no console.

O consumo diário depende de leituras, páginas e respostas. Consulte a cota no Google Cloud; o AutoDM não garante um número fixo de respostas por dia.

## Criar uma automação

No painel, escolha **Nova automação**:

1. Defina nome, plataforma e gatilho: comentário ou, no Instagram, DM.
2. Selecione posts específicos ou regra global.
3. Configure palavras-chave e modo `contém` ou `exato`. Sem palavras-chave, a regra pode corresponder a qualquer texto.
4. Defina respostas públicas, uma por linha; no YouTube, pelo menos uma é necessária.
5. Para Instagram, configure a mensagem direta, os botões e o link final.
6. Se necessário, habilite **Exigir que a pessoa me siga**, mensagens de orientação e espera antes do link (0–600 minutos nesse fluxo).
7. Ative e salve.

Variáveis: `{username}` usa o identificador; `{nome}` usa o primeiro nome real quando disponível e, caso contrário, deriva um nome do identificador. Com espera, o follow é consultado novamente na hora de entregar o link.

Para validar sua instalação, use uma conta de teste e um **comentário novo**, depois de a regra estar ativa e de o primeiro ciclo de polling ter ocorrido. Consulte **Atividade** para diferenciar regra não encontrada, autorização, fila e envio.

O testador de palavras-chave do painel só identifica uma regra, sem enviar mensagens. Nessa simulação ele ignora o filtro por post, para facilitar a conferência do texto.

## Boas-vindas e ebook

### Mensagem adicional

Desativada por padrão. Após uma automação com confirmação de follow entregar o material, a seção de boas-vindas pode agendar uma mensagem adicional por pessoa, com espera de 1–600 minutos e nova checagem de follow.

**Não é um detector de todos os novos seguidores.** Seguir o perfil sem passar pela interação suportada não agenda essa mensagem. O envio continua sujeito à janela e às permissões da API.

### Link dinâmico `{oferta_ebook}`

Opcional. Para um link comum, informe sua URL e ignore esta seção. O backend do ebook, checkout e entrega por email **não estão incluídos** no AutoDM.

O marcador consulta um serviço seu no momento de entregar o link:

- `vars.EBOOK_OFFER_URL` em `wrangler.jsonc`: endpoint HTTPS.
- `EBOOK_OFFER_TOKEN`: secret cadastrado com Wrangler.
- Requisição: `POST`, cabeçalho `Authorization: Bearer <seu-token>`, `Content-Type: application/json`, corpo `{"follower_id":"ig_<id-da-pessoa>"}`.
- Resposta esperada: sucesso HTTP e `{"url":"https://seu-site/link-da-oferta"}`.

Preço, expiração e validação da oferta pertencem ao backend. Para outro Worker na mesma conta, é possível adicionar um service binding `EBOOK` para esse serviço. Sem ele, o código usa `fetch` HTTP. Não adicione serviços que você não possui.

O marcador é resolvido no fluxo final de entrega. Para usá-lo em automação de comentário, habilite a confirmação de follow; a mensagem inicial sem esse fluxo não resolve o marcador.

## Configurações e comandos

| Configuração | Local | Finalidade |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `.dev.vars` / secret de produção | Painel, sessão e autenticação interna |
| `IG_APP_ID`, `IG_APP_SECRET` | Local / secrets | OAuth e assinatura Instagram |
| `META_APP_SECRET` | Local / secret opcional | Assinatura alternativa do webhook |
| `IG_VERIFY_TOKEN` | Local / secret | Validação inicial do callback |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Local / secrets | YouTube OAuth |
| `CONTACT_EMAIL` | `vars` do Wrangler | Contato público da política |
| `EBOOK_OFFER_URL` | `vars`, opcional | Endpoint de ofertas |
| `EBOOK_OFFER_TOKEN` | Local / secret opcional | Autenticação do serviço de ofertas |
| `DB` | Binding D1 | Banco da sua instalação |
| `SELF` | Service binding de produção | Distribuir tarefas no próprio Worker |
| `EBOOK` | Service binding opcional | Backend próprio de ofertas |
| `IG_GRAPH_BASE`, `YT_API_BASE`, `GOOGLE_TOKEN_URL` | Overrides locais opcionais | Desenvolvimento com APIs simuladas |

```bash
npm run dev                 # painel e D1 locais
npm run db:migrate:local     # migrações locais
npm run db:migrate           # migrações remotas: wrangler.jsonc
npm run deploy              # publica seu Worker
npx wrangler tail --config wrangler.jsonc
npx wrangler secret list --config wrangler.jsonc
```

Os testes existentes cobrem matcher e preenchimento de variáveis. Para executá-los por sua iniciativa:

```bash
npm test
npm run typecheck
```

Isso não substitui a validação de OAuth, webhooks e envios em contas próprias.

## Arquitetura e rotas

```text
Instagram: webhook / polling ─┐
                             ├─ regras → respostas / fila → eventos no D1
YouTube: polling ─────────────┘
                                      ↑
                            painel protegido por senha
```

| Rota | Finalidade |
| --- | --- |
| `/admin`, `/login`, `/logout` | Painel e sessão |
| `/privacy` | Modelo de política de privacidade |
| `GET/POST /webhooks/instagram` | Verificação e eventos assinados |
| `/auth/instagram/start`, `/auth/youtube/start` | Início de OAuth protegido |
| `/auth/instagram/callback`, `/auth/youtube/callback` | Callbacks com verificação de state |
| `/api/status`, `/api/rules`, `/api/media/:platform` | Estado, regras e mídia, autenticados |
| `/api/welcome`, `/api/stats`, `/api/events`, `/api/test` | Configuração e diagnóstico, autenticados |
| `/internal/task` | Tarefas internas autenticadas |

Código principal: `src/index.ts` (rotas, autenticação e cron), `instagram.ts` e `youtube.ts` (APIs/OAuth), `tasks.ts` (distribuição), `match.ts` (regras), `db.ts` (persistência), `admin.html` e `pwa.ts` (painel). `migrations/` contém o esquema e suas evoluções; `test/`, os testes existentes.

## Segurança, dados e manutenção

- Não publique `.env`, `.dev.vars`, chaves, dumps ou `.wrangler/`. O `.gitignore` os exclui. Arquivos já rastreados precisam ser retirados do índice; ignorar não apaga o histórico.
- O D1 armazena tokens OAuth, contatos, regras e eventos. Backups podem conter segredos e dados pessoais: mantenha-os privados.
- O painel usa uma senha compartilhada, cookie de sessão e alternativa HTTP Basic. Não há usuários com permissões individuais. Trocar `ADMIN_PASSWORD` invalida os cookies existentes.
- `/privacy` é um modelo. Revise contato, tratamento de dados, prestadores e retenção para sua operação. Solicitações de exclusão precisam ser atendidas manualmente pelo operador; não há um fluxo completo de exclusão no painel.
- A limpeza remove eventos após 180 dias, deduplicação após 30 dias e itens expirados da fila segundo o código. **Contatos e todos os demais dados não são apagados automaticamente.**
- Tokens revogados ou acessos alterados podem exigir reconectar as plataformas.
- Atualizações: faça backup privado do D1, leia as alterações, execute `git pull --ff-only`, `npm ci`, aplique novas migrações com `npm run db:migrate` e publique. Seu `wrangler.jsonc` ignorado permanece local.
- Contribuições: use um fork/branch, explique a mudança e inclua somente dados fictícios em exemplos. Não envie credenciais em issues ou PRs.

## Problemas comuns

| Sintoma | O que conferir |
| --- | --- |
| Node incompatível | Use Node 22.12+ compatível com as versões das ferramentas. |
| `wrangler.jsonc` ausente no deploy | Copie o exemplo e preencha sua configuração de produção. |
| D1 sem tabelas | Execute a migração correspondente ao ambiente, local ou remoto. |
| Senha ausente ou login recusado | Local: `.dev.vars` e reinício. Produção: secret no Worker/conta corretos. |
| Lista de posts vazia | Conexão, conta profissional, permissões e mídia disponível. |
| Comentário não dispara | Regra ativa, texto, post, primeiro ciclo de polling e permissões. Comentários antigos podem ser ignorados. |
| DM na fila / `not the thread owner` | Ferramentas conectadas e roteamento da conversa. Erros reconhecidos de bloqueio/limite são reenviados, sujeitos à expiração. |
| `User consent is required` / follow não confirmado | Interação suportada, permissões e campo disponível na API. O link com exigência de follow fica bloqueado sem confirmação. |
| Webhook não verifica | HTTPS público, callback, deploy e `IG_VERIFY_TOKEN` idêntico. |
| OAuth rejeitado | Callback exato, incluindo protocolo e domínio, e credenciais do app correto. |
| Google bloqueia login ou pede reconexão | Usuários de teste, consentimento, revisão e escopos no Google Cloud. |
| Limite de API/Cloudflare | Consulte consumo e erro. A fila não elimina limites externos. |
| Boas-vindas não dispara ao ganhar seguidor | Depende da conclusão de uma automação com follow, não do simples follow. |
| `ebook offer not configured` | Use link comum ou configure seu backend e token. |

## Referências

- [Cloudflare: D1 local](https://developers.cloudflare.com/d1/best-practices/local-development/), [migrações](https://developers.cloudflare.com/d1/reference/migrations/) e [secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
- [Meta: Instagram API com Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).
- [Google: OAuth web para YouTube](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps).

As telas e exigências dos provedores podem mudar. Este guia descreve este código e a configuração necessária; a aprovação das integrações depende das plataformas.
