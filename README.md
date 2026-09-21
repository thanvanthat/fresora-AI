# Fresora

**AI-assisted food freshness and zero-waste assistant.** Scan food, get a
measured assessment of its visible condition, and use it before it becomes
waste.

> Fresora analyzes visible food characteristics from images. It cannot detect
> microscopic bacteria, odorless toxins, or all internal food-safety hazards.
> Results are AI-assisted estimates, not official food-safety guarantees.

---

## What it does

```
SCAN → IDENTIFY → MEASURE → SCORE → RECOMMEND → TRACK → RESCUE
```

- **Scan** food with the camera or pick a photo from the gallery.
- **Measure** the surface with OpenCV: dark-defect coverage, colour
  consistency, hue drift, texture uniformity, and (for pale foods) the
  browning index.
- **Score** 0–100 via a documented deterministic formula, mapped to
  Fresh / Nearly Spoiled / Overripe / Spoiled.
- **Recommend** storage from a curated knowledge base, plus an estimated
  freshness window.
- **Track** inventory, scan history, and each item's *freshness journey* across
  repeat scans.
- **Rescue** food with zero-waste recipes that prioritise what is about to be
  lost — and never include anything assessed as spoiled.

---

## Quick start

Two processes: the FastAPI backend, and the Expo app.

### 1. Backend

```bash
cd backend
py -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
cp .env.example .env            # optional; works with defaults
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` matters: a phone on your Wi-Fi cannot reach `localhost`.

Check it:

```bash
curl http://127.0.0.1:8000/api/v1/health
```

Interactive API docs: <http://127.0.0.1:8000/docs>

### 2. Mobile app

```bash
cd mobile
npm install
cp .env.example .env            # optional; auto-detects the API host
npx expo start
```

Scan the QR code with **Expo Go**, or press `a` for an Android emulator.

### 3. Browser preview (optional)

```bash
cd mobile
npx expo start --web
```

Useful for a quick look at layout and copy. It is not the target: the
camera, haptics and native gestures behave differently or not at all in a
browser, so judge the app on a phone.

---

## Architecture

```
Fresora/
├── mobile/                  Expo + TypeScript app (React Native 0.86, SDK 57)
│   ├── app/                 expo-router routes (27 screens, file-based)
│   │   ├── (tabs)/          Home · My Food · Scan · Recipes · You
│   │   ├── (auth)/          welcome, sign-in, sign-up, forgot-password
│   │   ├── item/[id]        inventory detail + freshness journey
│   │   └── recipe/[id]      saved recipe
│   └── src/
│       ├── theme/           colour, type, spacing, radius, shadow tokens
│       ├── components/      design system (buttons, cards, charts, states)
│       ├── features/        screen-specific composites
│       ├── services/        api · auth · storage · image · notifications
│       ├── hooks/           TanStack Query wrappers
│       ├── store/           Zustand client state
│       ├── utils/           ageing, prioritisation, analytics (pure)
│       ├── i18n/            6 locales + tiny runtime
│       └── types/           domain types, mirroring the backend schemas
│
├── backend/                 FastAPI + OpenCV
│   └── app/
│       ├── vision/          metrics.py (OpenCV) · classifier.py (MobileNetV2)
│       ├── knowledge/       curated food data + FoodKnowledgeService
│       ├── ai/              provider abstraction · recipes · assistant
│       ├── routers/         analyze · intelligence
│       ├── freshness.py     the documented scoring formula
│       └── narrative.py     measurements → plain language
│
└── supabase/
    └── migrations/          schema + row-level security
```

**Division of labour.** The backend owns what needs a server: the model,
OpenCV, and the LLM key. Inventory, history and analytics are plain CRUD over
the user's own rows, which the app reads and writes directly — through
AsyncStorage on-device, or Supabase with RLS when configured. Routing that
through the API would add a hop and a second place to enforce ownership.

### Tech stack

