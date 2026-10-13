"""Private stateless OCR worker; no document persistence or request-body logging."""
import io
import os
import re
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 3
ALLOWED = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


@lru_cache(maxsize=1)
def model():
    from paddleocr import PaddleOCR
    return PaddleOCR(lang="en", use_doc_orientation_classify=False,
                     use_doc_unwarping=False, use_textline_orientation=False)


@app.get("/health")
def health():
    return {"ok": True, "provider": "paddleocr"}


def images(data: bytes, mime: str):
    if mime == "application/pdf":
        if not data.startswith(b"%PDF-"):
            raise HTTPException(415, "Invalid PDF signature")
        import pypdfium2 as pdfium
        try:
            pdf = pdfium.PdfDocument(data)
            if len(pdf) > MAX_PAGES:
                raise HTTPException(413, "PDF page limit exceeded")
            for page in pdf:
                bitmap = page.render(scale=2.0, rotation=0)
                yield bitmap.to_pil().convert("RGB")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, "Unreadable PDF") from exc
    else:
        signatures = {
            "image/jpeg": data.startswith(b"\\xff\\xd8\\xff"),
            "image/png": data.startswith(b"\\x89PNG\\r\\n\\x1a\\n"),
            "image/webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
        }
        if not signatures.get(mime):
            raise HTTPException(415, "Image signature mismatch")
        try:
            img = Image.open(io.BytesIO(data))
            if img.width * img.height > 25_000_000:
                raise HTTPException(413, "Image resolution limit exceeded")
            yield ImageOps.exif_transpose(img).convert("RGB")
        except UnidentifiedImageError as exc:
            raise HTTPException(422, "Unreadable image") from exc


def ocr_lines(pil_image):
    results = model().predict(np.asarray(pil_image))
    lines = []
    for result in results:
        data = result.json
        if isinstance(data, dict) and isinstance(data.get("res"), dict):
            data = data["res"]
        texts = data.get("rec_texts", []) if isinstance(data, dict) else []
        scores = data.get("rec_scores", []) if isinstance(data, dict) else []
        for i, value in enumerate(texts):
            value = str(value).strip()
            if value:
                score = float(scores[i]) if i < len(scores) else 0.0
                lines.append({"text": value, "confidence": max(0.0, min(1.0, score))})
    return lines


def mrz_check(text):
    weights = (7, 3, 1)
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<"
    return str(sum(alphabet.index(c) * weights[i % 3] for i, c in enumerate(text)) % 10)


def passport_mrz(lines):
    normalized = [re.sub(r"\\s+", "", entry["text"].upper()) for entry in lines]
    firsts = [item for item in normalized if item.startswith("P<") and len(item) >= 35]
    seconds = [item for item in normalized if len(item) >= 43 and re.fullmatch(r"[A-Z0-9<]+", item)]
    for first in firsts:
        for second in seconds:
            if second.startswith("P<"):
                continue
            if not (mrz_check(second[13:19]) == second[19] and mrz_check(second[21:27]) == second[27]):
                continue
            parts = first[5:].split("<<", 1)
            if len(parts) != 2:
                continue
            surname = parts[0].replace("<", " ").strip()
            given = parts[1].replace("<", " ").strip()
            raw_date = second[13:19]
            # Two-digit years cannot be inferred as a four-digit birth year.
            return {"full_name": " ".join(x for x in (given, surname) if x),
                    "_mrz_birth_yymmdd": raw_date}
    return {}


def field_map(lines):
    row = {}
    score = {}
    text_lines = [entry["text"].strip() for entry in lines]
    document_type = "UNKNOWN"
    combined = "\\n".join(text_lines).upper()
    if "PERMANENT RESIDENT" in combined:
        document_type = "GREEN_CARD"
    elif "EMPLOYMENT AUTHORIZATION" in combined:
        document_type = "EAD"
    elif "PASSPORT" in combined or any(t.startswith("P<") for t in text_lines):
        document_type = "PASSPORT"
    elif "DRIVER LICENSE" in combined or "DRIVER'S LICENSE" in combined or "IDENTIFICATION CARD" in combined:
        document_type = "STATE_ID"

    passport = passport_mrz(lines)
    if passport.get("full_name"):
        row["full_name"] = passport["full_name"]
        score["full_name"] = 0.95
    patterns = {
        "full_name": r"^(?:FULL NAME|NAME|CARDHOLDER)\\s*[:#-]\\s*([A-Za-z][A-Za-z .,'-]{2,90})$",
        "date_of_birth": r"^(?:DATE OF BIRTH|BIRTH DATE|DOB|DBB)\\s*[:#-]?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|\\d{4}-\\d{2}-\\d{2})$",
        "street": r"^(?:STREET|ADDRESS)\\s*[:#-]\\s*(.{4,120})$",
        "city": r"^CITY\\s*[:#-]\\s*([A-Za-z .'-]{2,60})$",
        "state": r"^STATE\\s*[:#-]\\s*([A-Z]{2})$",
        "zip": r"^(?:ZIP|POSTAL CODE)\\s*[:#-]\\s*(\\d{5}(?:-\\d{4})?)$",
    }
    for item in lines:
        for key, regex in patterns.items():
            if key in row:
                continue
            match = re.match(regex, item["text"], flags=re.IGNORECASE)
            if match and float(item["confidence"]) >= 0.50:
                row[key] = match.group(1).strip()
                score[key] = item["confidence"]
    return {"row": row, "confidence": score, "document_type": document_type,
            "ocr_text": "\\n".join(text_lines)[:20000]}


@app.post("/extract")
async def extract(file: UploadFile = File(...), authorization: str | None = Header(None)):
    expected = os.environ.get("OCR_SERVICE_TOKEN")
    if not expected or not authorization:
        raise HTTPException(401, "Unauthorized")
    import secrets
    if not secrets.compare_digest(authorization, "Bearer " + expected):
        raise HTTPException(401, "Unauthorized")
    if file.content_type not in ALLOWED:
        raise HTTPException(415, "Unsupported document format")
    data = await file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "Document size limit exceeded")
    extracted = []
    try:
        for img in images(data, file.content_type):
            extracted.extend(ocr_lines(img))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "OCR model unavailable") from exc
    return {"ok": True, **field_map(extracted)}
