"""
AI features - action detection & task decomposition.

Both flows are *hints*, not gates. If the AI engine isn't configured or a
call fails, they degrade silently (empty actions / needed:false) rather than
surfacing an error - the underlying entry/to-do is always created regardless.

All AI calls route through the pluggable provider (ai_provider.get_provider),
so whatever the user picked in Settings → AI Engine (Claude / Groq / Gemini /
Ollama / custom) is what runs here.

Routes (mounted under /api in main.py → /api/ai/...):
  POST  /ai/detect-actions          - scan an Update entry for action vocabulary
  POST  /ai/decompose-task          - assess a to-do, suggest a breakdown
  PATCH /ai/dismiss-decomp/{id}     - mark a to-do's decomposition dismissed
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from ai_provider import get_provider

log = logging.getLogger("effro.ai_features")
router = APIRouter(tags=["ai-features"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class DetectActionsRequest(BaseModel):
    text: str
    entry_id: int


class ActionItem(BaseModel):
    phrase: str          # original fragment that triggered detection
    todo_title: str      # clean, verb-led suggested to-do title


class DetectActionsResponse(BaseModel):
    actions: list[ActionItem]


class DecomposeTaskRequest(BaseModel):
    entry_id: int
    task_title: str
    task_content: Optional[str] = None


class SubtaskSuggestion(BaseModel):
    title: str
    time_estimate_minutes: int


class DecomposeTaskResponse(BaseModel):
    needed: bool
    reason: str          # complex | atomic | too_vague
    subtasks: list[SubtaskSuggestion]


# ── Action detection ──────────────────────────────────────────────────────────

ACTION_DETECTION_SYSTEM = """
You scan work log entries for action items that should become to-do tasks.

Look for phrases that clearly indicate something needs to be done:
- Direct intent: "need to", "should", "must", "have to", "going to"
- Follow-up signals: "follow up", "check on", "chase", "remind", "circle back"
- Scheduled actions: "send", "email", "call", "book", "arrange", "schedule", "share"
- Pending work: "review", "look into", "investigate", "draft", "prepare", "update"

Rules:
- Only flag genuine action items - not observations, facts, or completed work
- Extract the minimal phrase from the text that captures the action intent
- Suggest a clean, actionable to-do title that starts with a verb
- Be conservative - it is better to return 0 results than to invent false positives
- Maximum 3 suggestions per entry
- If the entry is already a to-do or the text has no clear actions, return an empty list

Return valid JSON only, no preamble, no markdown fences:
{"actions": [{"phrase": "text fragment", "todo_title": "Verb-led clean title"}]}
""".strip()


@router.post("/ai/detect-actions", response_model=DetectActionsResponse)
def detect_actions(req: DetectActionsRequest, db: Session = Depends(get_db)):
    """
    Scan an Update entry for embedded action vocabulary. Returns 0–3 suggested
    to-do titles. Fails silently (empty list) when AI is unconfigured/unreachable.
    """
    if not req.text or len(req.text.strip()) < 10:
        return DetectActionsResponse(actions=[])

    provider = get_provider(db)
    try:
        text = provider.complete(
            system=ACTION_DETECTION_SYSTEM,
            messages=[{"role": "user", "content": req.text}],
            max_tokens=400,
        )
        data = json.loads(_strip_fences(text))
        actions = [ActionItem(**a) for a in data.get("actions", [])][:3]
        return DetectActionsResponse(actions=actions)
    except Exception as e:
        # Hint feature - never surface an error to the user.
        log.info("detect-actions skipped: %s", e)
        return DetectActionsResponse(actions=[])


# ── Task decomposition ────────────────────────────────────────────────────────

DECOMPOSE_SYSTEM = """
You are an ADHD-aware task coach. Your job is to assess whether a to-do task
needs breaking into subtasks, and if so, suggest an actionable breakdown.

WHEN TO DECOMPOSE:
- The task involves multiple distinct steps, people, or resources
- The task is ambiguous about where to start
- Completing it requires switching contexts or tools
- It would take more than ~90 minutes without a clear sequence

WHEN NOT TO DECOMPOSE (return needed: false):
- The task is already a single clear action: "Email Sarah the contract", "Call James"
- The task is a simple lookup or check: "Check if X is done"
- The task is too vague to decompose meaningfully - flag as too_vague instead

SUBTASK RULES:
- Each subtask must start with an action verb (Write, Find, Send, Book, Review...)
- Each subtask must be completable in one sitting
- Minimum 2 subtasks, maximum 5 subtasks
- Time estimates: 15, 20, 30, 45, 60, 90, or 120 minutes only
- Keep titles short: under 8 words
- Order subtasks logically - prerequisites first

Return valid JSON only, no preamble, no markdown fences:
{
  "needed": true,
  "reason": "complex",
  "subtasks": [
    {"title": "Verb-led title", "time_estimate_minutes": 30}
  ]
}

For atomic tasks:
{"needed": false, "reason": "atomic", "subtasks": []}

For vague tasks:
{"needed": false, "reason": "too_vague", "subtasks": []}
""".strip()


@router.post("/ai/decompose-task", response_model=DecomposeTaskResponse)
def decompose_task(req: DecomposeTaskRequest, db: Session = Depends(get_db)):
    """
    Assess a to-do and optionally suggest a subtask breakdown. Returns
    {needed: false} for atomic/vague tasks (no drawer shown). Fails silently.
    """
    if not req.task_title or len(req.task_title.strip()) < 3:
        return DecomposeTaskResponse(needed=False, reason="atomic", subtasks=[])

    content = req.task_title
    if req.task_content:
        content += f"\n\nAdditional context: {req.task_content}"

    provider = get_provider(db)
    try:
        text = provider.complete(
            system=DECOMPOSE_SYSTEM,
            messages=[{"role": "user", "content": content}],
            max_tokens=600,
        )
        data = json.loads(_strip_fences(text))
        subtasks = [SubtaskSuggestion(**s) for s in data.get("subtasks", [])]
        return DecomposeTaskResponse(
            needed=bool(data.get("needed", False)),
            reason=data.get("reason", "atomic"),
            subtasks=subtasks,
        )
    except Exception as e:
        log.info("decompose-task skipped: %s", e)
        return DecomposeTaskResponse(needed=False, reason="atomic", subtasks=[])


# ── Dismiss decomposition ─────────────────────────────────────────────────────

@router.patch("/ai/dismiss-decomp/{entry_id}")
def dismiss_decomp(entry_id: int, db: Session = Depends(get_db)):
    """
    Mark a to-do's decomposition as dismissed - switches the card from the
    auto-drawer flow to the persistent "Break this down" affordance.
    """
    entry = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.decomp_dismissed = True
    db.commit()
    return {"ok": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    """
    Some providers wrap JSON in ```json fences despite the instruction not to.
    Strip them defensively so json.loads doesn't choke.
    """
    t = (text or "").strip()
    if t.startswith("```"):
        # drop the first line (``` or ```json) and any trailing fence
        lines = t.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines).strip()
    return t
