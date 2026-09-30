# Models

Every model Fresora runs, what it is for, and what it cannot do. All inference
is ONNX Runtime on CPU — there is no TensorFlow or PyTorch at runtime, which is
what keeps the whole backend inside the 250 MB limit for a serverless function.

| File | Role | Size | Runs when |
|---|---|---|---|
| `mobilenetv2-12.onnx` | Image classification | 14.0 MB | Every `/analyze` and `/food/identify` |
| `imagenet_class_index.json` | Class id → label table | 35 KB | With the above |
| `ssd_mobilenet_v1_coco.onnx` | Object detection + location | 29.3 MB | `/detect`, and `/analyze` when classification fails |
| `protein_hint.npz` + `protein_hint_labels.txt` | Custom binary classifier | 7.9 KB | `/analyze` when nothing is identified |
| `head.npz` + `labels.txt` | Custom multi-class head | — | Only if you train one (not committed) |

---

## 1. MobileNetV2 — image classification

**What it does.** Takes the whole photo and answers "what food is this?".
Outputs 1000 ImageNet class scores; `IMAGENET_FOOD_MAP` in
`app/vision/classifier.py` narrows those to foods Fresora holds data for.

**Source.** ONNX Model Zoo, `mobilenetv2-12`. ImageNet-1k pretrained weights.

**Measured.** Banana, broccoli and lemon each identified at 1.00 confidence
against the deployed backend.

**Cannot identify:** tomato, potato, onion, spinach, carrot, mango, guava, or
any raw meat, fish or dairy. ImageNet-1k has no class for them. This is a
property of the training set, not a tuning problem — no preprocessing change
fixes it. Those photos return `identified: false` rather than a guess.

**Input.** 224×224 RGB, NCHW, normalised with the torchvision mean/std. Using
Keras-style `[-1, 1]` scaling instead would not error; it would silently
degrade every prediction.

---

## 2. MobileNetV2 + custom classifier

A linear layer trained on top of the frozen MobileNetV2 output. This is
ordinary transfer learning: the frozen features already encode colour, texture
and shape, so the head only separates the classes. It trains on CPU in seconds
from a few hundred images per class and adds kilobytes, not megabytes.

### 2a. `protein_hint.npz` — shipped

**What it does.** Answers one question: is this raw meat, poultry or seafood?
Used when the classifier identifies nothing, to offer a shortlist instead of
the full food list.

**Trained on** 404 freely-licensed Wikimedia Commons photos across chicken,
beef, mutton, fish, prawn and a mixed "other" class.

**Measured, on images it never trained on:**

| Task | Accuracy |
|---|---|
| Raw protein vs everything else | **86.2%** |
| Precision when it fires (≥0.70) | **96.6%** |
| Recall at that threshold | 87.9% |

**Deliberately not shipped: species identification.** The same data gives
56.2% across chicken/beef/mutton/fish/prawn, and 35.7% on mutton alone. A
model that confidently names the wrong meat is worse than one that says "raw
protein — which?", so only the binary head is used.

It is a **hint, not an identification**. The score still comes from the food
the user picks, and the high-risk cap still applies.

### 2b. `head.npz` — yours to train

Train one to add classes the stock model cannot name:

```bash
# data/chicken/*.jpg, data/mutton/*.jpg, ...
python scripts/train_food_head.py --data data --out models
```

Drop `head.npz` and `labels.txt` here and the API switches from `imagenet` to
`custom` mode on the next start. **No head is committed**: a model is only as
trustworthy as the photos behind it, and for raw meat that is a food-safety
question rather than a convenience one.

Roughly 100–300 photos per class is a sensible floor. Shoot them as the app
will see them — varied lighting, backgrounds and angles, including
part-wrapped and on a plate. A set shot in one session on one worktop teaches
the head to recognise your worktop.

---

## 3. SSD + MobileNetV2 — object detection

**What it does.** Finds *where* each food is, so a fridge shelf becomes
several items rather than one averaged score. Each box is cropped and put
through the same measurement and scoring path as a single scan.

**Source.** ONNX Model Zoo, `ssd_mobilenet_v1_10`, COCO-trained.

**Detects** banana, apple, orange, broccoli and carrot (mapped to reference
data), plus sandwich, pizza, hot dog, donut and cake (detected, not scored).
Everything else COCO knows — people, cutlery, furniture — is ignored, because
a box around a fork is noise on a food scan.

**Measured.** 7 items found and individually scored on a fruit photo;
110–157 ms warm, ~6 s on a cold start while the graph loads.

Boxes are deduplicated across classes at IoU 0.55. SSD applies its own NMS per
class, which does not merge the same orange returned as both "orange" and
"apple" — that would double-count in the inventory.

**Cannot detect** tomato, potato, onion or raw meat: COCO has no class for
them, the same wall the classifier hits.

---

## 4. YOLO — considered, not included

YOLO is an object detector, which is the job SSD MobileNet already does here.
Adding it would give the project no capability it lacks, so it is a deliberate
omission rather than an oversight.

Three specific reasons:

**It duplicates an existing capability.** Two detectors would run the same
pipeline over the same classes. Only one can be wired to `/detect`; the other
would be dead weight in the bundle.

**Licensing.** YOLOv5/v8 weights from Ultralytics are AGPL-3.0. Shipping them
in a public repository carries obligations that the Apache-2.0 ONNX Model Zoo
weights used here do not.

**Size budget.** The backend already carries OpenCV, ONNX Runtime and 43 MB of
models inside a 250 MB serverless limit. Adding a second detector spends that
headroom on a duplicate.

**If you do want YOLO**, the sensible move is to *replace* SSD rather than add
to it. YOLOv8n is around 12 MB — smaller than SSD's 29 MB — and more accurate
on COCO. The work is a new `detect()` in `app/vision/detector.py`: YOLO emits
raw boxes with no built-in NMS, so post-processing has to be written, and its
output is `(cx, cy, w, h)` rather than SSD's `(ymin, xmin, ymax, xmax)`.
`Detection` and everything downstream would not change.

---

## Licensing of what ships here

| Artefact | Origin | Licence |
|---|---|---|
| `mobilenetv2-12.onnx` | ONNX Model Zoo | Apache-2.0 |
| `ssd_mobilenet_v1_coco.onnx` | ONNX Model Zoo | Apache-2.0 |
| `imagenet_class_index.json` | TensorFlow/Keras | Apache-2.0 |
| `protein_hint.npz` | Trained here | See below |

The protein hint was trained on Wikimedia Commons photos, which carry a mix of
free licences (CC-BY, CC-BY-SA, public domain). Whether a trained weight is a
derivative work of its training images is unsettled, and the answer may differ
by jurisdiction. If Fresora is ever distributed commercially, retrain the head
on photos you own — which is worth doing anyway, since your own kitchen photos
will outperform studio shots from Commons.

Verify these licences yourself before relying on them commercially. They are
recorded here as a starting point, not legal advice.
