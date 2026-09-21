"""Structured food reference data.

This is deliberately hand-curated, not model-generated. Storage advice, typical
shelf life and preservation methods are the kind of thing a language model will
happily invent, so Fresora keeps them as data and lets the LLM *synthesise
from* these records rather than author them (see app/ai/assistant.py).

Shelf-life figures are typical domestic ranges for the storage mode named, drawn
from general consumer food-storage guidance. They are starting estimates for a
visually-assessed item, not regulatory limits, and they are always surfaced to
the user as an estimated window.

`healthy_hue` is the OpenCV input that matters: the hue band (OpenCV HSV, so
0-179) a sound example of this food occupies. The discoloration metric measures
drift away from it. `browning_penalty` scales how much visible browning should
count against the score -- high for a cut apple or leafy green where browning
means deterioration, low for a banana where it largely means ripening.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ShelfLife:
    """Typical days of usable life, by storage mode."""

    counter: tuple[int, int] | None = None
    pantry: tuple[int, int] | None = None
    refrigerated: tuple[int, int] | None = None
    frozen: tuple[int, int] | None = None

    def for_storage(self, storage: str) -> tuple[int, int] | None:
        return getattr(self, storage, None)


@dataclass(frozen=True)
class FoodRecord:
    name: str
    category: str
    shelf_life: ShelfLife
    preferred_storage: str
    storage_headline: str
    storage_details: list[str]
    preservation: list[str]
    nutrition: str
    recipe_uses: list[str]
    #: OpenCV HSV hue band (0-179) of a sound example. None for foods with no
    #: meaningful single hue (bread, milk), which skips the discoloration term.
    healthy_hue: tuple[int, int] | None = None
    #: 0..1 multiplier on the browning term of the freshness formula.
    browning_penalty: float = 1.0
    #: Foods where softening is the dominant spoilage cue.
    texture_sensitive: bool = True
    #: Extra caution shown for higher-risk categories.
    high_risk: bool = False
    aliases: list[str] = field(default_factory=list)


# --- Fruit ----------------------------------------------------------------

_FRUIT: list[FoodRecord] = [
    FoodRecord(
        name="Apple",
        category="fruit",
        shelf_life=ShelfLife(counter=(5, 7), refrigerated=(21, 42)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate in the crisper drawer",
        storage_details=[
            "Keep apples in the fridge crisper to slow softening.",
            "Store away from leafy greens, as apples release ethylene.",
        ],
        preservation=["Slice and freeze for baking", "Cook down into apple sauce"],
        nutrition="A source of dietary fibre and vitamin C.",
        recipe_uses=["Salad", "Apple sauce", "Baked apple", "Smoothie"],
        healthy_hue=(0, 20),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Banana",
        category="fruit",
        shelf_life=ShelfLife(counter=(2, 5), refrigerated=(5, 8), frozen=(60, 90)),
        preferred_storage="counter",
        storage_headline="Keep on the counter, out of direct sunlight",
        storage_details=[
            "Store at room temperature until the skin reaches the ripeness you want.",
            "Separating the bunch slows ripening slightly.",
            "Refrigeration darkens the skin but keeps the flesh usable for longer.",
        ],
        preservation=["Peel and freeze for smoothies", "Mash into banana bread batter"],
        nutrition="A source of potassium, vitamin B6 and quick carbohydrate.",
        recipe_uses=["Smoothie", "Banana bread", "Pancakes", "Oatmeal topping"],
        healthy_hue=(20, 35),
        # Browning skin on a banana is mostly ripening, not spoilage.
        browning_penalty=0.45,
    ),
    FoodRecord(
        name="Orange",
        category="fruit",
        shelf_life=ShelfLife(counter=(7, 10), refrigerated=(21, 30)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate loose, not sealed in plastic",
        storage_details=[
            "Keep in the fridge in an open bag or loose in the drawer.",
            "Trapped moisture on the peel encourages mould.",
        ],
        preservation=["Juice and freeze", "Zest and dry the peel"],
        nutrition="High in vitamin C, with fibre in the segments.",
        recipe_uses=["Juice", "Salad", "Marmalade", "Dressing"],
        healthy_hue=(5, 25),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Mango",
        category="fruit",
        shelf_life=ShelfLife(counter=(2, 5), refrigerated=(5, 8), frozen=(150, 180)),
        preferred_storage="counter",
        storage_headline="Ripen on the counter, then refrigerate",
        storage_details=[
            "Leave at room temperature until it yields slightly to a gentle press.",
            "Once ripe, refrigeration buys a few more days.",
        ],
        preservation=["Cube and freeze", "Cook into chutney"],
        nutrition="A source of vitamin A and vitamin C.",
        recipe_uses=["Smoothie", "Salsa", "Chutney", "Lassi"],
        healthy_hue=(10, 32),
        browning_penalty=0.7,
    ),
    FoodRecord(
        name="Guava",
        category="fruit",
        shelf_life=ShelfLife(counter=(2, 4), refrigerated=(5, 8)),
        preferred_storage="counter",
        storage_headline="Ripen on the counter, then chill",
        storage_details=[
            "Keep at room temperature until fragrant and slightly soft.",
            "Refrigerate once ripe to slow further softening.",
        ],
        preservation=["Cook into jam", "Blend and freeze as pulp"],
        nutrition="Notably high in vitamin C and dietary fibre.",
        recipe_uses=["Juice", "Jam", "Fruit salad"],
        healthy_hue=(25, 45),
        browning_penalty=0.8,
    ),
    FoodRecord(
        name="Pear",
        category="fruit",
        shelf_life=ShelfLife(counter=(3, 5), refrigerated=(10, 14)),
        preferred_storage="refrigerated",
        storage_headline="Chill once it gives at the neck",
        storage_details=[
            "Pears ripen from the inside out; check the neck, not the belly.",
            "Refrigerate as soon as the neck yields to slow it down.",
        ],
        preservation=["Poach and refrigerate", "Slice and freeze"],
        nutrition="A source of dietary fibre and vitamin C.",
        recipe_uses=["Salad", "Poached pear", "Crumble"],
        healthy_hue=(25, 45),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Strawberry",
        category="fruit",
        shelf_life=ShelfLife(refrigerated=(3, 7), frozen=(180, 240)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate dry and unwashed",
        storage_details=[
            "Wash only just before eating; surface moisture accelerates mould.",
            "Line the container with paper and leave the lid slightly open.",
            "Remove any single mouldy berry immediately.",
        ],
        preservation=["Freeze whole on a tray", "Cook into a quick compote"],
        nutrition="High in vitamin C, with manganese and fibre.",
        recipe_uses=["Smoothie", "Compote", "Salad", "Dessert topping"],
        healthy_hue=(0, 12),
        browning_penalty=1.2,
    ),
    FoodRecord(
        name="Avocado",
        category="fruit",
        shelf_life=ShelfLife(counter=(2, 4), refrigerated=(4, 7)),
        preferred_storage="counter",
        storage_headline="Ripen on the counter, refrigerate when soft",
        storage_details=[
            "Leave at room temperature until it yields to gentle pressure.",
            "Refrigerate once ripe to hold it for a few more days.",
            "Cut surfaces brown quickly; press cling film against the flesh.",
        ],
        preservation=["Mash with lime juice and freeze", "Make guacamole"],
        nutrition="High in monounsaturated fat, potassium and folate.",
        recipe_uses=["Toast", "Guacamole", "Salad", "Smoothie"],
        healthy_hue=(35, 75),
        browning_penalty=1.3,
    ),
    FoodRecord(
        name="Grapes",
        category="fruit",
        shelf_life=ShelfLife(refrigerated=(7, 14), frozen=(90, 120)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate unwashed on the stem",
        storage_details=[
            "Keep on the stem in a perforated bag in the fridge.",
            "Wash just before serving.",
        ],
        preservation=["Freeze whole as a snack", "Roast for sauces"],
        nutrition="A source of vitamin K and antioxidants.",
        recipe_uses=["Snack", "Salad", "Roasted with chicken"],
        healthy_hue=(35, 90),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Pineapple",
        category="fruit",
        shelf_life=ShelfLife(counter=(2, 3), refrigerated=(5, 7), frozen=(150, 180)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate once cut",
        storage_details=[
            "Whole pineapple keeps a couple of days at room temperature.",
            "Once cut, store the flesh in a sealed container in the fridge.",
        ],
        preservation=["Freeze chunks", "Grill and refrigerate"],
        nutrition="High in vitamin C and manganese.",
        recipe_uses=["Juice", "Salsa", "Grilled pineapple", "Curry"],
        healthy_hue=(18, 38),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Lemon",
        category="fruit",
        shelf_life=ShelfLife(counter=(7, 10), refrigerated=(21, 30)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate in a sealed bag",
        storage_details=[
            "A sealed bag in the fridge keeps lemons juicy far longer than the counter.",
        ],
        preservation=["Freeze juice in ice cube trays", "Preserve in salt"],
        nutrition="High in vitamin C.",
        recipe_uses=["Dressing", "Marinade", "Lemonade", "Baking"],
        healthy_hue=(20, 35),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Pomegranate",
        category="fruit",
        shelf_life=ShelfLife(counter=(5, 7), refrigerated=(21, 60)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate whole",
        storage_details=[
            "Whole fruit keeps for weeks in the fridge.",
            "Loose seeds keep about 3 days refrigerated.",
        ],
        preservation=["Freeze the seeds", "Reduce juice into molasses"],
        nutrition="A source of vitamin C, vitamin K and polyphenols.",
        recipe_uses=["Salad", "Juice", "Raita", "Dessert topping"],
        healthy_hue=(0, 12),
        browning_penalty=1.0,
    ),
]

# --- Vegetables -----------------------------------------------------------

_VEGETABLE: list[FoodRecord] = [
    FoodRecord(
        name="Tomato",
        category="vegetable",
        shelf_life=ShelfLife(counter=(3, 5), refrigerated=(7, 10)),
        preferred_storage="counter",
        storage_headline="Keep at room temperature, stem side down",
        storage_details=[
            "Room temperature preserves flavour and texture better than the fridge.",
            "Keep out of direct sunlight and do not stack them.",
            "Refrigerate only once fully ripe, to buy a few extra days.",
        ],
        preservation=["Roast and freeze", "Cook into passata", "Sun-dry"],
        nutrition="A source of vitamin C, potassium and lycopene.",
        recipe_uses=["Salad", "Tomato rice", "Soup", "Sandwich", "Curry base"],
        healthy_hue=(0, 12),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Carrot",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(21, 35), frozen=(240, 300)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate in a sealed bag",
        storage_details=[
            "Remove the leafy tops, which draw moisture out of the root.",
            "A sealed bag or container in the crisper keeps them crisp for weeks.",
        ],
        preservation=["Blanch and freeze", "Pickle in vinegar"],
        nutrition="High in beta-carotene (vitamin A) and fibre.",
        recipe_uses=["Salad", "Soup", "Stir fry", "Carrot halwa"],
        healthy_hue=(5, 22),
        browning_penalty=1.0,
    ),
    FoodRecord(
        name="Potato",
        category="vegetable",
        shelf_life=ShelfLife(pantry=(30, 60), refrigerated=(60, 90)),
        preferred_storage="pantry",
        storage_headline="Store cool, dark and dry — not in the fridge",
        storage_details=[
            "A dark, ventilated cupboard is ideal; light turns the skin green.",
            "Do not refrigerate raw potatoes: cold converts starch to sugar.",
            "Keep away from onions, which speed up sprouting.",
        ],
        preservation=["Cook then freeze", "Par-boil and chill"],
        nutrition="A source of potassium, vitamin C and starch.",
        recipe_uses=["Curry", "Roast potatoes", "Mash", "Soup"],
        healthy_hue=(15, 35),
        browning_penalty=0.9,
        texture_sensitive=True,
    ),
    FoodRecord(
        name="Onion",
        category="vegetable",
        shelf_life=ShelfLife(pantry=(30, 60), refrigerated=(14, 21)),
        preferred_storage="pantry",
        storage_headline="Store dry and ventilated, away from potatoes",
        storage_details=[
            "A mesh bag in a cool, dry cupboard is best.",
            "Refrigerate only once cut, sealed in a container.",
        ],
        preservation=["Dice and freeze", "Caramelise and refrigerate", "Pickle"],
        nutrition="A source of vitamin C and prebiotic fibre.",
        recipe_uses=["Curry base", "Salad", "Sambar", "Caramelised onions"],
        healthy_hue=(10, 30),
        browning_penalty=0.8,
    ),
    FoodRecord(
        name="Spinach",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(3, 7), frozen=(240, 300)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate dry, loosely wrapped",
        storage_details=[
            "Keep leaves dry: moisture is what turns spinach slimy.",
            "Wrap loosely in a paper towel inside a container.",
            "Wash only just before cooking.",
        ],
        preservation=["Blanch and freeze", "Cook into palak and refrigerate"],
        nutrition="High in vitamin K, vitamin A, folate and iron.",
        recipe_uses=["Palak paneer", "Dal", "Smoothie", "Sautéed greens", "Soup"],
        healthy_hue=(35, 85),
        # Yellowing and browning are the primary spoilage cue for leafy greens.
        browning_penalty=1.4,
    ),
    FoodRecord(
        name="Broccoli",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(7, 14), frozen=(240, 300)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate unwashed in an open bag",
        storage_details=[
            "Broccoli needs airflow; a loosely open bag in the crisper works well.",
            "Yellowing florets mean it is past its best.",
        ],
        preservation=["Blanch and freeze", "Roast and refrigerate"],
        nutrition="High in vitamin C, vitamin K and fibre.",
        recipe_uses=["Stir fry", "Soup", "Roasted broccoli", "Pasta"],
        healthy_hue=(35, 85),
        browning_penalty=1.3,
    ),
    FoodRecord(
        name="Capsicum",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(7, 14), frozen=(180, 240)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate whole and dry",
        storage_details=[
            "Store whole in the crisper drawer; cut peppers soften quickly.",
        ],
        preservation=["Slice and freeze", "Roast and store in oil"],
        nutrition="High in vitamin C and vitamin A.",
        recipe_uses=["Stir fry", "Salad", "Stuffed peppers", "Curry"],
        healthy_hue=(0, 90),
        browning_penalty=1.0,
        aliases=["Bell pepper", "Capsicum"],
    ),
    FoodRecord(
        name="Brinjal",
        category="vegetable",
        shelf_life=ShelfLife(counter=(2, 3), refrigerated=(5, 7)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate, but use within the week",
        storage_details=[
            "Brinjal bruises easily; store it where nothing presses on it.",
            "Very cold temperatures cause pitting, so avoid the coldest shelf.",
        ],
        preservation=["Roast and freeze the pulp", "Pickle"],
        nutrition="A source of dietary fibre and manganese.",
        recipe_uses=["Baingan bharta", "Curry", "Grilled aubergine", "Moussaka"],
        healthy_hue=(120, 160),
        browning_penalty=1.1,
        aliases=["Eggplant", "Aubergine"],
    ),
    FoodRecord(
        name="Cucumber",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(5, 10)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate wrapped, away from the coldest shelf",
        storage_details=[
            "Wrap in a paper towel to absorb condensation.",
            "Keep away from tomatoes and bananas, which speed up softening.",
        ],
        preservation=["Quick-pickle in vinegar", "Blend into a chilled soup"],
        nutrition="Mostly water, with some vitamin K.",
        recipe_uses=["Salad", "Raita", "Sandwich", "Pickle"],
        healthy_hue=(35, 85),
        browning_penalty=1.2,
    ),
    FoodRecord(
        name="Cabbage",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(21, 60)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate whole and unwashed",
        storage_details=[
            "A whole head keeps for weeks; peel off outer leaves as needed.",
            "Once cut, wrap the exposed face tightly.",
        ],
        preservation=["Ferment into sauerkraut", "Blanch and freeze"],
        nutrition="A source of vitamin C, vitamin K and fibre.",
        recipe_uses=["Slaw", "Stir fry", "Thoran", "Soup"],
        healthy_hue=(35, 90),
        browning_penalty=1.2,
    ),
    FoodRecord(
        name="Cauliflower",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(7, 14), frozen=(240, 300)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate stem down in an open bag",
        storage_details=[
            "Storing stem-side down keeps moisture off the florets.",
            "Brown speckling on the curd means it is deteriorating.",
        ],
        preservation=["Blanch and freeze", "Roast and refrigerate"],
        nutrition="A source of vitamin C, vitamin K and fibre.",
        recipe_uses=["Roasted cauliflower", "Curry", "Cauliflower rice", "Soup"],
        healthy_hue=(15, 40),
        browning_penalty=1.4,
    ),
    FoodRecord(
        name="Mushroom",
        category="vegetable",
        shelf_life=ShelfLife(refrigerated=(4, 7)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate in paper, never sealed plastic",
        storage_details=[
            "A paper bag lets mushrooms breathe; plastic makes them slimy.",
            "Do not wash until you are ready to cook.",
        ],
        preservation=["Sauté and freeze", "Dry thoroughly"],
        nutrition="A source of B vitamins, selenium and vitamin D.",
        recipe_uses=["Stir fry", "Risotto", "Soup", "Pasta"],
        healthy_hue=(10, 30),
        browning_penalty=1.2,
    ),
]

# --- Protein --------------------------------------------------------------

_PROTEIN: list[FoodRecord] = [
    FoodRecord(
        name="Chicken",
        category="poultry",
        shelf_life=ShelfLife(refrigerated=(1, 2), frozen=(270, 365)),
        preferred_storage="refrigerated",
        storage_headline="Keep refrigerated below 4 °C and cook within 2 days",
        storage_details=[
            "Store on the lowest shelf in a sealed container so nothing drips onto other food.",
            "Freeze immediately if you will not cook it within 2 days.",
            "Never refreeze poultry that has already been thawed in the fridge and left out.",
        ],
        preservation=["Freeze in portions", "Cook fully, then refrigerate up to 3 days"],
        nutrition="High in protein, with B vitamins and phosphorus.",
        recipe_uses=["Curry", "Grilled chicken", "Soup", "Stir fry"],
        healthy_hue=(0, 20),
        browning_penalty=1.5,
        high_risk=True,
    ),
    FoodRecord(
        name="Fish",
        category="seafood",
        shelf_life=ShelfLife(refrigerated=(1, 2), frozen=(180, 240)),
        preferred_storage="refrigerated",
        storage_headline="Keep on ice and cook the same day if possible",
        storage_details=[
            "Fresh fish is best cooked the day you buy it.",
            "Store on ice or on the coldest shelf, sealed.",
            "Smell is a far better guide than appearance for fish.",
        ],
        preservation=["Freeze immediately in portions", "Cure or smoke"],
        nutrition="High in protein and, in oily fish, omega-3 fatty acids.",
        recipe_uses=["Fish curry", "Grilled fish", "Fish fry", "Soup"],
        healthy_hue=(0, 25),
        browning_penalty=1.5,
        high_risk=True,
    ),
    FoodRecord(
        name="Beef",
        category="meat",
        shelf_life=ShelfLife(refrigerated=(2, 4), frozen=(180, 365)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate sealed on the lowest shelf",
        storage_details=[
            "Keep sealed and separate from ready-to-eat food.",
            "Surface darkening alone is often oxidation, not spoilage — but smell and texture matter more.",
        ],
        preservation=["Freeze in portions", "Cook fully, then refrigerate"],
        nutrition="High in protein, iron, zinc and vitamin B12.",
        recipe_uses=["Curry", "Stew", "Steak", "Mince dishes"],
        healthy_hue=(0, 15),
        browning_penalty=1.3,
        high_risk=True,
    ),
]

# --- Dairy ----------------------------------------------------------------

_DAIRY: list[FoodRecord] = [
    FoodRecord(
        name="Milk",
        category="dairy",
        shelf_life=ShelfLife(refrigerated=(5, 7), frozen=(60, 90)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate at the back, not in the door",
        storage_details=[
            "The fridge door is the warmest spot; the back shelf is the coldest.",
            "Always follow the printed date on the carton over any visual assessment.",
        ],
        preservation=["Freeze in a rigid container", "Make paneer or yoghurt"],
        nutrition="A source of calcium, protein and vitamin B12.",
        recipe_uses=["Curd", "Paneer", "Kheer", "Coffee"],
        healthy_hue=None,
        browning_penalty=0.6,
        texture_sensitive=False,
        high_risk=True,
    ),
    FoodRecord(
        name="Cheese",
        category="dairy",
        shelf_life=ShelfLife(refrigerated=(14, 28), frozen=(120, 180)),
        preferred_storage="refrigerated",
        storage_headline="Refrigerate wrapped in paper, then loose plastic",
        storage_details=[
            "Hard cheese wants to breathe: paper first, then a loose bag.",
            "On hard cheese, a small surface mould spot can be cut away with a margin; "
            "on soft cheese, discard the whole piece.",
        ],
        preservation=["Freeze grated", "Store hard cheese in wax paper"],
        nutrition="A source of calcium, protein and fat.",
        recipe_uses=["Sandwich", "Pasta", "Toast", "Salad"],
        healthy_hue=(15, 35),
        browning_penalty=0.8,
        high_risk=True,
    ),
    FoodRecord(
        name="Yogurt",
        category="dairy",
        shelf_life=ShelfLife(refrigerated=(7, 14)),
        preferred_storage="refrigerated",
        storage_headline="Keep refrigerated and sealed",
        storage_details=[
            "Some clear whey on top is normal — stir it back in.",
            "Follow the printed date; pink or fuzzy growth means discard it.",
        ],
        preservation=["Strain into hung curd", "Freeze into a frozen yoghurt"],
        nutrition="A source of calcium, protein and live cultures.",
        recipe_uses=["Raita", "Lassi", "Marinade", "Breakfast bowl"],
        healthy_hue=None,
        browning_penalty=0.6,
        texture_sensitive=False,
        high_risk=True,
    ),
]

# --- Bakery ---------------------------------------------------------------

_BAKERY: list[FoodRecord] = [
    FoodRecord(
        name="Bread",
        category="bakery",
        shelf_life=ShelfLife(pantry=(2, 4), refrigerated=(7, 14), frozen=(60, 90)),
        preferred_storage="pantry",
        storage_headline="Keep in a sealed bag at room temperature",
        storage_details=[
            "Room temperature in a sealed bag keeps the crumb soft.",
            "Refrigeration makes bread stale faster, though it delays mould.",
            "Freezing sliced bread is the best way to keep it long term.",
            "Visible mould means discard the whole loaf, not just the slice.",
        ],
        preservation=["Freeze sliced", "Blitz stale bread into crumbs", "Make croutons"],
        nutrition="A source of carbohydrate, with fibre in wholegrain loaves.",
        recipe_uses=["Toast", "Sandwich", "Breadcrumbs", "Croutons", "Bread upma"],
        healthy_hue=(10, 30),
        browning_penalty=0.7,
        texture_sensitive=False,
    ),
    FoodRecord(
        name="Pastry",
        category="bakery",
        shelf_life=ShelfLife(pantry=(1, 2), refrigerated=(3, 5), frozen=(30, 60)),
        preferred_storage="pantry",
        storage_headline="Eat fresh; refrigerate anything with a cream filling",
        storage_details=[
            "Plain pastry keeps a day or two in a tin at room temperature.",
            "Cream- or custard-filled pastry must be refrigerated.",
        ],
        preservation=["Freeze unfilled pastry", "Refresh in a hot oven"],
        nutrition="Typically high in refined carbohydrate and fat.",
        recipe_uses=["Dessert", "Breakfast", "Bread pudding"],
        healthy_hue=(10, 30),
        browning_penalty=0.7,
        texture_sensitive=False,
    ),
]

ALL_FOODS: list[FoodRecord] = _FRUIT + _VEGETABLE + _PROTEIN + _DAIRY + _BAKERY

#: Lookup by lower-cased name and alias.
FOOD_INDEX: dict[str, FoodRecord] = {}
for _record in ALL_FOODS:
    FOOD_INDEX[_record.name.lower()] = _record
    for _alias in _record.aliases:
        FOOD_INDEX.setdefault(_alias.lower(), _record)


#: Foods for which the browning index is a valid measurement.
#:
#: The browning index (Palou et al.) was developed for light-coloured food
#: surfaces, where browning is the dominant visible deterioration. Applied to a
#: saturated chromatic food it is meaningless as an absolute: a flawless red
#: tomato measures ~1.0 on the normalised scale, because a large positive a*
#: drives the formula regardless of condition. Comparing it across foods would
#: need a reference BI per food, which Fresora does not have.
#:
#: So browning is measured only for the foods below. For everything else the
#: metric is returned as null, the UI hides the row, and the freshness formula
#: redistributes its weight to the signals that were measured. Deterioration in
#: those foods is still caught by defect coverage, discoloration (hue drift from
#: the curated healthy hue), texture uniformity and colour consistency.
BROWNING_APPLICABLE_FOODS: frozenset[str] = frozenset(
    {
        "apple",
        "pear",
        "banana",
        "avocado",
        "guava",
        "potato",
        "onion",
        "cauliflower",
        "mushroom",
        "bread",
        "pastry",
        "cheese",
    }
)


def browning_applicable(food_name: str | None) -> bool:
    """Whether the browning index means anything for this food."""
    if not food_name:
        return False
    return food_name.strip().lower() in BROWNING_APPLICABLE_FOODS


#: Pantry staples the recipe engine may assume a household has. Keeping this
#: explicit stops a generated recipe from quietly requiring a shopping trip.
PANTRY_STAPLES: list[str] = [
    "Salt",
    "Black pepper",
    "Cooking oil",
    "Olive oil",
    "Garlic",
    "Ginger",
    "Turmeric",
    "Cumin",
    "Chilli powder",
    "Mustard seeds",
    "Rice",
    "Wheat flour",
    "Sugar",
    "Lentils",
]
