# Bayes Gravity Game (Local Python Project)

This folder is a standalone local project so you can prototype a Bayes theorem game
without changing the current allzephyr.com site.

## What it demonstrates

- Hypothesis `H`: Newtonian gravity predicts ball-drop outcomes.
- You pick any prior `0 < P(H) < 1`.
- Each observed drop is treated as evidence.
- Bayes updates `P(H)` after each drop.
- Over many rounds, when evidence is more likely if `H` is true than false,
  the posterior trends toward the true state.

## Quick start

```bash
cd bayes_demo
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Then open the local URL shown by Streamlit (usually `http://localhost:8501`).

## High-quality animation path (3Blue1Brown style)

A starter Manim scene is included:

```bash
pip install manim
manim -pql manim_scene.py BayesConvergenceScene
```

Use the Streamlit app for interaction and Manim renders for polished clips.

## Suggested development roadmap

1. Keep tuning the game mechanics in `app.py`.
2. Add narrative text/tooltips for non-technical audiences.
3. Export short Manim clips and embed them into the app later.
4. When ready, decide deployment strategy for allzephyr.com.
