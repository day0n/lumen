---
name: workflow-core
description: Build, edit, and run Lumen Studio workflows on the canvas.
trigger: workflow, canvas, video generation, edit_workflow, run_workflow_node
---

# Lumen Workflow Core

Use this skill before creating, editing, or running a Lumen Studio canvas.

## Canvas Model

A canvas is a JSON object:

```json
{
  "nodes": [
    {
      "id": "text-unique-id",
      "type": "lumenNode",
      "position": { "x": 0, "y": 0 },
      "data": {
        "kind": "text",
        "title": "Script",
        "prompt": "Write a short UGC script...",
        "output": null,
        "modelId": "gemini-3.5-flash",
        "settings": {},
        "status": "idle",
        "error": null,
        "progress": 0
      }
    }
  ],
  "edges": [
    { "id": "edge-id", "source": "text-unique-id", "target": "image-unique-id", "type": "lumenSmooth", "data": {} }
  ]
}
```

Supported node kinds: `text`, `image`, `video`, `audio`.

Default models:

- `text`: `gemini-3.5-flash` or `doubao-seed-2.0-pro`
- `image`: `nano-banana2` or `doubao-seedream-3.0`
- `video`: `veo-3.1` or `seedance-1.5-pro`
- `audio`: `fish-tts` or `doubao-tts`

## Editing Rules

- Use `edit_workflow` for structural changes and pass the complete canvas JSON.
- Preserve nodes and edges that the user did not ask to delete.
- Keep ids stable when modifying existing nodes.
- Use readable ids with kind prefixes, for example `text-script-...`, `image-storyboard-...`, `video-final-...`.
- Do not create dangling edges.
- Do not create cycles.
- Use left-to-right positions: strategy/script nodes on the left, image nodes in the middle, video/audio nodes on the right.
- For a one-sentence video request, build a practical pipeline rather than only answering with a script.

## Single-Node Running

Use `run_workflow_node` to execute exactly one node.

Important:

- Run upstream nodes first. A node can only run if all direct upstream nodes already have `data.output`.
- After a node succeeds, its output is saved back to the canvas by the tool.
- If a node fails, summarize the failure and decide whether to edit the node or ask the user.
- Do not call `run_workflow_node` for a downstream video node until its image/text inputs are ready.

Typical order for a product video:

1. `text` node: product strategy or short script.
2. `image` node: key visual / storyboard frame.
3. `video` node: animate the image or create video from prompt.
4. Optional `audio` node: voiceover or music.

## Tool Use Pattern

Before editing an existing project:

1. Call `get_workflow`.
2. Build the full updated canvas JSON.
3. Call `edit_workflow`.
4. If the user asked to generate assets, call `run_workflow_node` one node at a time.

When the user asks for "一句话产出视频", create a small but runnable canvas and run nodes in order.
