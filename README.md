# College Assistant AI

A production-ready, premium chatbot website powered by **Amazon Lex V2**, built entirely with static HTML/CSS/JavaScript (ES6+) — no frameworks, no build step, deployable directly to GitHub Pages.

![status](https://img.shields.io/badge/status-ready--to--configure-6D5EF5)
![stack](https://img.shields.io/badge/stack-HTML%20%7C%20CSS%20%7C%20Vanilla%20JS-22D3C3)

---

## 1. Project Overview

College Assistant AI is a conversational interface for prospective and current students to ask about **courses, admissions, and contact information**. The frontend is a glassmorphic, dark/light-aware single-page app that talks directly to an Amazon Lex V2 bot from the browser, authenticated via short-lived Amazon Cognito credentials — no backend server required.

**Highlights**

- Premium SaaS-grade UI (glassmorphism, animated gradients, Inter typography)
- Full light/dark/auto theme system with live OS-preference detection
- Persistent, multi-conversation chat history (localStorage)
- Markdown-rendered bot replies (bold, lists, links, code) with strict HTML escaping
- Voice input (Speech-to-Text) and spoken replies (Text-to-Speech) via the Web Speech API
- Copy / regenerate / export / clear-chat message actions
- Accessible: keyboard navigable, ARIA-labeled, visible focus states
- Zero secrets in source — authenticates only through a Cognito **unauthenticated** Identity Pool

---

## 2. Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐        ┌────────────────────┐
│   Browser (SPA)      │        │   Amazon Cognito           │        │   Amazon Lex V2      │
│   index.html          │──1───▶│   Identity Pool             │──2───▶│   Bot Runtime         │
│   app.js / lex.js     │        │   (GetId, GetCredentials)  │        │   RecognizeText       │
│   style.css            │◀──3──│   → temporary IAM creds     │◀──4──│   (RecognizeTextCommand)│
└─────────────────────┘        └──────────────────────────┘        └────────────────────┘
        │
        ▼
  localStorage (conversation history, theme, settings, session id)
```

1. On load, the browser asks Cognito for an `IdentityId` using only the public **Identity Pool ID**.
2. Cognito exchanges that Identity ID for **temporary, scoped AWS credentials** (access key, secret key, session token — all short-lived and auto-expiring).
3. Those credentials are used by the AWS SDK v3 to sign requests to LexRuntimeV2 automatically (SigV4), with no manual key handling.
4. `RecognizeTextCommand` sends the user's message to your Lex V2 bot and returns its reply, which is rendered as chat bubbles.

### File structure

```
college-assistant-ai/
├── index.html      # App shell: sidebar, topbar, welcome screen, composer, modals
├── style.css        # Design system: tokens, glassmorphism, animations, responsive layout
├── app.js            # UI orchestration: chat rendering, history, theme, voice, toasts
├── lex.js             # Amazon Cognito + Lex V2 integration (auth, RecognizeText)
├── config.js          # Your AWS region / Identity Pool / Bot IDs (no secrets)
├── utils.js            # Sanitization, markdown rendering, storage, DOM helpers
└── README.md            # You are here
```

---

## 3. AWS Setup

### Step 1 — Create your Amazon Lex V2 bot

1. Open the [Amazon Lex console](https://console.aws.amazon.com/lexv2/) → **Create bot**.
2. Choose **Traditional**, give it a name (e.g. `CollegeAssistantBot`), and pick a runtime role (Lex can create one for you).
3. Add a locale, e.g. **English (US)**.
4. Create intents for the flows you need, for example:
   - `GreetingIntent` — sample utterances: "hi", "hello", "hey there"
   - `CourseInfoIntent` — "what courses do you offer", "tell me about your programs"
   - `AdmissionInfoIntent` — "how do I apply", "what are the admission requirements"
   - `ContactInfoIntent` — "how can I contact you", "what's your phone number"
   - Configure the built-in **Fallback Intent** with a friendly "I didn't quite catch that" message.
5. **Build** the bot, then create an **alias** (e.g. `Prod` or use the auto-created `TestBotAlias`).
6. Note down: **Bot ID**, **Bot Alias ID**, and **Locale ID** — you'll need these in `config.js`.

### Step 2 — Create a Cognito Identity Pool (unauthenticated access)

1. Open the [Amazon Cognito console](https://console.aws.amazon.com/cognito/) → **Identity pools** → **Create identity pool**.
2. Name it (e.g. `college-assistant-ai-pool`).
3. Under **Guest access**, enable **Enable access to unauthenticated identities**. This is what lets the browser get credentials without a login system.
4. Complete creation — Cognito will auto-generate an **unauthenticated IAM role** (e.g. `Cognito_college_assistant_ai_poolUnauth_Role`).
5. Copy the **Identity Pool ID** (format: `us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) into `config.js`.

### Step 3 — IAM permissions for the unauthenticated role

Attach an inline policy to the **unauthenticated** IAM role created above, granting only what's needed to talk to your bot:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lex:RecognizeText",
        "lex:RecognizeUtterance",
        "lex:DeleteSession",
        "lex:PutSession",
        "lex:GetSession"
      ],
      "Resource": "arn:aws:lex:REGION:ACCOUNT_ID:bot-alias/BOT_ID/BOT_ALIAS_ID"
    }
  ]
}
```

Replace `REGION`, `ACCOUNT_ID`, `BOT_ID`, and `BOT_ALIAS_ID` with your actual values. Scoping the resource ARN to your specific bot alias (rather than `"*"`) keeps the unauthenticated role tightly locked down.

### Step 4 — Configure the app

Open `config.js` and fill in:

```js
export const CONFIG = {
  region: "us-east-1",
  identityPoolId: "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  lex: {
    botId: "ABCD1234EF",
    botAliasId: "TSTALIASID",
    localeId: "en_US",
  },
  // ...leave the rest as-is
};
```

That's it — no `.env` files, no server, no secrets to rotate.

---

## 4. Running Locally

Because the app uses native ES modules, you need to serve it over HTTP (not `file://`):

