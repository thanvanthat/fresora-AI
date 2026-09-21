"""FoodKnowledgeService -- the only way the rest of the app reads food facts.

Keeping this behind a service means the LLM prompt builder, the shelf-life
estimator and the storage recommender all read the same curated records, and
none of them can invent storage advice of their own.
"""

from __future__ import annotations

from dataclasses import dataclass

from .food_data import ALL_FOODS, FOOD_INDEX, PANTRY_STAPLES, FoodRecord


@dataclass(frozen=True)
class StorageAdvice:
    headline: str
    details: list[str]
    storage_type: str
    preservation: list[str]


class FoodKnowledgeService:
    """Read-only accessor over the curated food records."""

    def __init__(self, index: dict[str, FoodRecord] | None = None) -> None:
        self._index = index if index is not None else FOOD_INDEX

    # --- Lookup -----------------------------------------------------------

    def get(self, food_name: str) -> FoodRecord | None:
        """Exact (case-insensitive) match on name or alias."""
        return self._index.get(food_name.strip().lower())

    def resolve(self, food_name: str) -> FoodRecord | None:
        """Lenient match: exact, then singular, then substring.

        Substring matching is last and requires the query to be at least 4
        characters, so a short query cannot accidentally match a long name.
        """
        key = food_name.strip().lower()
        if not key:
            return None

        exact = self._index.get(key)
        if exact is not None:
            return exact

        if key.endswith("es") and (singular := self._index.get(key[:-2])):
            return singular
        if key.endswith("s") and (singular := self._index.get(key[:-1])):
            return singular

        if len(key) >= 4:
            for name, record in self._index.items():
                if key in name or name in key:
                    return record
        return None

    def known_names(self) -> list[str]:
        return sorted({record.name for record in ALL_FOODS})

    # --- Facts ------------------------------------------------------------

    def get_storage_advice(self, food_name: str) -> StorageAdvice | None:
        record = self.resolve(food_name)
        if record is None:
            return None
        return StorageAdvice(
            headline=record.storage_headline,
            details=list(record.storage_details),
            storage_type=record.preferred_storage,
            preservation=list(record.preservation),
        )

    def get_typical_shelf_life(
        self, food_name: str, storage: str | None = None
    ) -> tuple[int, int] | None:
        """Typical (min, max) days for the given storage mode.

        Falls back to the food's preferred storage when the requested mode has
        no curated figure, rather than guessing one.
        """
        record = self.resolve(food_name)
        if record is None:
            return None

        mode = storage or record.preferred_storage
        window = record.shelf_life.for_storage(mode)
        if window is None:
            window = record.shelf_life.for_storage(record.preferred_storage)
        return window

    def get_preservation_methods(self, food_name: str) -> list[str]:
        record = self.resolve(food_name)
        return list(record.preservation) if record else []

    def get_nutrition(self, food_name: str) -> str | None:
        record = self.resolve(food_name)
        return record.nutrition if record else None

    def get_recipe_uses(self, food_name: str) -> list[str]:
        record = self.resolve(food_name)
        return list(record.recipe_uses) if record else []

    def is_high_risk(self, food_name: str) -> bool:
        """True for categories where visual assessment is least reliable."""
        record = self.resolve(food_name)
        return record.high_risk if record else False

    def pantry_staples(self) -> list[str]:
        return list(PANTRY_STAPLES)

    # --- Prompt material --------------------------------------------------

    def describe_for_prompt(self, food_name: str) -> str | None:
        """Compact factual block for grounding an LLM request.

        Returns None when the food is unknown, so the caller can tell the model
        it has no curated data instead of letting it fill the gap.
        """
        record = self.resolve(food_name)
        if record is None:
            return None

        lines = [f"Food: {record.name} (category: {record.category})"]

        shelf = record.shelf_life
        windows = [
            (mode, getattr(shelf, mode))
            for mode in ("counter", "pantry", "refrigerated", "frozen")
            if getattr(shelf, mode) is not None
        ]
        if windows:
            rendered = "; ".join(f"{mode}: {lo}-{hi} days" for mode, (lo, hi) in windows)
            lines.append(f"Typical shelf life -- {rendered}")

        lines.append(f"Preferred storage: {record.preferred_storage}")
        lines.append(f"Storage headline: {record.storage_headline}")
        for detail in record.storage_details:
            lines.append(f"  - {detail}")
        if record.preservation:
            lines.append(f"Preservation: {', '.join(record.preservation)}")
        lines.append(f"Nutrition: {record.nutrition}")
        if record.recipe_uses:
            lines.append(f"Common uses: {', '.join(record.recipe_uses)}")
        if record.high_risk:
            lines.append(
                "NOTE: higher-risk category -- visual assessment is least reliable here."
            )
        return "\n".join(lines)


#: Module-level singleton. The data is immutable, so sharing one instance is safe.
knowledge = FoodKnowledgeService()
