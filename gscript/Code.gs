const BASE_BACKEND_URL = "https://your-backend.example.com";

function onHomepageOpen(e) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle("AI Email Summarizer")
        .setSubtitle("Select an email to generate a summary")
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          "Open any email and the add-on will provide a summary."
        )
      )
    )
    .build();

  return card;
}

function getContextualAddOn(e) {
  return buildCardForMessage(e);
}

function buildCardForMessage(e) {
  const messageId = e.messageId || (e.gmail && e.gmail.messageId);

  const card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader()
      .setTitle("AI Email Summarizer")
      .setSubtitle("Generate quick, accurate summaries")
  );

  const lengthDropdown = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName("length")
    .setTitle("Summary Length")
    .addItem("Short", "short", true)
    .addItem("Medium", "medium", false)
    .addItem("Long", "long", false);

  const toneDropdown = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName("tone")
    .setTitle("Tone")
    .addItem("Neutral", "neutral", true)
    .addItem("Formal", "formal", false)
    .addItem("Casual", "casual", false);

  const bulletsCheckbox = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setFieldName("bullets")
    .setTitle("Format")
    .addItem("Use bullet points", "true", true);

  const summarizeAction = CardService.newAction()
    .setFunctionName("onSummarize")
    .setParameters({ messageId: messageId });

  const summarizeButton = CardService.newTextButton()
    .setText("Summarize with AI")
    .setOnClickAction(summarizeAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED);

  const controlsSection = CardService.newCardSection()
    .addWidget(lengthDropdown)
    .addWidget(toneDropdown)
    .addWidget(bulletsCheckbox)
    .addWidget(CardService.newButtonSet().addButton(summarizeButton));

  const placeholderSection = CardService.newCardSection()
    .setHeader("Summary")
    .addWidget(
      CardService.newTextParagraph().setText(
        "Click 'Summarize with AI' to generate a summary."
      )
    );

  card.addSection(controlsSection);
  card.addSection(placeholderSection);

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

  const raw = Gmail.Users.Messages.get("me", messageId, { format: "full" });

  const payload = extractMessage(raw);
  payload.length = length;
  payload.tone = tone;
  payload.bullets = bullets;

  const resp = UrlFetchApp.fetch(`${BASE_BACKEND_URL}/summarize`, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();

  const summaryText =
    code === 200
      ? JSON.parse(resp.getContentText()).summary
      : `Backend Error (${code})\n${resp.getContentText()}`;

  return CardService.newNavigation().updateCard(
    buildResultCard(summaryText, messageId)
  );
}

function extractMessage(raw) {
  const headers = raw.payload.headers;
  let subject = "";
  let from = "";

  headers.forEach((h) => {
    if (h.name === "Subject") subject = h.value;
    if (h.name === "From") from = h.value;
  });

  const body = getBodyFromPayload(raw.payload);

  return {
    subject: subject,
    from_email: from,
    body: body
  };
}

function getBodyFromPayload(payload) {
  if (!payload) return "";

  if (payload.parts && payload.parts.length) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Utilities.newBlob(
          Utilities.base64DecodeWebSafe(part.body.data)
        ).getDataAsString();
      }
    }
    for (const part of payload.parts) {
      if (part.body?.data) {
        return Utilities.newBlob(
          Utilities.base64DecodeWebSafe(part.body.data)
        ).getDataAsString();
      }
    }
  }

  if (payload.body?.data) {
    return Utilities.newBlob(
      Utilities.base64DecodeWebSafe(payload.body.data)
    ).getDataAsString();
  }

  return "";
}

function buildResultCard(summaryText, messageId) {
  const card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader()
      .setTitle("AI Summary")
      .setSubtitle("Generated Result")
  );

  const section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(summaryText));

  const replyAction = CardService.newAction()
    .setFunctionName("createDraftReply")
    .setParameters({ summary: summaryText });

  section.addWidget(
    CardService.newTextButton()
      .setText("Create Reply Draft")
      .setOnClickAction(replyAction)
  );

  card.addSection(section);

  return card.build();
}

function createDraftReply(e) {
  const summary = e.parameters?.summary || "";

  GmailApp.createDraft("", "Re:", summary);

  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader().setTitle("Draft Created")
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          "A reply draft has been created using your AI summary."
        )
      )
    )
    .build();

  return CardService.newNavigation().updateCard(card);
}
