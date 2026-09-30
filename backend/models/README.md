# Models

Every model Fresora runs, what it is for, and what it cannot do. All inference
is ONNX Runtime on CPU — there is no TensorFlow or PyTorch at runtime, which is
what keeps the whole backend inside the 250 MB limit for a serverless function.

| File | Role | Size | Runs when |
|---|---|---|---|
| `mobilenetv2-12.onnx` | Image classification | 14.0 MB | Every `/analyze` and `/food/identify` |
| `imagenet_class_index.json` | Class id → label table | 35 KB | With the above |
| `yolox_tiny.onnx` | Object detection + location | 20.2 MB | `/detect`, and `/analyze` when classification fails |
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

## 3. YOLOX-Tiny — object detection

**What it does.** Finds *where* each food is, so a fridge shelf becomes
several items rather than one averaged score. Each box is cropped and put
through the same measurement and scoring path as a single scan.

**Source.** [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) release
`0.1.1rc0`, `yolox_tiny.onnx`, COCO-trained. Apache-2.0.

**Detects** banana, apple, orange, broccoli and carrot (mapped to reference
data), plus sandwich, pizza, hot dog, donut and cake (detected, not scored).
Everything else COCO knows — people, cutlery, furniture — is ignored, because
a box around a fork is noise on a food scan.

**Measured** on the same fruit photo, against the SSD MobileNet v1 it replaced:

| | SSD MobileNet v1 | YOLOX-Tiny |
|---|---|---|
| Model size | 29.3 MB | **20.2 MB** |
| Distinct items found | 7 | **12** |
| Top confidence | 0.86 | **0.88** |
| Warm latency | 40–60 ms | 220–260 ms |

YOLOX is slower because decoding and NMS run in NumPy rather than inside the
graph, which is the trade for finding nearly twice as many items correctly.
Still well inside a scan's budget.

### Post-processing, and why it is not optional

Unlike SSD, YOLOX emits **no NMS and no absolute coordinates**. Three steps
happen in `detector.py`, and each fails silently rather than loudly:

1. **Letterbox** onto a 416×416 canvas padded with 114, preserving aspect
   ratio. Stretching to a square instead would squash every object. Pixels
   stay raw BGR 0–255 — applying the ImageNet mean/std the classifier needs
   would not error, it would just make every prediction wrong.
2. **Decode** grid-relative offsets: `(offset + cell) × stride` for centres,
   `exp(raw) × stride` for sizes, across strides 8/16/32 (3549 anchors).
   Skipping this clusters every box in the top-left corner.
3. **NMS**, via `deduplicate` at IoU 0.55. A six-fruit photo produces 110 raw
   boxes; without this the user would see dozens of duplicates of one apple.

**Cannot detect** tomato, potato, onion or raw meat: COCO has no class for
them, the same wall the classifier hits.

---

## 4. Why YOLOX rather than YOLOv8n

YOLOv8n was the original choice and was rejected for two concrete reasons.

**No public ONNX build exists.** Every Hugging Face repo hosting YOLOv8n ships
PyTorch `.pt` only. Producing an ONNX needs `ultralytics` plus `torch`, about
2.5 GB installed, purely as a build-time step for a 12 MB artefact.

**Licensing.** Ultralytics YOLOv5/v8 weights are AGPL-3.0. On a public
repository that carries obligations the Apache-2.0 weights here do not.

YOLOX is the same family of single-stage detector, is **Apache-2.0**, and
publishes ONNX directly — no conversion step and no 2.5 GB dependency. Tiny
(20 MB) is used; Nano (3.7 MB) is available from the same release if cold-start
time ever matters more than accuracy.

SSD MobileNet v1, which YOLOX replaced, was Apache-2.0 and worked. It was
swapped out because YOLOX is 9 MB smaller and found 12 items where SSD found
7 on the same photo.

---

## Licensing of what ships here

| Artefact | Origin | Licence |
|---|---|---|
| `mobilenetv2-12.onnx` | ONNX Model Zoo | Apache-2.0 |
| `yolox_tiny.onnx` | Megvii YOLOX release 0.1.1rc0 | Apache-2.0 |
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