| Layer | Choice |
|---|---|
| Mobile | React Native 0.86, Expo SDK 57, TypeScript (strict) |
| Navigation | expo-router (file-based, built on React Navigation) |
| Styling | RN StyleSheet + centralised design tokens |
| Server state | TanStack Query |
| Client state | Zustand |
| Validation | Zod |
| Charts | react-native-svg (hand-drawn, ~200 lines) |
| Backend | FastAPI, Uvicorn, Pydantic v2 |
| Vision | OpenCV (headless), NumPy |
| Classifier | MobileNetV2 — **optional**, see below |
| Database | Supabase Postgres + RLS — **optional**, see below |
| AI assistant | Provider abstraction (Anthropic / OpenAI) — **optional** |
| i18n | Hand-rolled, ~100 lines over typed dictionaries |

---

## How the freshness score works

Full derivation in [`backend/app/freshness.py`](backend/app/freshness.py).

It is a **transparent heuristic over real measurements**, not a trained
spoilage classifier. The API labels it as such in every response
(`scoring_method: "opencv-heuristic-v1"`).

Start at 100 and subtract a weighted penalty per measured signal:

```
penalty = W_defect   · defect_coverage
        + W_brown    · browning_index · browning_penalty(food)
        + W_discolor · discoloration
        + W_texture  · (1 − texture_uniformity)
        + W_colour   · (1 − colour_consistency)

score   = round(100 · (1 − clamp(penalty, 0, 1)))
```

Each input is normalised to 0–1, so each weight *is* the maximum points that
signal can cost. Weights sum to 1.0 per food family (asserted by a test) and
differ by family, because the same pixels mean different things:

| Family | Weighted hardest | Why |
|---|---|---|
| `produce` | defects, browning | spots and rot dominate |
| `leafy` | discoloration | yellowing is the spoilage cue |
| `protein` | browning, discoloration | and the score is capped |
| `bakery` | defects | visible mould |
| `dairy` | defects | and capped hardest |

**Missing measurements redistribute their weight** across the signals that
*were* measured, so the score stays on a 0–100 scale instead of being inflated
by an unmeasurable term. The response reports which signals contributed.

**High-risk foods are capped at 72/100.** For meat, poultry, seafood and dairy
a photograph genuinely cannot establish freshness, so those never read "Fresh"
and the app tells the user to check smell and the printed date.

**Status bands** (duplicated in `mobile/src/constants/status.ts`, with a test
asserting they match):

```
80–100  fresh          45–79  nearly spoiled
25–44   overripe        0–24  spoiled
```

`overripe` is only returned for foods that actually ripen — bread is never
"overripe".

### Measurements

`backend/app/vision/metrics.py`. Every field is nullable: if a metric cannot be
computed for an image it returns `null`, the UI hides that row, and the weight
redistributes. **No metric is ever fabricated.**

| Metric | Method |
|---|---|
| `defect_coverage` | fraction of surface > 28 L\* below the item's own median |
| `browning_index` | published Palou CIELAB formula, normalised |
| `discoloration` | circular hue distance from the food's curated healthy hue |
| `texture_uniformity` | regularised CoV of per-block Laplacian energy |
| `color_consistency` | saturation-weighted circular variance of hue |

Two details worth knowing, both found by testing:

- **Mask holes are filled.** Rot is dark *and desaturated*, so a saturation
  threshold cuts it straight out of the food region — the exact pixels that
  matter would be excluded, and a spotted item would measure as clean.
- **Texture uses a regularised CoV.** A plain coefficient of variation is
  scale-invariant, so JPEG noise on a flawless surface produced a CoV of ~10
  and cost ~21 points. An absolute energy floor fixes it.

### Browning is only measured where it is valid

The Palou browning index was developed for light-coloured food surfaces.
Applied to a saturated red tomato it reads ~1.0 *regardless of condition*,
because a large positive a\* drives the formula. Reporting that as
"browning: 100%" for a perfect tomato would be actively misleading.

So browning is measured only for the foods in
`BROWNING_APPLICABLE_FOODS` (apple, pear, banana, avocado, guava, potato,
onion, cauliflower, mushroom, bread, pastry, cheese). For everything else it
returns `null` and the other four signals carry the assessment.

---

## Optional components, and what happens without them

Fresora is designed to run with **zero credentials** and degrade honestly.
`GET /api/v1/health` reports exactly what is live, and the You tab shows it.

