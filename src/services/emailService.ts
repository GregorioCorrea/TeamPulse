// src/services/emailService.ts
import { EmailClient } from "@azure/communication-email";

// 1) Cargar la connection string directamente del env
const ACS_CONN_STRING = process.env.ACS_EMAIL_CS!;
if (!ACS_CONN_STRING) {
  throw new Error("Falta ACS_EMAIL_CS en las variables de entorno");
}

// 2) Cliente de Email
const emailClient = new EmailClient(ACS_CONN_STRING);

// 3) Datos de correo
const FROM   = process.env.FROM_EMAIL    || "DoNotReply@teampulse-comm.azureemail.net";
const TO     = process.env.SUPPORT_EMAIL || "support@incumate.io";

// 4) Función utilitaria
export async function enviarReportePorEmail(asunto: string, cuerpo: string) {
  const message = {
    senderAddress: FROM,
    content: {
      subject: asunto,
      plainText: cuerpo
    },
    recipients: {
      to: [{ address: TO, displayName: "TeamPulse Support" }]
    }
  };

  // beginSend devuelve un poller; esperamos a que termine
  const poller = await emailClient.beginSend(message);
  await poller.pollUntilDone();
}
