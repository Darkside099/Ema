const BASE_BACKEND_URL = "https://ema-6dmn.onrender.com";

// Cache Keys
const CACHE_PREFIX = "ema_summary_";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function onHomepageOpen() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle("Ema – Email Summarizer")
        .setSubtitle("Open an email to summarize it")
    )
    .build();
}

function getContextualAddOn(e) {
  return buildSummaryUI(e);
}

function buildSummaryUI(e) {
  const messageId = e.messageId || (e.gmail && e.gmail.messageId) || "";

  const card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader()
      .setTitle("Ema – Summarize Email")
      .setSubtitle("AI-powered summarizer")
  );

  if (!messageId) {
    return card
      .addSection(
        CardService.newCardSection().addWidget(
          CardService.newTextParagraph().setText("Open an email to enable Ema.")
        )
      )
      .build();
  }

  const controls = CardService.newCardSection()
    .addWidget(
      CardService.newSelectionInput()
        .setType(CardService.SelectionInputType.DROPDOWN)
        .setFieldName("length")
        .setTitle("Summary Length")
        .addItem("Short", "short", true)
        .addItem("Medium", "medium", false)
        .addItem("Long", "long", false)
    )
    .addWidget(
      CardService.newSelectionInput()
        .setType(CardService.SelectionInputType.DROPDOWN)
        .setFieldName("tone")
        .setTitle("Tone")
        .addItem("Neutral", "neutral", true)
        .addItem("Formal", "formal", false)
        .addItem("Friendly", "friendly", false)
    )
    .addWidget(
      CardService.newSelectionInput()
        .setType(CardService.SelectionInputType.CHECK_BOX)
        .setFieldName("bullets")
        .setTitle("Format")
        .addItem("Use bullet points", "true", true)
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Summarize Email")
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName("onSummarize")
              .setParameters({ messageId })
          )
      )
    );

  const placeholder = CardService.newCardSection().addWidget(
    CardService.newTextParagraph().setText("Click Summarize to generate summary.")
  );

  card.addSection(controls).addSection(placeholder);
  return card.build();
}

function onSummarize(e) {
  const params = e.parameters || {};
  const messageId = params.messageId;
  const form = e.commonEventObject.formInputs;

  const length = form.length?.stringInputs?.value?.[0] || "short";
  const tone = form.tone?.stringInputs?.value?.[0] || "neutral";
  const bullets = form.bullets?.stringInputs?.value?.[0] === "true";
  const accessToken = ScriptApp.getOAuthToken();

  if (!messageId) return errorCard("No email selected.");

  // LOAD EMAIL
  let raw;
  try {
    raw = Gmail.Users.Messages.get("me", messageId, { format: "full" });
  } catch (err) {
    return errorCard("Cannot read email. Check permissions.");
  }

  // Prepare checksum for settings
  const settingsHash = `${length}_${tone}_${bullets}`;

  // CACHE CHECK
  const userProps = PropertiesService.getUserProperties();
  const cacheKey = CACHE_PREFIX + messageId + "_" + settingsHash;

  const cached = userProps.getProperty(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && (Date.now() - parsed.ts) < CACHE_TTL_MS) {
        return CardService.newNavigation().updateCard(
          summaryCard(parsed.summary, true)
        );
      }
    } catch (e) { }
  }

  // Extract email data
  const payload = extractMessage(raw);
  payload.length = length;
  payload.tone = tone;
  payload.bullets = bullets;

  // SEND TO BACKEND
  let resp;
  try {
    resp = UrlFetchApp.fetch(`${BASE_BACKEND_URL}/summarize`, {
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + accessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch {
    return errorCard("Backend not reachable.");
  }

  const code = resp.getResponseCode();
  let summaryText =
    code === 200
      ? JSON.parse(resp.getContentText()).summary
      : `Backend Error (${code}): ${resp.getContentText()}`;

  // SAVE TO CACHE
  userProps.setProperty(
    cacheKey,
    JSON.stringify({
      summary: summaryText,
      ts: Date.now()
    })
  );

  return CardService.newNavigation().updateCard(
    summaryCard(summaryText, false)
  );
}

// Extract email data
function extractMessage(raw) {
  let subject = "", from = "";

  (raw.payload.headers || []).forEach((h) => {
    if (h.name === "Subject") subject = h.value;
    if (h.name === "From") from = h.value;
  });

  const body = getBody(raw.payload);

  return { subject, from_email: from, body };
}

function getBody(payload) {
  const decode = (d) => {
    try {
      return Utilities.newBlob(Utilities.base64DecodeWebSafe(d)).getDataAsString();
    } catch {
      return null;
    }
  };

  if (!payload) return "";

  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        const t = decode(p.body.data);
        if (t) return t;
      }
    }
  }

  if (payload.body?.data) {
    const html = decode(payload.body.data);
    return html ? stripHtml(html) : "";
  }

  return "";
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summaryCard(summary, cached) {
  const c = cached ? " (cached)" : "";
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle("Ema – Summary" + c)
        .setSubtitle("AI Email Summary")
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(summary)
      )
    )
    .build();
}

function errorCard(msg) {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle("Ema – Error")
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(msg)
      )
    )
    .build();
}