### Food identification (TensorFlow)

**Not installed by default.** TensorFlow publishes no wheels for Python 3.13+,
so `requirements.txt` omits it.

Without it, `POST /api/v1/analyze` returns a truthful `503 model_unavailable`
when called with no food name, and the app asks the user to pick the food —
then runs the full measurement and scoring pipeline as normal.

To enable it you need Python 3.11 or 3.12:

```bash
winget install Python.Python.3.12
py -3.12 -m venv .venv312
.venv312\Scripts\activate
pip install -r requirements.txt -r requirements-ml.txt
```

An honest limitation even then: stock ImageNet weights recognise banana,
orange, lemon, strawberry, pineapple, pomegranate, apple, cucumber, capsicum,
broccoli, cauliflower, mushroom, cabbage and bread — but ImageNet-1k has **no
class at all** for tomato, potato, onion, spinach, carrot, mango, guava, or any
raw meat, fish or dairy. For those the classifier reports `identified: false`
with its raw labels rather than guessing, and the user names the food. See
`backend/app/vision/classifier.py` for the full mapping.

For real coverage, fine-tune a model and point `MODEL_PATH` at it (with a
`labels.txt` beside it).

### Supabase

**Optional.** With `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` unset, everything persists on-device via
AsyncStorage, there is no account, and the auth screens say so.

To enable accounts and sync:

1. Create a project at <https://supabase.com>.
2. Run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   in the SQL editor (or `supabase db push`).
3. Put the URL and **anon/publishable** key in `mobile/.env`.
4. Restart with `npx expo start --clear`.

The app swaps its storage layer at start-up — both implementations satisfy the
same `FoodStore` interface, so no screen changes.

### AI assistant and generated recipes

**Optional.** With no `LLM_API_KEY` in `backend/.env`:

- the assistant answers from the curated knowledge base and labels the reply
  `source: "knowledge"`;
- recipes come from a deterministic matcher over real stored recipes and are
  labelled `source: "rules"`.

Both paths are real. Nothing is fabricated, and the UI says which one ran.

To enable generation, set in `backend/.env`:

```
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-5
```

Even with a key, the LLM is constrained: it is given the curated records and
told not to contradict them, it is forbidden from ruling on food safety, and a
generated recipe naming an ingredient outside the allowed set is **rejected**
in favour of the rules path.

---

## Environment variables

| File | Variable | Purpose |
|---|---|---|
| `mobile/.env` | `EXPO_PUBLIC_API_BASE_URL` | Backend URL. Empty = auto-detect. |
| | `EXPO_PUBLIC_SUPABASE_URL` | Optional. Enables accounts. |
| | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional. **Anon key only.** |
| `backend/.env` | `LLM_PROVIDER` | `anthropic` or `openai`. |
| | `LLM_API_KEY` | Optional. Server-side only. |
| | `MODEL_PATH` | Optional. Fine-tuned model. |
| | `MAX_IMAGE_EDGE` | Resize cap, default 1024. |
| | `MAX_UPLOAD_BYTES` | Default 12 MB. |
| | `SUPABASE_SERVICE_ROLE_KEY` | Only if writes move server-side. |

Every `EXPO_PUBLIC_*` value is compiled into the app bundle and is readable by
anyone with the APK. Secrets belong in `backend/.env`.

---

## Tests

```bash
# Backend: 107 tests
cd backend && .venv\Scripts\python.exe -m pytest tests -q

# Mobile: 91 tests
cd mobile && npm test

# Typecheck
cd mobile && npm run typecheck
```

The backend suites run without TensorFlow; the vision suite skips if OpenCV is
absent. `test_freshness.py` and `test_knowledge.py` also run standalone with no
pytest:

```bash
py backend/tests/test_freshness.py
```

What the tests actually pin down:

- **Scoring** — weights sum to 1.0, monotonic in condition, high-risk cap,
  weight redistribution, `overripe` only for ripening foods.
- **Vision** — real OpenCV runs on synthetic images with known properties;
  spots raise defect coverage, browning registers only where valid, texture
  survives JPEG compression.
- **Recipe safety** — spoiled items never appear, exclusion is always
  communicated, an LLM inventing an ingredient falls back to rules.
