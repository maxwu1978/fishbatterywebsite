#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import smtplib
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.mime.text import MIMEText
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SERVER_DIR = Path(__file__).resolve().parent
SITE_ROOT = SERVER_DIR.parent
KNOWLEDGE_BASE_PATH = SERVER_DIR / "knowledge-base.json"
ROUTING_RULES_PATH = SERVER_DIR / "support-routing.json"
INQUIRIES_PATH = SERVER_DIR / "inquiries.json"

MINIMAX_BASE_URL = os.environ.get("MINIMAX_BASE_URL", "https://api.minimaxi.com/v1").rstrip("/")
MINIMAX_MODEL = os.environ.get("MINIMAX_MODEL", "MiniMax-M2.5")
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "").strip()

SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").strip()
NOTIFY_EMAIL = os.environ.get("NOTIFY_EMAIL", "").strip()

MAX_REQUEST_BYTES = 100 * 1024  # 100 KB
RATE_LIMIT_PER_MINUTE = 20

ALLOWED_ORIGINS = {
    "https://maxwu1978.github.io",
    "http://127.0.0.1:8012",
    "http://localhost:8012",
}

EU_COUNTRIES = {
    "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic",
    "czechia", "denmark", "estonia", "finland", "france", "germany", "greece",
    "hungary", "ireland", "italy", "latvia", "lithuania", "luxembourg", "malta",
    "netherlands", "poland", "portugal", "romania", "slovakia", "slovenia",
    "spain", "sweden", "other eu country",
}


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

@dataclass
class _RateBucket:
    timestamps: list[float] = field(default_factory=list)


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int = 60) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._buckets: dict[str, _RateBucket] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.setdefault(key, _RateBucket())
            bucket.timestamps = [t for t in bucket.timestamps if now - t < self._window]
            if len(bucket.timestamps) >= self._max:
                return False
            bucket.timestamps.append(now)
            return True


_rate_limiter = RateLimiter(RATE_LIMIT_PER_MINUTE)


# ---------------------------------------------------------------------------
# Knowledge base
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


KNOWLEDGE_BASE = load_json(KNOWLEDGE_BASE_PATH)
ROUTING_RULES = load_json(ROUTING_RULES_PATH)


def tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9\+\-]{2,}", text.lower()))


def normalize_topic(topic: str) -> str:
    topic = (topic or "").strip().lower()
    topic_map = {
        "compatibility": "compatibility",
        "shipping": "shipping",
        "payment": "payment",
        "included": "included",
        "warranty": "warranty",
    }
    return topic_map.get(topic, "support")


def is_supported_region(country: str) -> bool:
    normalized = (country or "").strip().lower()
    return normalized == "united states" or normalized in EU_COUNTRIES


@dataclass
class SearchHit:
    score: int
    doc: dict[str, Any]


def rank_documents(message: str, topic: str, country: str, brand: str) -> list[SearchHit]:
    search_text = " ".join(
        part for part in [message, topic, country, brand] if part
    )
    terms = tokenize(search_text)
    topic_terms = {
        "compatibility": {"compatibility", "daiwa", "shimano", "connector", "reel"},
        "shipping": {"shipping", "delivery", "country", "destination", "eu", "us"},
        "payment": {"payment", "paypal", "card", "checkout", "price"},
        "included": {"included", "kit", "charger", "cable", "bag", "strap"},
        "warranty": {"warranty", "return", "returns", "support", "coverage"},
        "support": {"support", "contact", "help"},
    }.get(topic, {"support"})
    terms |= topic_terms

    hits: list[SearchHit] = []
    for doc in KNOWLEDGE_BASE["documents"]:
        keywords = set(k.lower() for k in doc.get("keywords", []))
        doc_terms = keywords | tokenize(doc.get("title", "")) | tokenize(doc.get("content", ""))
        score = len(terms & doc_terms) + 2 * len(terms & keywords)
        if topic in doc.get("id", ""):
            score += 2
        if score > 0:
            hits.append(SearchHit(score=score, doc=doc))

    hits.sort(key=lambda item: item.score, reverse=True)
    return hits[:3]


