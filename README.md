# all-zephyr.github.io
Personal Website

## Escher recursion helper

You can generate an Escher-style recursive image with:

```bash
python3 scripts/escher_recursion.py \
  --input /path/to/source.png \
  --output /path/to/output.png \
  --center 567 289 \
  --branch-dir 160 \
  --q 22.5836845286 \
  --zoom 0.95
```

Tips:
- `--center` should be the laptop screen center.
- `--branch-dir` steers where the recursion opens (try `145..180`).
- `--zoom` typically works in `0.90..1.05`.

## Browser version (no terminal)

If terminal use is difficult, open `escher.html` in the site and use the in-browser tool:
- Upload an image.
- Click the laptop center on the canvas.
- Adjust `Branch Dir`/`Zoom`.
- Click **Render** and then **Download PNG**.
