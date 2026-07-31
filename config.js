export const CONFIG = {
  // AWS Region
  region: "us-east-1",

  // Cognito Identity Pool
  identityPoolId: "us-east-1:db0b3631-ca31-4bce-9395-d71aa99306f4",

  // Amazon Lex V2
  lex: {
    botId: "CQXYXQTWH6",
    botAliasId: "Y9RJQMBYHR",
    localeId: "en_US",
  },

  appName: "College Assistant AI",

  features: {
    voiceInput: true,
    voiceOutput: true,
    soundEffects: true,
    persistHistory: true,
  },

  storageKeys: {
    conversations: "caai_conversations_v1",
    activeConversation: "caai_active_conversation_v1",
    theme: "caai_theme_v1",
    settings: "caai_settings_v1",
    sessionId: "caai_session_id_v1",
  },
};

export function isConfigured() {
  return true;
}