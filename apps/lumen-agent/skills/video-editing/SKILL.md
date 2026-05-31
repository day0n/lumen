---
name: video-editing
description: Build and run Lumen automatic video editing workflows that combine multiple video outputs into a final rendered video.
trigger: video edit, auto edit,剪辑,自动剪辑,合成视频,拼接视频,final video
---

# Lumen Video Editing

Use this skill when the user asks to combine, edit, stitch, concatenate, or
produce a final cut from multiple video clips.

## Core Contract

Automatic editing is a normal `video` node with:

```json
{
  "kind": "video",
  "modelId": "lumen-video-edit",
  "settings": {
    "aspectRatio": "9:16",
    "resolution": "720p"
  }
}
```

`lumen-video-edit` is not an external model. It is Lumen's local engine-side
video editing executor. It consumes upstream video node outputs and returns one
final MP4 workflow result.

## Workflow Pattern

For a final edited short video:

1. Create one video node per scene or source clip.
2. Connect each scene video node into one final `video` node whose `modelId` is
   `lumen-video-edit`.
3. Put the edit node to the right of all source clips and title it clearly, for
   example `最终剪辑成片`.
4. Run missing upstream video nodes first.
5. Run the `lumen-video-edit` node last.

The editor collects direct upstream `video` outputs in edge order. Do not connect
image nodes directly to the final edit node unless there is also a video node
that turns the image into motion.

## Settings

Recommended defaults:

```json
{
  "aspectRatio": "9:16",
  "resolution": "720p"
}
```

Supported aspect ratios:

- `9:16` for TikTok/Reels/short-video output.
- `16:9` for landscape.
- `1:1` for square.
- `4:5` for feed-style vertical.

Supported edit resolutions:

- `720p` by default. Prefer this for fast first-pass editing.
- `1080p` only when the user explicitly asks for higher quality.

The engine enforces safety limits on clip count, duration, and input file size.
If an edit fails because it is too long or too large, reduce the number of clips
or shorten the source video nodes.

## Running Rules

- Load `canvas-core` as usual before reading, writing, or running the canvas.
- Use `write_canvas` to save the full DAG before running anything.
- Use `run_canvas_node` one node at a time.
- Never claim the final cut exists until `run_canvas_node` succeeds for the
  `lumen-video-edit` node and returns a video URL.
- If the user only asks for a plan, do not run nodes. If the user asks to produce
  the result, run upstream dependencies and then the edit node.