def recommend_handoff(message: str, topic: str, country: str, brand: str, hits: list[SearchHit]) -> tuple[bool, str | None]:
    lowered = message.lower()
    specific_model_hint = bool(re.search(r"[a-z]+\s?\d{3,}", lowered))

    if not is_supported_region(country):
        return False, "Sales are currently limited to the United States and EU countries."

    human_words = ["human", "agent", "real person", "staff", "support rep", "live chat"]
    if any(word in lowered for word in human_words):
        return True, "You asked for a human agent."

    urgent_words = ["refund", "return", "damaged", "broken", "chargeback", "charged twice", "payment failed"]
    if any(word in lowered for word in urgent_words):
        return True, "This looks like an order, payment, or after-sales issue."

    if topic == "compatibility" and (
        brand == "Other Electric Reel"
        or specific_model_hint
        or any(word in lowered for word in ["connector", "voltage", "adapter", "fit", "model"])
    ):
        return True, "Exact compatibility may need manual confirmation."

    if len(hits) == 0 or hits[0].score < 3:
        return True, "The knowledge base match is weak."

    return False, None


def build_answer(message: str, topic: str, country: str, brand: str, note: str, hits: list[SearchHit], handoff: bool, handoff_reason: str | None) -> dict[str, Any]:
    intro_map = {
        "compatibility": f"For {brand} setups",
        "shipping": f"For delivery to {country}",
        "payment": f"For checkout in {country}",
        "included": "For the full Reel Mate kit",
        "warranty": "For warranty and after-sales support",
        "support": "Based on the current support information",
    }
    intro = intro_map.get(topic, "Based on the current support information")

    if not is_supported_region(country):
        answer = (
            "Sales are currently limited to the United States and EU countries only. "
            "Checkout is not available for unsupported regions at this stage."
        )
        return {
            "answer": answer,
            "source_hits": [],
            "handoff_recommended": False,
            "handoff_reason": handoff_reason,
        }

    if hits:
        content = " ".join(hit.doc["content"] for hit in hits[:2])
        answer = f"{intro}, here is the most relevant guidance: {content}"
    else:
        answer = (
            "I do not have a strong document match for that question yet. "
            "Please use human support so the team can review your request directly."
        )

    if note:
        answer += f" Your note was: {note}."

    if handoff:
        answer += " I recommend switching to human support for confirmation."

    return {
        "answer": answer,
        "source_hits": [hit.doc["source"] for hit in hits],
        "handoff_recommended": handoff,
        "handoff_reason": handoff_reason,
    }


def build_minimax_messages(message: str, topic: str, country: str, brand: str, note: str, hits: list[SearchHit], handoff: bool, handoff_reason: str | None) -> list[dict[str, str]]:
    context_lines = []
    for hit in hits:
        doc = hit.doc
        context_lines.append(
            f"- Source: {doc['source']} | Title: {doc['title']} | Content: {doc['content']}"
        )

    routing_lines = [f"- {rule['trigger']} => {rule['action']}" for rule in ROUTING_RULES["handoff_rules"]]
    response_rules = "\n".join(f"- {rule}" for rule in ROUTING_RULES["response_rules"])
    context_block = "\n".join(context_lines) if context_lines else "- No strong knowledge-base matches found."
    routing_block = "\n".join(routing_lines)

    system_prompt = (
        "You are Reel Mate AI Support for a premium offshore electric reel battery brand.\n"
        "Answer using only the supplied knowledge-base context.\n"
        "Do not invent shipping regions, payment methods, compatibility approvals, or policies.\n"
        "Treat the United States and EU countries as supported sales regions. Spain is an EU country and is supported.\n"
        "Never say that an EU country is unsupported.\n"
        "For exact reel model questions, do not claim confirmed compatibility unless the context explicitly confirms that exact model.\n"
        "If information is uncertain, say so clearly and recommend human support.\n"
        "Keep the answer concise, retail-friendly, and direct.\n"
        f"Response rules:\n{response_rules}\n"
        f"Handoff rules:\n{routing_block}\n"
    )

    user_prompt = (
        f"Customer question: {message}\n"
        f"Topic: {topic}\n"
        f"Country: {country}\n"
        f"Brand: {brand}\n"
        f"Note: {note or 'None'}\n"
        f"Current handoff recommendation: {'yes' if handoff else 'no'}\n"
        f"Handoff reason: {handoff_reason or 'None'}\n"
        f"Knowledge-base context:\n{context_block}\n\n"
        "Answer in plain English.\n"
        "Keep it under 120 words.\n"
        "If human handoff is recommended, end with exactly one short sentence suggesting human support."
    )

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def extract_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text_parts.append(str(part.get("text", "")))
        return "\n".join(part for part in text_parts if part).strip()
    return ""


