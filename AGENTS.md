# AutoDM: orientações para agentes

Leia o [README.md](README.md) antes de instalar ou modificar o projeto. Ele é a fonte principal dos passos de instalação, permissões e limitações.

- Fale em português claro e guie um passo de cada vez.
- Requer Node.js 22.12+; use `npm ci` para respeitar o lockfile.
- Desenvolvimento: `wrangler.local.jsonc` e banco local. Produção: copie `wrangler.example.jsonc` para o arquivo ignorado `wrangler.jsonc` e configure os recursos da própria pessoa.
- Mantenha `SELF.service` igual ao nome do Worker de produção. Não adicione `EBOOK` sem um serviço próprio: a integração é opcional.
- Nunca imprima nem versione senhas, tokens, `.env`, `.dev.vars`, dumps do D1 ou conteúdo de `.wrangler`.
- Exemplos contêm somente campos vazios ou valores fictícios. Em produção, use `wrangler secret put NOME --config wrangler.jsonc` interativamente. Não peça credenciais em issues ou chats públicos.
- Não faça commit de `wrangler.jsonc`, que contém os identificadores da instalação. Confira o diff e os arquivos antes de um push autorizado.
- Login, aprovação de permissões e envio para revisão da Meta/Google dependem do responsável pela conta.
- Não prometa que polling contorna permissões ou App Review. Confirme o acesso aplicável no painel oficial.
- Boas-vindas agenda uma mensagem após uma automação com confirmação de follow; não detecta todos os novos seguidores.
- Não envie mensagens/comentários reais como verificação sem autorização. Só execute testes quando solicitados ou autorizados na tarefa.
- Não faça deploy em produção apenas para atualizar documentação ou publicar no GitHub.
- Os testes existentes cobrem matcher e variáveis, não o fluxo completo das APIs.
- `/privacy` é um modelo: o operador deve revisar o texto e atender solicitações de exclusão manualmente.
