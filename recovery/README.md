# Recuperação de desastre do Yes! Park

Esta pasta contém as 14 migrações do projeto original, sem linhas reais de produção, e o código da função submit-review (v3). O repositório não é backup de dados pessoais nem contém chaves de acesso.

## Reconstruir em um novo projeto Supabase vazio

1. Crie um projeto **separado**. Não aplique schema-replay.sql sobre o projeto original ou um destino em uso. Não modifique o endereço público durante a recuperação.
2. Execute recovery/schema-replay.sql no SQL Editor do novo projeto. O histórico reproduz tabelas, RLS, funções, índices, bucket e permissões. A migração de snapshot recria somente um snapshot do novo banco inicialmente vazio, não o snapshot histórico original.
3. Reconfigure Authentication: Site URL e Redirect URL para a instalação pretendida, serviço de e-mail, política de senhas e permissões. Crie uma conta administrativa confirmada através do Dashboard / Authentication / Users; vincule o UUID novo em public.admins (active=true). Nunca copie senhas ou tokens antigos. Credenciais e configurações de serviços não integram este repositório.
4. Restaure a função recovery/submit-review/index.ts como Edge Function submit-review, com verify_jwt=false, como no projeto original. A função realiza validação própria e usa SUPABASE_SERVICE_ROLE_KEY fornecida pelo ambiente de Edge Functions. Configure REVIEW_FINGERPRINT_SALT privado, sem colocar segredos no GitHub. Não use as chaves do projeto original.
5. Recupere o ZIP operacional (se estiver criptografado .ypb, primeiro use o utilitário de descriptografia e a senha de recuperação). Instale Node.js 22 e, na raiz deste repositório, execute npm install --no-save --no-package-lock @supabase/supabase-js@2.57.0.
6. Defina localmente as variáveis YESPARK_RESTORE_URL (HTTPS do novo projeto), YESPARK_RESTORE_KEY (somente chave anon/publicável), YESPARK_RESTORE_EMAIL e YESPARK_RESTORE_PASSWORD da nova conta. Não envie essas credenciais no chat, não as salve no repositório. Execute:

   `node recovery/restore-new-project.mjs caminho-do-backup.zip`

   A primeira execução só valida o ZIP e o destino e simula as inserções. Se o relatório estiver correto, execute o mesmo comando acrescentando `--apply`. O utilitário recusa a URL do projeto original e qualquer destino com cadastros ou imagens. Remapeia URLs das mídias, recupera registros ausentes e configurações iniciais. A restauração de Storage e banco não é atômica entre serviços; se falhar após gravação parcial, investigue ou recomece com outro destino vazio.
7. Valide o catálogo, imagens, painel, avaliações e autenticação na nova instalação. Atualize js/config.js com URL e chave pública do **novo** projeto, só depois da homologação. Nunca inclua service_role no navegador.
8. Reconfigure o destino externo e a rotina de backups. Preserve a cópia original até confirmar a recuperação.

O ZIP operacional contém sete tabelas e mídia. Ele não contém o banco Auth, segredos, registros internos de limitação de avaliações nem configurações de infraestrutura externas. A conta administrativa deve ser recriada; não se preserva a senha antiga. A recuperação testada usa dados fictícios em ambiente local, não um failover real em nuvem.