def clean_model_output(text: str) -> str:
    text = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)  # strip any remaining HTML tags
    return text.strip()


def call_minimax(messages: list[dict[str, str]]) -> str | None:
    if not MINIMAX_API_KEY:
        return None

    payload = {
        "model": MINIMAX_MODEL,
        "messages": messages,
        "temperature": 0.2,
    }
    request = urllib.request.Request(
        f"{MINIMAX_BASE_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MINIMAX_API_KEY}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None

    choices = raw.get("choices") or []
    if not choices:
        return None

    message = choices[0].get("message", {})
    content = extract_message_content(message.get("content"))
    cleaned = clean_model_output(content)
    return cleaned or None


def compose_support_result(message: str, topic: str, country: str, brand: str, note: str) -> dict[str, Any]:
    hits = rank_documents(message, topic, country, brand)
    handoff, handoff_reason = recommend_handoff(message, topic, country, brand, hits)
    base_result = build_answer(message, topic, country, brand, note, hits, handoff, handoff_reason)

    minimax_messages = build_minimax_messages(message, topic, country, brand, note, hits, handoff, handoff_reason)
    minimax_answer = call_minimax(minimax_messages)
    if minimax_answer:
        base_result["answer"] = minimax_answer
        base_result["model_used"] = MINIMAX_MODEL
    else:
        base_result["model_used"] = "knowledge-base-fallback"

    if handoff and "human support" not in base_result["answer"].lower():
        base_result["answer"] = base_result["answer"].rstrip() + " Please contact human support for confirmation."

    return base_result


# ---------------------------------------------------------------------------
# Inquiry processing (AI analyse → store → email)
# ---------------------------------------------------------------------------

def _build_inquiry_analysis_prompt(data: dict[str, str]) -> list[dict[str, str]]:
    system = (
        "You are Reel Mate's inquiry analyst. Given a customer inquiry, produce a brief JSON analysis with these fields:\n"
        '  "category": one of "product", "wholesale", "compatibility", "shipping", "spam", "other"\n'
        '  "priority": one of "high", "normal", "low"\n'
        '  "summary": one-sentence summary in English\n'
        '  "is_spam": true/false\n'
        "Return ONLY valid JSON, no markdown fences."
    )
    user = (
        f"Name: {data.get('name', '')}\n"
        f"Company: {data.get('company', '')}\n"
        f"Country: {data.get('country', '')}\n"
        f"Topic: {data.get('topic', '')}\n"
        f"Reel: {data.get('reelModel', '')}\n"
        f"Message: {data.get('message', '')}\n"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def analyse_inquiry(data: dict[str, str]) -> dict[str, Any]:
    messages = _build_inquiry_analysis_prompt(data)
    raw = call_minimax(messages)
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
    return {"category": "other", "priority": "normal", "summary": data.get("message", "")[:120], "is_spam": False}


def store_inquiry(entry: dict[str, Any]) -> None:
    lock = threading.Lock()
    with lock:
        existing: list[dict[str, Any]] = []
        if INQUIRIES_PATH.exists():
            try:
                existing = json.loads(INQUIRIES_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, ValueError):
                existing = []
        existing.append(entry)
        INQUIRIES_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def send_notification_email(entry: dict[str, Any]) -> None:
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL]):
        return

    analysis = entry.get("ai_analysis", {})
    subject = f"[Reel Mate Inquiry] {analysis.get('category', 'new').upper()} — {analysis.get('summary', 'New inquiry')[:60]}"
    body_lines = [
        f"Priority: {analysis.get('priority', 'normal')}",
        f"Category: {analysis.get('category', 'unknown')}",
        f"Spam: {'Yes' if analysis.get('is_spam') else 'No'}",
        f"AI Summary: {analysis.get('summary', 'N/A')}",
        "",
        "--- Original Inquiry ---",
        f"Name: {entry.get('name', '')}",
        f"Company: {entry.get('company', '')}",
        f"Country: {entry.get('country', '')}",
        f"Topic: {entry.get('topic', '')}",
        f"Reel Model: {entry.get('reelModel', '')}",
        f"Message: {entry.get('message', '')}",
        "",
        f"Received: {entry.get('received_at', '')}",
    ]
    body = "\n".join(body_lines)

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = NOTIFY_EMAIL

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    except Exception:
        pass  # email is best-effort; inquiry is already stored


