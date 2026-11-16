# Monarch Store

Loja Node.js/Express com autenticação Discord, painel de administração,
pagamentos PayPal Checkout e área de cliente.

## Executar localmente

1. Instala Node.js 22.13 ou superior e executa `npm install`.
2. Cria um ficheiro `.env` local com `DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`, `REDIRECT_URI=http://localhost:3000/auth/discord/callback`
   e um `SESSION_SECRET` aleatório com pelo menos 32 caracteres.
3. Regista o URL de callback acima na aplicação OAuth2 do Discord.
4. Define o ID Discord do fundador em `site/protected/super-admin.json`.
5. Executa `npm start`. O terminal apresenta o endereço local, por exemplo
   `http://localhost:3000`.

O desenvolvimento local usa SQLite em `data/store.sqlite` e guarda uploads em
`assets/imgs/uploads/` e `site/protected/product-downloads/`. Não abras as
páginas com `file://` nem com o Live Server: as sessões, o painel e o checkout
precisam do servidor Express.

## Publicar na Vercel

1. Cria uma base PostgreSQL no Neon e dois Blob stores na Vercel: um público
   para imagens e outro privado para ficheiros de entrega.
2. Configura estas variáveis no projeto Vercel:
   - `DATABASE_URL`: URL de ligação do Neon.
   - `SESSION_SECRET`: segredo aleatório persistente com pelo menos 32 caracteres.
   - `FOUNDER_DISCORD_ID`: ID Discord do fundador.
   - `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`.
   - `REDIRECT_URI`: `https://<dominio>/auth/discord/callback`, registado também
     na aplicação Discord.
   - `APP_URL`: URL HTTPS canónico do site, sem caminho final.
   - `BLOB_PUBLIC_READ_WRITE_TOKEN`: token do Blob store público.
   - `BLOB_PRIVATE_READ_WRITE_TOKEN`: token do Blob store privado.
3. Liga os dois Blob stores ao projeto e confirma que os tokens correspondem,
   respetivamente, aos stores público e privado.
4. Publica o projeto. `vercel.json` encaminha as páginas e a API para a função
   Express; os produtos de exemplo são inseridos automaticamente na base Neon
   vazia. Os dados SQLite e contas de teste locais não são importados.
5. Inicia sessão como fundador e abre **Administração → Configurações**.
   Escolhe **Sem PayPal** para guardar a identidade visual sem configurar
   pagamentos; escolhe **PayPal Checkout** e indica o ambiente (Sandbox ou
   Live), Client ID e Client Secret, ou escolhe **PayPal.me** e indica o link
   do perfil. O valor é acrescentado ao link automaticamente. O Client Secret
   é encriptado na base de dados com uma chave derivada de `SESSION_SECRET` e
   não é enviado de volta ao navegador.

No PayPal Checkout, depois de o cliente aprovar o pagamento, o servidor
captura-o automaticamente e valida o valor e a moeda antes de marcar a
encomenda como paga; o fundador não precisa de aceitar a transação. No
PayPal.me, a encomenda fica pendente até um administrador confirmar
manualmente o recebimento. Sem PayPal, o pedido é criado na mesma e o cliente
recebe um link para abrir um ticket no Discord e combinar o pagamento. A área
cliente só disponibiliza os ficheiros após a confirmação do pagamento.

## Estrutura

- `site/`: páginas públicas, área de administração, área cliente, scripts e
  folha de estilos partilhada.
- `site/protected/`: configuração e conteúdo privado que não é servido como
  ficheiro estático.
- `assets/imgs/`: imagens do site; imagens carregadas na Vercel ficam no Blob
  público.
- `assets/fonts/`: fontes.
- `api/index.js` e `vercel.json`: entrada da função Vercel.
- `server.js`: aplicação Express, APIs e servidor local.

Os ficheiros de entrega são guardados no Blob privado na Vercel e só são
transmitidos pelo servidor depois de confirmar a sessão e a compra ou atribuição
do produto. Cada ficheiro carregado tem um limite de 3.5 MB, mantendo margem
face ao limite de corpo de 4.5 MB das funções Vercel.
