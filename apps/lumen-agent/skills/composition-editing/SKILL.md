---
name: composition-editing
description: Build timeline-based video composition on the Lumen canvas — stitch, trim, split, reorder clips, add BGM, and render the final MP4 via a composition node.
trigger: composition, video composition, timeline, edit video, stitch, concat, final cut, trim, split, BGM,剪辑,剪辑成片,视频合成,拼接视频,合成视频,时间线,裁剪,分割,成片,导出视频,多镜头合成
---

# Lumen Composition Editing

Use this skill whenever the user wants to **edit, stitch, trim, split, reorder, or add BGM**
to multiple video clips and export one final MP4.

Load `canvas-core` first if you have not already. Then follow this skill for all timeline work.

## When To Use

- User asks to 剪辑 / 合成 / 拼接 / 成片 / 导出最终视频
- Workflow has **2+ video clips** that must become **one deliverable**
- User wants trim, split, reorder, or BGM on a timeline
- Multi-scene UGC / product video needs a final assembly step

Do **not** skip the composition node when multiple scene videos exist. Generate scenes first,
then assemble with `composition`.

## Composition Node Contract

```json
{
  "id": "composition-final",
  "type": "lumenNode",
  "position": { "x": 1200, "y": 120 },
  "data": {
    "kind": "composition",
    "title": "最终成片",
    "prompt": "",
    "output": null,
    "modelId": "lumen-composition",
    "settings": {
      "timeline": {
        "clips": [],
        "aspectRatio": "9:16",
        "resolution": "720p",
        "bgmVolume": 0.8
      }
    },
    "status": "idle",
    "error": null,
    "progress": 0
  }
}
```

Rules:

- `kind` must be `composition`, `modelId` must be `lumen-composition`
- `prompt` is **not required** — leave empty
- Timeline lives in `settings.timeline` (edit state). Engine compiles it at run time.
- Node `output` after success is a **video URL** (stored as video asset, not composition type)

## Timeline Clip Fields

| Field | Meaning |
|---|---|
| `id` | Stable clip id, e.g. `clip-hook` |
| `order` | Sequence index (0, 1, 2…) |
| `sourceNodeId` | Upstream `video` node id — **preferred** URL source at run time |
| `sourceUrlSnapshot` | Optional URL snapshot; omit when upstream outputs will exist |
| `sourceIn` | Trim in-point in seconds on source media |
| `duration` | Used length after trim (seconds) |
| `volume` | Clip volume 0–1 |
| `label` | Optional display label |

URL resolution at run time: `sourceNodeId` output **>** `sourceUrlSnapshot`.

## DAG Pattern

```
video-scene-1 ──┐
video-scene-2 ──┼──> composition-final
audio-bgm     ──┘   (audio optional, for BGM only)
```

Edges:

- Every scene `video` node → `composition` (target handle)
- Optional one `audio` node → `composition` for BGM
- Do **not** connect `text` / `image` directly to `composition`

## Full Canvas Example (2 scenes + final cut)

