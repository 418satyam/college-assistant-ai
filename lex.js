/**
 * lex.js
 * ------------------------------------------------------------------
 * Handles all communication with Amazon Lex V2 via temporary,
 * unauthenticated Amazon Cognito credentials.
 *
 * Flow:
 *   1. CognitoIdentityClient exchanges the Identity Pool ID for an
 *      Identity ID (GetId).
 *   2. GetCredentialsForIdentity exchanges that Identity ID for
 *      short-lived AWS credentials (access key, secret key, session
 *      token) scoped by the pool's IAM role.
 *   3. Those temporary credentials sign requests to LexRuntimeV2
 *      (RecognizeText) using the AWS SDK v3's SigV4 request signer,
 *      which the client does automatically.
 *
 * No AWS secret ever touches this codebase — credentials are fetched
 * fresh from Cognito at runtime and expire automatically.
 * ------------------------------------------------------------------
 */

import { CONFIG, isConfigured } from "./config.js";
import { generateId, storage } from "./utils.js";

// AWS SDK v3 modular clients, loaded from the AWS-maintained browser-ready
// CDN distribution as ES modules. Static-hosting friendly — no bundler,
// no build step required. See: https://github.com/AWS-SDK
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";

import {
  LexRuntimeV2Client,
  RecognizeTextCommand,
} from "@aws-sdk/client-lex-runtime-v2";

let lexClient = null;
let cachedCredentials = null; // { accessKeyId, secretAccessKey, sessionToken, expiration }
let identityId = null;

/** Returns (and lazily creates) a persistent per-browser Lex session id. */
export function getSessionId() {
  let sessionId = storage.get(CONFIG.storageKeys.sessionId);
  if (!sessionId) {
    sessionId = generateId("session");
    storage.set(CONFIG.storageKeys.sessionId, sessionId);
  }
  return sessionId;
}

/** True if the cached credentials exist and are not close to expiring. */
function credentialsAreFresh() {
  if (!cachedCredentials || !cachedCredentials.expiration) return false;
  const bufferMs = 60_000; // refresh 1 minute early
  return new Date(cachedCredentials.expiration).getTime() - Date.now() > bufferMs;
}

/**
 * Fetches (or reuses) temporary Cognito credentials for an
 * unauthenticated identity, then builds a signed LexRuntimeV2Client.
 */
async function ensureLexClient() {
  if (lexClient && credentialsAreFresh()) return lexClient;

  const identityClient = new CognitoIdentityClient({ region: CONFIG.region });

  if (!identityId) {
    const { IdentityId } = await identityClient.send(
      new GetIdCommand({ IdentityPoolId: CONFIG.identityPoolId })
    );
    identityId = IdentityId;
  }

  const { Credentials } = await identityClient.send(
    new GetCredentialsForIdentityCommand({ IdentityId: identityId })
  );

  cachedCredentials = {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretKey,
    sessionToken: Credentials.SessionToken,
    expiration: Credentials.Expiration,
  };

  lexClient = new LexRuntimeV2Client({
    region: CONFIG.region,
    credentials: async () => ({
      accessKeyId: cachedCredentials.accessKeyId,
      secretAccessKey: cachedCredentials.secretAccessKey,
      sessionToken: cachedCredentials.sessionToken,
      expiration: new Date(cachedCredentials.expiration),
    }),
  });

  return lexClient;
}

/**
 * Verifies connectivity to AWS/Lex by fetching Cognito credentials.
 * Used at app startup to drive the "Connecting… / Online / Offline"
 * status indicator without sending a real user message.
 */
export async function testConnection() {
  if (!isConfigured()) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    await ensureLexClient();
    return { ok: true };
  } catch (err) {
    console.error("[lex] Connection test failed:", err);
    return { ok: false, reason: "aws_error", error: err };
  }
}

/**
 * Sends a text message to the configured Lex V2 bot and returns a
 * normalized response object.
 *
 * @param {string} text - The sanitized user message.
 * @returns {Promise<{messages: string[], intent: string|null, state: string|null}>}
 */
export async function sendMessageToLex(text) {
  if (!isConfigured()) {
    throw new Error(
      "College Assistant AI is not yet configured. Add your Cognito Identity Pool ID and Lex bot details to config.js."
    );
  }

  const client = await ensureLexClient();
  const sessionId = getSessionId();

  const command = new RecognizeTextCommand({
    botId: CONFIG.lex.botId,
    botAliasId: CONFIG.lex.botAliasId,
    localeId: CONFIG.lex.localeId,
    sessionId,
    text,
  });

  const response = await client.send(command);

  const messages = (response.messages || [])
    .map((m) => m.content)
    .filter(Boolean);

  return {
    messages: messages.length ? messages : ["I'm sorry, I didn't quite catch that. Could you rephrase?"],
    intent: response.sessionState?.intent?.name || null,
    state: response.sessionState?.intent?.state || null,
    raw: response,
  };
}

/** Resets the Lex conversation by issuing a brand-new session id. */
export function resetLexSession() {
  const sessionId = generateId("session");
  storage.set(CONFIG.storageKeys.sessionId, sessionId);
  return sessionId;
}
