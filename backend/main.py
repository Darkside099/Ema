from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import os, requests
from dotenv import load_dotenv
from typing import Optional

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY")

if not GEMINI_API_KEY or not FLASK_SECRET_KEY:
    raise RuntimeError("Missing GEMINI_API_KEY or FLASK_SECRET_KEY in environment")

app = FastAPI(title="Gmail Add-on Summarizer (Gemini version)")

class SummarizeRequest(BaseModel):
    subject: Optional[str] = None
    from_email: Optional[str] = None
    body: str
    length: Optional[str] = "short"
    tone: Optional[str] = "neutral"
    bullets: Optional[bool] = True


def verify_google_access_token(access_token: str):
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing access token")

    resp = requests.get(
        "https://oauth2.googleapis.com/tokeninfo",
        params={"access_token": access_token},
        timeout=10
    )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google access token")

    info = resp.json()
    if "email" not in info and "aud" not in info:
        raise HTTPException(status_code=401, detail="Google token missing claims")
    if "scope" in info and "gmail.addons.execute" not in info["scope"]:
        raise HTTPException(status_code=401, detail="Token missing add-on execute scope")

    return info


def build_prompt(req: SummarizeRequest):
    meta = []
    if req.subject:
        meta.append(f"Subject: {req.subject}")
    if req.from_email:
        meta.append(f"From: {req.from_email}")
    meta.append(f"Length: {req.length}")
    meta.append(f"Tone: {req.tone}")
    meta.append(f"Bulleted: {req.bullets}")

    instructions = (
        "Summarize the email body below. If bullets are requested, produce a bulleted list. "
        "Otherwise, write a short paragraph. Also include a one-sentence suggested reply."
    )

    return "\n".join([
        "You are an efficient email summarizer.",
        "Metadata: " + " | ".join(meta),
        instructions,
        "EMAIL BODY:",
        req.body
    ])


@app.post("/summarize")
async def summarize(req: SummarizeRequest, authorization: Optional[str] = Header(None)):
    # Authentication via Gmail Add-on
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.split(" ", 1)[1].strip()
    verify_google_access_token(token)

    prompt = build_prompt(req)

    # Gemini request
    gemini_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

    headers = {"Content-Type": "application/json"}
    params = {"key": GEMINI_API_KEY}

    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 400
        }
    }

    r = requests.post(gemini_url, headers=headers, params=params, json=payload, timeout=30)

    if r.status_code == 429:
        raise HTTPException(status_code=503, detail="Gemini rate limit exceeded. Try again.")

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Gemini API error: {r.text}")

    data = r.json()

    try:
        summary = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        summary = str(data)

    return {"summary": summary}
