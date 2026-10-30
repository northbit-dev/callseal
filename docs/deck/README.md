# Deck and demo video

* `deck.html` is the source of [`../deck.pdf`](../deck.pdf): 8 slides, 1920×1080.
* `record-demo.cjs` records [`../demo.mp4`](../demo.mp4) from the live demo with captions injected into the page.

Both need Playwright (`npm i playwright`), which is not a project dependency.

```bash
node docs/deck/render.cjs docs/deck/deck.html docs/deck.pdf /tmp/deck-png
node docs/deck/record-demo.cjs        # writes vid/*.webm and meta.json
ffmpeg -ss 0.7 -i vid/<file>.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -r 30 -movflags +faststart -an docs/demo.mp4
```