- **Ageing** — an assessment ages forward; a printed date wins when sooner;
  status never upgrades on its own.
- **Analytics** — rescue counted only for at-risk items consumed; rescue rate
  is `null` (not 0%) when nothing is resolved; no money/carbon keys exist.
- **i18n** — no locale introduces unknown keys, no translation drops a
  placeholder, and no string in any language claims food *is* safe.

### Database migration

`supabase/migrations/0001_init.sql` was applied to a real Postgres 17 and its
behaviour verified, not just its syntax. All 86 statements applied cleanly:
7 enums, 6 tables, 7 indexes (4 partial), 4 triggers, 27 policies, 1 bucket.

| Verified | Result |
|---|---|
| Sign-up trigger | profile **and** preferences auto-created; `full_name` read from JWT metadata |
| `resolved_at` without `resolution` | rejected |
| `score = 101` | rejected |
| Blank `food_name` | rejected |
| `ingredients` not a JSON array | rejected |
| User A reads own tables | sees **only** their own rows in all six |
| User A inserts a row as User B | **rejected** by `WITH CHECK` |
| User B updates / deletes User A's row | **0 rows** affected; A's data intact |
| No JWT at all | **0 rows** visible |
| Upload to own storage folder | allowed |
| Upload to another user's folder | **rejected** |

Two notes on how that was tested, because they are easy to get wrong:

- **RLS must be tested from a non-owner role.** Postgres bypasses RLS for the
  table owner, and Neon's `neondb_owner` additionally has `rolbypassrls`, which
  overrides even `FORCE ROW LEVEL SECURITY`. An isolation test run as the owner
  shows no filtering and looks like broken policies when the policies are fine.
- **`auth.users`, `auth.uid()` and `storage.*` were stubbed** to match
  Supabase's real column shapes. This validates *our* SQL; Supabase's own
  internals are assumed. It also ran on PG 17, where a Supabase project may be
  on PG 15.

---

## Android build

```bash
cd mobile

# Cloud build (recommended; no Android SDK needed)
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview   # installable APK

# Local build (needs Android Studio + SDK, and a first `expo prebuild`)
npx expo prebuild --clean
npx expo run:android --variant release
```

Verify the bundle without a device:

```bash
npx expo export --platform android
```

---

## Known limitations

1. **No trained freshness model.** The score is a documented heuristic over
   measured features. Labelled as such everywhere.
2. **Identification is off by default** — TensorFlow has no Python 3.14 wheels.
   The app asks the user to name the food.
3. **ImageNet cannot name several target foods** (tomato, potato, onion,
   spinach, carrot, mango, raw proteins) even with TensorFlow installed.
4. **No barcode scanning.** `expo-camera` supports it and the plugin hook is
   there, but the flow is not built.
5. **No receipt OCR.**
6. **Not run on a physical device.** Verified by an Android Metro bundle,
   typecheck, the unit suites, and a browser pass over every route. Camera,
   haptics, torch and notification delivery still need real hardware.
7. **The SQL migration is validated, with one caveat.** It was applied to a
   real Postgres 17 and its behaviour verified (see below), but against
   *stubbed* `auth.users` / `auth.uid()` / `storage.*` objects rather than
   Supabase's own, and on PG 17 where a Supabase project may run PG 15.
8. **No component render tests.** The suites cover pure logic (freshness
   ageing, prioritisation, analytics, status bands, i18n parity). Screens are
   verified by bundling and by walking every route in a browser, not by
   render assertions.
9. **Shelf-life figures are typical domestic ranges**, hand-curated, scaled by
   assessed condition. Estimates, not measurements.
10. **Google / Apple sign-in not wired.** Email/password only.

## Possible next steps

- Fine-tune a food + freshness model on a labelled dataset and set `MODEL_PATH`.
- Execute and verify the SQL migration against a real project.
- Run on a physical Android device; verify camera, torch and notifications.
- Barcode lookup for packaged goods, combining the printed date with a visual
  assessment.
- On-device inference (ONNX Runtime Mobile / TFLite) so scanning works offline.
- Move image storage into the Supabase bucket the migration already creates.