def handle_inquiry(payload: dict[str, Any]) -> dict[str, Any]:
    data = {
        "name": str(payload.get("name", "")).strip()[:200],
        "company": str(payload.get("company", "")).strip()[:200],
        "country": str(payload.get("country", "")).strip()[:100],
        "topic": str(payload.get("topic", "")).strip()[:100],
        "reelModel": str(payload.get("reelModel", "")).strip()[:200],
        "message": str(payload.get("message", "")).strip()[:2000],
    }

    if not data["name"] or not data["message"]:
        return {"error": "name and message are required"}

    analysis = analyse_inquiry(data)

    entry = {
        **data,
        "ai_analysis": analysis,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    store_inquiry(entry)

    # Send email in background to not block the response
    threading.Thread(target=send_notification_email, args=(entry,), daemon=True).start()

    return {"success": True, "category": analysis.get("category", "other")}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class SupportHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(SITE_ROOT), **kwargs)

    def _client_ip(self) -> str:
        return self.client_address[0]

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def end_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def _read_json_body(self) -> dict[str, Any] | None:
        """Read and parse JSON body with size limit. Returns None on failure (error already sent)."""
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > MAX_REQUEST_BYTES:
            self.end_json({"error": "Request body too large"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return None

        if not _rate_limiter.allow(self._client_ip()):
            self.end_json({"error": "Too many requests, please wait"}, HTTPStatus.TOO_MANY_REQUESTS)
            return None

        try:
            raw = self.rfile.read(content_length)
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self.end_json({"error": "Invalid JSON body"}, HTTPStatus.BAD_REQUEST)
            return None

    def do_POST(self) -> None:
        if self.path == "/api/chat":
            self._handle_chat()
        elif self.path == "/api/inquiry":
            self._handle_inquiry()
        else:
            self.end_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def _handle_chat(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return

        message = str(payload.get("message", "")).strip()
        topic = normalize_topic(str(payload.get("topic", "")))
        country = str(payload.get("country", "")).strip() or "United States"
        brand = str(payload.get("brand", "")).strip() or "SHIMANO"
        note = str(payload.get("note", "")).strip()

        if not message:
            self.end_json({"error": "message is required"}, HTTPStatus.BAD_REQUEST)
            return

        result = compose_support_result(message, topic, country, brand, note)
        self.end_json(result)

    def _handle_inquiry(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return

        result = handle_inquiry(payload)
        if "error" in result:
            self.end_json(result, HTTPStatus.BAD_REQUEST)
        else:
            self.end_json(result)


def main() -> None:
    host = "127.0.0.1"
    port = 8012
    server = ThreadingHTTPServer((host, port), SupportHandler)
    print(f"Serving Reel Mate support site on http://{host}:{port}")
    if MINIMAX_API_KEY:
        print("  MiniMax AI enabled")
    else:
        print("  MiniMax AI disabled (set MINIMAX_API_KEY to enable)")
    if all([SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL]):
        print(f"  Email notifications → {NOTIFY_EMAIL}")
    else:
        print("  Email notifications disabled (set SMTP_HOST/SMTP_USER/SMTP_PASS/NOTIFY_EMAIL)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
