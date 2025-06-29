import "dotenv/config"; // Import and configure dotenv directly
import { Vonage } from "@vonage/server-sdk";
import { Auth } from "@vonage/auth";
import { readFileSync } from "fs";

const privateKeyFilePath = process.env.VONAGE_PRIVATE_KEY;

if (!privateKeyFilePath) {
  throw new Error("VONAGE_PRIVATE_KEY_FILE environment variable is not set.");
}

export const key = readFileSync(privateKeyFilePath).toString();

export const auth = new Auth({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: key,
});

export const vonage = new Vonage(auth);