```bash
# Any static file server works, e.g.:
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`.

---

## 5. Deploying to GitHub Pages

1. Push this project to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose the branch (e.g. `main`) and root folder (`/`).
4. Save — GitHub will publish your site at `https://<username>.github.io/<repo-name>/`.
5. No build step is required; the static files are served as-is.

> **CORS note:** Amazon Lex V2's `RecognizeText` API is called directly from the browser using signed SDK requests, which does not require special CORS configuration on your side — AWS handles this for public API endpoints accessed via the SDK.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Status shows "Connection issue" | `config.js` still has placeholder values | Fill in `identityPoolId`, `botId`, `botAliasId` |
| `AccessDeniedException` in console | Unauthenticated IAM role lacks Lex permissions | Re-check the inline policy in Step 3 |
| Bot always falls back | Bot not **built**, or wrong `botAliasId` | Rebuild the bot in the Lex console; confirm alias is pointed at the latest version |
| Voice mic button is disabled | Browser doesn't support the Web Speech API | Use Chrome/Edge; Safari/Firefox support is limited |
| Nothing loads / blank page | Opened via `file://` instead of a local server | Serve via `python3 -m http.server` or similar |
| CDN script fails to load | Network restrictions blocking `jsdelivr.net` or `unpkg.com` | Allow those domains, or self-host the AWS SDK v3 modules and update the import paths in `lex.js` |

---

## 7. Security Notes

- No AWS access keys or secrets ever appear in this codebase.
- All AWS access happens through **temporary, auto-expiring Cognito credentials** scoped to a minimal IAM policy.
- User input is HTML-escaped before rendering; markdown rendering only allows a safe, constrained subset (bold, italics, code, lists, `http(s)`/`mailto` links) — no raw HTML injection.
- Conversation history is stored only in the visitor's own browser (`localStorage`), never transmitted anywhere except to Lex as plain message text.

---

## 8. Future Improvements

- File/image attachments (the paperclip button is present but intentionally disabled — wire it up to Lex's multimodal or a custom fulfillment Lambda)
- Streaming/partial responses for a more "live typing" feel
- Multi-language support by switching `localeId` and adding a language switcher
- Authenticated mode (Cognito User Pools) for personalized student data
- Analytics dashboard for common questions and fallback rates

---

Built with HTML5, CSS3, vanilla JavaScript (ES6+), AWS SDK v3, and Amazon Lex V2.