```json
{
  "nodes": [
    {
      "id": "video-hook",
      "type": "lumenNode",
      "position": { "x": 600, "y": 80 },
      "data": {
        "kind": "video",
        "title": "镜头1 Hook",
        "prompt": "Close-up product reveal, energetic UGC, 9:16",
        "output": null,
        "modelId": "seedance-1.5-pro",
        "settings": { "aspectRatio": "9:16", "duration": 5, "resolution": "720p" },
        "status": "idle",
        "error": null,
        "progress": 0
      }
    },
    {
      "id": "video-cta",
      "type": "lumenNode",
      "position": { "x": 600, "y": 280 },
      "data": {
        "kind": "video",
        "title": "镜头2 CTA",
        "prompt": "Creator holding product, call to action, 9:16",
        "output": null,
        "modelId": "seedance-1.5-pro",
        "settings": { "aspectRatio": "9:16", "duration": 4, "resolution": "720p" },
        "status": "idle",
        "error": null,
        "progress": 0
      }
    },
    {
      "id": "composition-final",
      "type": "lumenNode",
      "position": { "x": 1000, "y": 180 },
      "data": {
        "kind": "composition",
        "title": "最终成片",
        "prompt": "",
        "output": null,
        "modelId": "lumen-composition",
        "settings": {
          "timeline": {
            "clips": [
              {
                "id": "clip-hook",
                "order": 0,
                "sourceNodeId": "video-hook",
                "sourceIn": 0,
                "duration": 5,
                "volume": 1,
                "label": "Hook"
              },
              {
                "id": "clip-cta",
                "order": 1,
                "sourceNodeId": "video-cta",
                "sourceIn": 0,
                "duration": 4,
                "volume": 1,
                "label": "CTA"
              }
            ],
            "aspectRatio": "9:16",
            "resolution": "720p",
            "bgmVolume": 0.8
          }
        },
        "status": "idle",
        "error": null,
        "progress": 0
      }
    }
  ],
  "edges": [
    { "id": "e-hook", "source": "video-hook", "target": "composition-final", "type": "lumenSmooth", "data": {} },
    { "id": "e-cta", "source": "video-cta", "target": "composition-final", "type": "lumenSmooth", "data": {} }
  ]
}
```

## Split Same Source (advanced)

Two clips from one video node — different `sourceIn` / `duration`:

```json
{
  "clips": [
    { "id": "clip-a", "order": 0, "sourceNodeId": "video-main", "sourceIn": 0, "duration": 3, "volume": 1 },
    { "id": "clip-b", "order": 1, "sourceNodeId": "video-main", "sourceIn": 3, "duration": 2.5, "volume": 1 }
  ]
}
```

Engine keeps both segments even when URL is identical.

## Agent Workflow (required order)

1. `use_skill("canvas-core")` if not loaded
2. `use_skill("composition-editing")` for this task
3. `read_canvas` — inspect existing nodes/outputs
4. `write_canvas` — save full canvas with `composition` node + `settings.timeline` + edges
5. `run_canvas_node` each upstream `video` (and `audio` if BGM) until `output` is saved
6. `read_canvas` — confirm upstream outputs exist
7. `run_canvas_node("composition-final")` — render final MP4
8. Reply with the composition node's `output` URL only after step 7 succeeds

## Building Timeline From a Scene Plan

When creating N scenes:

1. Create `video-scene-1` … `video-scene-N` with distinct prompts
2. Add one `composition-final` node to the right
3. Connect every scene video → composition
4. Write one clip per scene in timeline `order` matching desired playback order
5. Set each clip `sourceNodeId` to the matching video node id
6. Set `duration` to the intended used length (match or shorten scene video length)
7. Set `aspectRatio` / `resolution` on timeline (`9:16` + `720p` for short-video default)

If user wants BGM:

1. Add `audio` node with `modelId: suno-music` or `fish-tts` as appropriate
2. Connect `audio` → `composition`
3. Tune `bgmVolume` (default 0.8)

## Editing an Existing Timeline

1. `read_canvas`
2. Locate the `composition` node and its `settings.timeline`
3. Modify `clips` (reorder, change `sourceIn`/`duration`, add/remove clips, split)
4. `write_canvas` with the **complete** canvas JSON
5. Re-run composition only after upstream clips still have valid outputs

## Run Preconditions

Composition will **fail** if:

- `timeline.clips` is empty
- Any clip `sourceNodeId` points to a video without `output`
- Timeline cannot compile to valid URLs

Before running composition, verify every referenced upstream video has `data.output` set.

## Defaults

| Setting | Default | Notes |
|---|---|---|
| `aspectRatio` | `9:16` | TikTok / Reels |
| `resolution` | `720p` | Faster first pass |
| `bgmVolume` | `0.8` | When BGM connected |
| clip `volume` | `1` | Full clip audio |

Use `1080p` only when user explicitly asks for higher export quality.

## Common Mistakes

- Putting clips only in `video` node settings — timeline must be on `composition.settings.timeline`
- Running composition before upstream videos finish
- Forgetting edges from scene videos to composition
- Using `prompt` on composition node (not needed)
- Claiming final video exists before `run_canvas_node` succeeds on composition
