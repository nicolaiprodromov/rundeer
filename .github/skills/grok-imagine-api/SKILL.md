---
name: grok-imagine-api
description: Use this skill for ALL tasks involving the Grok Imagine API including generating images/videos with grok-imagine-image or grok-imagine-video models, image editing, multi-image composition, image-to-video animation from starting frames, reference images for style consistency, video editing, extending videos, and cinematic media creation. Always trigger on user requests mentioning Grok Imagine, xAI video/image generation, animate photo, AI video edit, reference image video, or similar. Provides exact SDK/REST examples, parameter lists, workflows, prompt engineering tips, and error handling so models can correctly integrate and use the API without guessing.
---

# Grok Imagine API - Comprehensive Workflow Skill

This skill equips you with precise, up-to-date knowledge to correctly use xAI's Grok Imagine API for high-quality image and video generation, editing, and animation. Follow the workflows exactly. The API uses two primary models:
- **grok-imagine-image**: Fast, high-quality image generation and editing.
- **grok-imagine-video**: State-of-the-art text-to-video, image-to-video, editing, and extension with native audio and cinematic understanding.

**Key Capabilities**:
- Text-to-image and image editing (including multi-image merge up to 5 images)
- Iterative multi-turn image refinement
- Text-to-video
- Image-to-video (starting frame animation)
- Reference images for consistent style/characters (separate from starting frame)
- Video editing with natural language
- Video extension
- Configurable aspect ratio, resolution, duration
- SDK handles async video polling automatically

**Always** use the official SDK when possible for simplicity. Fall back to REST for full control or custom polling.

## 1. Setup and Authentication

