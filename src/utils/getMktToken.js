// src/utils/getMktToken.js
require("dotenv").config({ path: ".env.local" });
const { ClientSecretCredential } = require("@azure/identity");

async function main() {
  const cred = new ClientSecretCredential(
    process.env.MP_TENANT_ID,
    process.env.MP_CLIENT_ID,
    process.env.MP_CLIENT_SECRET
  );
  const { token } = await cred.getToken("https://marketplaceapi.microsoft.com/.default");
  console.log(token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
