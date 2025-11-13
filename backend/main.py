from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import os, requests
from dotenv import load_dotenv
from typing import Optional

load_dotenv()

OPENAI_KEY = os.getenv("OPENAI_API_KEY")
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY")

if not OPENAI_KEY or not FLASK_SECRET_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY or FLASK_SECRET_KEY in environment")

app = FastAPI(title="Gmail Add-on Summarizer")

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
        "Otherwise, write a short paragraph. Also include a 1-line suggested reply."
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
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.split(" ", 1)[1].strip()
    verify_google_access_token(token)

    prompt = build_prompt(req)

    headers = {
        "Authorization": f"Bearer {OPENAI_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are a concise email summarizer."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 400,
        "temperature": 0.2,
    }

    r = requests.post(
        "https://api.openai.com/v1/chat/completions",
        json=payload,
        headers=headers,
        timeout=30
    )

    if r.status_code == 429:
        raise HTTPException(status_code=503, detail="OpenAI rate limit exceeded. Try again.")

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {r.text}")

    data = r.json()
    assistant_msg = data["choices"][0]["message"]["content"]

    return {"summary": assistant_msg}
