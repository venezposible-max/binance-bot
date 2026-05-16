import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import fs from "fs";

const apiId = 34693713;
const apiHash = "ac85826864b1ee35fed41cd4966631f5";
const stringSession = new StringSession(""); // Empezamos con una sesión vacía

(async () => {
  console.log("Iniciando conexión con Telegram...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: "+584141700626",
    password: async () => await input.text("Ingresa tu contraseña (2FA) si tienes, si no presiona Enter: "),
    phoneCode: async () => await input.text("POR FAVOR, INGRESA EL CÓDIGO DE 5 DÍGITOS QUE TE LLEGÓ A TELEGRAM: "),
    onError: (err) => console.log(err),
  });

  console.log("¡CONEXIÓN EXITOSA!");
  const sessionString = client.session.save();
  fs.writeFileSync("session.txt", sessionString);
  console.log("SESIÓN GUARDADA EN session.txt");
  await client.disconnect();
  process.exit(0);
})();
