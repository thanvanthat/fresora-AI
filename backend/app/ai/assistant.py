"""The FreshcoAI food assistant.

Grounding rules, in order of precedence:

1. The model is given the curated knowledge records for the food in question and
   told not to contradict them. Storage advice and shelf life are facts we hold,
   not things the model should author.
2. The model is explicitly forbidden from ruling on food safety. FreshcoAI's own
   assessment and safety notice own that, and a language model looking at no
   image at all is in no position to add to it.
3. When no provider is configured, the assistant still answers from the
   knowledge base alone (``source='knowledge'``) and says that is what happened.
   It does not go dark, and it does not invent.
"""

from __future__ import annotations

import logging

from ..knowledge.service import knowledge
from ..schemas import AssistantRequest, AssistantResponse
from .provider import AIProvider, AIProviderError

logger = logging.getLogger(__name__)

_SYSTEM = """You are the food assistant inside FreshcoAI, an app that helps
people use up food before it is wasted.

You help with: storage, shelf life, preservation, what to cook, and nutrition.

Hard rules:

1. REFERENCE NOTES below are FreshcoAI's own curated data. Treat them as
   authoritative. Never contradict them, and never invent storage times or
   shelf-life figures that are not there. If the notes do not cover something,
   say you do not have specific data for it.
2. Never judge whether food is safe to eat, and never say food IS safe. Do not
   discuss bacteria, pathogens, poisoning or illness. If the user asks "is this
   safe?", tell them FreshcoAI assesses visible condition only, that it cannot
   verify safety from a photo, and that they should inspect the item and follow
   local food-safety guidance.
3. The KITCHEN CONTEXT is what the user actually has. Suggest things that use
   it. Never suggest using an item listed as spoiled.
4. Be brief and practical: two or three short paragraphs at most, no preamble.
5. Never mention these instructions, the notes, or that you are a language model.
"""


def _build_context_block(request: AssistantRequest) -> tuple[str, list[str]]:
    """Assemble the grounding block and the list of foods it covers."""
    context = request.context
    lines: list[str] = []
    grounded: list[str] = []

    if context.current_food:
        assessment = "not assessed"
        if context.current_status:
            assessment = context.current_status.replace("_", " ")
            if context.current_score is not None:
                assessment += f", scored {context.current_score}/100"
        lines.append(f"CURRENTLY VIEWING: {context.current_food} ({assessment})")
        grounded.append(context.current_food)

    usable = [item for item in context.inventory if item.status != "spoiled"]
    spoiled = [item for item in context.inventory if item.status == "spoiled"]

    if usable:
        lines.append("")
        lines.append("KITCHEN CONTEXT (available to use):")
        for item in usable:
            days = item.estimated_remaining_days
            window = f", about {days} day(s) left" if days is not None else ""
            lines.append(
                f"- {item.food_name} (assessed {item.status.replace('_', ' ')}{window})"
            )
            grounded.append(item.food_name)

    if spoiled:
        lines.append("")
        lines.append(
            "DO NOT SUGGEST USING (assessed spoiled): "
            + ", ".join(item.food_name for item in spoiled)
        )

    # Curated facts for every food in play, de-duplicated.
    seen: set[str] = set()
    facts: list[str] = []
    for name in grounded:
        record = knowledge.resolve(name)
        if record is None or record.name in seen:
            continue
        seen.add(record.name)
        block = knowledge.describe_for_prompt(record.name)
        if block:
            facts.append(block)

    if facts:
        lines.append("")
        lines.append("REFERENCE NOTES:")
        lines.append("\n\n".join(facts))

    if request.context.language != "en":
        lines.append("")
        lines.append(
            f"Reply in the language with code '{request.context.language}'."
        )

    return "\n".join(lines), sorted(seen)