1. Obtain an API key from the [xAI Console](https://console.x.ai/) (requires billing setup for generation access).
2. Set the environment variable:
   ```bash
   export XAI_API_KEY="your_key_here"
   ```
3. Install the SDK (recommended):
   ```bash
   pip install xai-sdk
   ```
4. Initialize the client:
   ```python
   import os
   import xai_sdk

   client = xai_sdk.Client(api_key=os.getenv("XAI_API_KEY"))
   # Or: from xai_sdk import Client; client = Client()
   ```

**REST Base URL**: `https://api.x.ai/v1`

**Important**: Video URLs are temporary — download or process them immediately after generation.

## 2. Image Generation Workflows (grok-imagine-image)

### Text-to-Image (Basic Generation)
```python
response = client.image.sample(
    prompt="A serene Japanese garden at dusk with glowing lanterns and cherry blossoms falling gently, cinematic lighting, highly detailed",
    model="grok-imagine-image",
    aspect_ratio="16:9"  # Options: "1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:2" etc.
)
print(response.url)  # Direct image URL
```

**Common parameters**:
- `prompt` (str, required): Detailed description. Use cinematic language, lighting, mood, composition.
- `model`: "grok-imagine-image"
- `aspect_ratio`: String like "16:9"
- `image_url` or `image_urls`: For editing (see below)
- Optional: resolution hints via aspect (higher res via quality prompts)

### Image Editing / Img2Img (Single Image)
Provide the source image as the base and describe the desired changes in the prompt.
```python
response = client.image.sample(
    prompt="Change the time of day to golden hour sunset, add dramatic clouds and warm volumetric lighting, keep the Japanese garden structure",
    model="grok-imagine-image",
    image_url="https://example.com/garden.jpg",  # Or base64 data URI: "data:image/jpeg;base64,..."
    aspect_ratio="16:9"
)
```

### Multi-Image Composition / Merge (Up to 5 Images)
Use `image_urls` (list) to combine or edit multiple references.
```python
response = client.image.sample(
    prompt="Merge the character from image 1 into the cyberpunk cityscape of image 2, futuristic neon style, dramatic angle",
    model="grok-imagine-image",
    image_urls=[
        "https://.../character.png",
        "https://.../cityscape.jpg"
    ],
    aspect_ratio="16:9"
)
```

### Multi-Turn Iterative Editing
Chain generations: take the output URL from one response and feed it as `image_url` in the next call with incremental prompt changes. This enables precise refinement (e.g., "make the eyes more expressive" → "adjust lighting on face" → "add subtle smile").

**Best Practice**: Keep each prompt focused on 1-2 specific changes. Use strong descriptive language.

## 3. Video Generation Workflows (grok-imagine-video)

Video generation is **asynchronous**. The SDK's `generate()` and `extend()` methods automatically handle submission + polling and return the final response.

**Typical parameters**:
- `prompt` (required)
- `model`: "grok-imagine-video"
- `duration`: int seconds (commonly 4–15s; longer increases cost/time)
- `aspect_ratio`: "16:9", "9:16", "1:1", "4:3" etc.
- `resolution`: "480p", "720p", "1080p" (higher = slower/more expensive)
- `image`: URL or base64 for **starting frame** (image-to-video)
- `reference_images`: List of URLs/base64 for **style/character reference** (does not become the subject)

### Text-to-Video (From Scratch)
```python
response = client.video.generate(
    prompt="A glowing crystal-powered rocket launching from the red dunes of Mars at sunrise, ancient alien ruins lighting up, sweeping camera pan and dramatic lift-off, cinematic, 8K",
    model="grok-imagine-video",
    duration=10,
    aspect_ratio="16:9",
    resolution="720p"
)
print(response.url)  # MP4 URL with native audio
```

### Image-to-Video (Animate Starting Frame)
The provided image becomes the **exact first frame**. The prompt describes the motion, camera movement, and evolution.
```python
response = client.video.generate(
    prompt="Slow and serene time-lapse: gentle ripples spread across the mountain lake as morning mist drifts and birds take flight, smooth cinematic tracking shot",
    model="grok-imagine-video",
    image="https://example.com/lake-sunrise.jpg",  # Starting frame (preserved)
    duration=8,
    aspect_ratio="16:9",
    resolution="720p"
)
```

**When to use**: Product shots, portraits, specific compositions where first-frame control is critical.

### Reference Images for Style Consistency
Add `reference_images` (list) to guide overall look, character appearance, lighting, or art style without locking the first frame.
```python
response = client.video.generate(
    prompt="The same character explores a neon cyberpunk alley at night, dynamic camera movement, rain reflections",
    model="grok-imagine-video",
    duration=6,
    aspect_ratio="9:16",
    reference_images=["https://.../character-ref.jpg", "https://.../style-ref.png"]  # Style/character refs
)
```

**Reference vs Starting Image**:
- `image` → Exact first frame (subject + composition locked)
- `reference_images` → Visual style, character identity, mood guidance (more flexible)

### Video Editing with Natural Language
Describe the desired changes. The model understands cinematic edits.
Typical pattern (SDK may expose as `client.video.edit` or via generate with video param):
```python
# Example pattern (verify current SDK signature)
response = client.video.generate(  # Or client.video.edit
    prompt="Slow the motion down to half speed, add dramatic lens flare on the rocket engines, enhance the alien ruins glow, keep the overall camera path",
    # video_url= previous_response.url,  # or request_id
    model="grok-imagine-video"
)
```

### Extending Videos
Use `client.video.extend()` to continue a clip naturally.
```python
response = client.video.extend(
    prompt="Continue the scene: the rocket enters orbit, Earth comes into view, smooth transition to space vista",
    # original_video= previous_url or request_id,
    duration=6,
    model="grok-imagine-video"
)
```

**REST API (Manual Polling - Full Control)**

**Step 1: Submit**
```bash
curl -X POST https://api.x.ai/v1/videos/generations \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-imagine-video",
    "prompt": "Your detailed cinematic prompt here",
    "duration": 10,
    "aspect_ratio": "16:9",
    "resolution": "720p",
    "image": "https://.../start.jpg",
    "reference_images": ["https://.../ref1.jpg"]
  }'
```
Response: `{"request_id": "d97415a1-..."}`

**Step 2: Poll**
```bash
curl -X GET "https://api.x.ai/v1/videos/{request_id}" \
  -H "Authorization: Bearer $XAI_API_KEY"
```
Poll every 5–10 seconds. Status values: `pending` / `processing` → `done` (then `video.url` available) or `failed` / `expired`.

**For images REST**: Similar pattern with `/v1/images/generations` (often synchronous or simpler).
