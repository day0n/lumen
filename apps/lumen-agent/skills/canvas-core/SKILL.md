---
name: canvas-core
description: Build, edit, and run Lumen Studio workflows on the canvas.
trigger: workflow, canvas, video generation, write_canvas, run_canvas_node
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

Default production-backed models:

- `text`: `gemini-3.5-flash`
- `image`: `nano-banana2`
- `video`: `veo-3.1`
- `audio`: `fish-tts`

Avoid placeholder / non-production models such as `doubao-seed-2.0-pro`,
`doubao-seedream-3.0`, `seedance-1.5-pro`, and `doubao-tts` unless the user
explicitly asks for them.

For final automatic video editing, use the internal `video` model id
`lumen-video-edit`. This is Lumen's own engine-side editor, not an external
generation model.

## Editing Rules

- Use `write_canvas` for structural changes and pass the complete canvas JSON.
- Preserve nodes and edges that the user did not ask to delete.
- Keep ids stable when modifying existing nodes.
- Use readable ids with kind prefixes, for example `text-script-...`, `image-storyboard-...`, `video-final-...`.
- Do not create dangling edges.
- Do not create cycles.
- Use left-to-right positions: strategy/script nodes on the left, image nodes in the middle, video/audio nodes on the right.
- For a one-sentence video request, build a practical pipeline rather than only answering with a script.

## Complex Workflow Design

For complex user goals, build a runnable DAG instead of a single long prompt.

Typical layers:

1. Input / source nodes: product brief, URL notes, reference media summary.
2. Strategy nodes: audience, pain points, selling angles, offer.
3. Script nodes: hook, short spoken script, captions, CTA.
4. Visual nodes: one or more image nodes for key frames or scenes.
5. Motion nodes: one video node per important scene or final video output.
6. Audio nodes: voiceover, sound style, or music notes when needed.
7. Final edit node: for multi-clip output, add one rightmost `video` node with
   `modelId: "lumen-video-edit"` and connect every source video clip to it.

Rules:

- Split work when intermediate outputs are useful to inspect or reuse.
- Connect every node through explicit edges so downstream nodes receive upstream output.
- Give image/video nodes concise direct prompts. Upstream text is useful context,
  but the media node prompt must still stand on its own.
- Do not create orphan nodes unless they are deliberate alternatives and clearly titled.
- Prefer 6-12 nodes for a complex product-video workflow; use more only when the user asks for variants, multiple scenes, or batch output.
- Put related nodes on the same horizontal band and use readable titles, for example `卖点策略`, `15秒口播`, `镜头1主视觉`, `镜头1视频`.

## Single-Node Running

Use `run_canvas_node` to execute exactly one node.

Important:

- `use_skill` is only preparation. It never satisfies a run request.
- For every run request, call `read_canvas` after loading this skill and inspect the current canvas.
- Run upstream nodes first. A node can only run if all direct upstream nodes already have `data.output`.
- After a node succeeds, its output is saved back to the canvas by the tool.
- If a node fails, summarize the failure and decide whether to edit the node or ask the user.
- Do not call `run_canvas_node` for a downstream video node until its image/text inputs are ready.
- For a complex workflow, run nodes in topological order. After each successful run, treat the saved canvas output as the source of truth before choosing the next node.
- If a node fails, stop the run plan, explain the failed node, and either edit that node or ask the user for the missing input.
- Do not claim a node has run unless `run_canvas_node` returned success for that node in the current request.
- If the user says "run until node X", run all missing upstream dependencies for X first, one node per tool call, then run X.

Typical order for a product video:

1. `text` node: product strategy or short script.
2. `image` node: key visual / storyboard frame.
3. `video` node: animate the image or create video from prompt.
4. Optional `audio` node: voiceover or music.

## Tool Use Pattern

Before editing an existing project:

1. Call `read_canvas`.
2. Build the full updated canvas JSON.
3. Call `write_canvas`.
4. If the user asked to generate assets, call `run_canvas_node` one node at a time.

When the user asks for "一句话产出视频", create a small but runnable canvas and run nodes in order.

When the user asks for a complex end-to-end workflow, create the canvas first, then run one ready node at a time until the requested stopping point is reached.