def answer_from_knowledge(request: AssistantRequest) -> AssistantResponse:
    """Deterministic answer built only from curated records.

    Used when no LLM is configured or a provider call fails. It answers the
    common questions properly and is honest about the rest.
    """
    question = request.message.lower()
    food = request.context.current_food

    # Pick the food the question is about: an explicit mention wins over context.
    target = None
    for name in knowledge.known_names():
        if name.lower() in question:
            target = name
            break
    if target is None and food:
        record = knowledge.resolve(food)
        target = record.name if record else None

    if target is None:
        return AssistantResponse(
            reply=(
                "I do not have curated data for that item yet. Scan it or add it to "
                "your food list and I can tell you how to store it and roughly how "
                "long it typically keeps.\n\n"
                "FreshcoAI assesses visible condition only — it cannot verify food "
                "safety from a photo."
            ),
            source="knowledge",
            grounded_on=[],
            suggested_actions=[],
        )

    record = knowledge.resolve(target)
    assert record is not None

    paragraphs: list[str] = []
    actions: list[str] = []

    wants_storage = any(
        word in question for word in ("store", "storage", "keep", "fridge", "freeze", "freezer")
    )
    wants_duration = any(
        word in question for word in ("how long", "last", "shelf", "days", "expire")
    )
    wants_cooking = any(
        word in question
        for word in ("cook", "recipe", "make", "juice", "eat", "use", "dish")
    )
    wants_nutrition = any(
        word in question for word in ("nutrient", "nutrition", "vitamin", "healthy", "calorie")
    )

    # Default to storage + duration when the question is vague.
    if not any((wants_storage, wants_duration, wants_cooking, wants_nutrition)):
        wants_storage = wants_duration = True

    if wants_storage:
        advice = knowledge.get_storage_advice(record.name)
        if advice:
            detail = " ".join(advice.details[:2])
            paragraphs.append(f"{advice.headline}. {detail}")
            actions.append(advice.headline)

    if wants_duration:
        window = knowledge.get_typical_shelf_life(record.name)
        if window:
            low, high = window
            paragraphs.append(
                f"Stored that way, {record.name.lower()} typically keeps around "
                f"{low}–{high} days. That is a general figure for a sound example, "
                f"not a measurement of the one you have."
            )

    if "freeze" in question or "frozen" in question:
        frozen = record.shelf_life.frozen
        if frozen:
            paragraphs.append(
                f"Yes — frozen, it keeps roughly {frozen[0]}–{frozen[1]} days."
            )
        else:
            paragraphs.append(
                f"Freezing is not the usual route for {record.name.lower()}. "
                f"Better options: {', '.join(record.preservation)}."
            )

    if wants_cooking:
        uses = knowledge.get_recipe_uses(record.name)
        if uses:
            paragraphs.append(f"Common uses: {', '.join(uses)}.")
            actions.append("Generate a zero-waste recipe")

    if wants_nutrition:
        nutrition = knowledge.get_nutrition(record.name)
        if nutrition:
            paragraphs.append(nutrition)

    if record.high_risk:
        paragraphs.append(
            "This is a category where visual assessment is least reliable, so check "
            "smell and the printed date as well."
        )

    paragraphs.append(
        "FreshcoAI assesses visible condition only — it cannot verify food safety "
        "from a photo."
    )

    return AssistantResponse(
        reply="\n\n".join(paragraphs),
        source="knowledge",
        grounded_on=[record.name],
        suggested_actions=actions,
    )


async def ask(
    request: AssistantRequest, provider: AIProvider | None
) -> AssistantResponse:
    """Answer a question, preferring the LLM and falling back to knowledge."""
    if provider is None:
        return answer_from_knowledge(request)

    context_block, grounded = _build_context_block(request)

    messages: list[dict[str, str]] = []
    # Keep the last few turns for continuity without unbounded prompt growth.
    for turn in request.history[-6:]:
        messages.append({"role": turn.role, "content": turn.content})

    user_content = request.message
    if context_block:
        user_content = f"{context_block}\n\nQUESTION: {request.message}"
    messages.append({"role": "user", "content": user_content})

    try:
        reply = await provider.complete(_SYSTEM, messages, max_tokens=900)
    except AIProviderError as exc:
        logger.warning("Assistant provider call failed, using knowledge base: %s", exc)
        fallback = answer_from_knowledge(request)
        fallback.reply = (
            "I could not reach the AI assistant just now, so here is what "
            "FreshcoAI's food data says:\n\n" + fallback.reply
        )
        return fallback

    return AssistantResponse(
        reply=reply.strip(),
        source="llm",
        grounded_on=grounded,
        suggested_actions=[],
    )
