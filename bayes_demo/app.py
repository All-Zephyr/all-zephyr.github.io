"""Interactive Bayes theorem game: is Newtonian gravity true?"""

from __future__ import annotations

import math
import random

import matplotlib.pyplot as plt
import streamlit as st

from bayes import EvidenceModel, bayes_update

st.set_page_config(page_title="Bayes Gravity Game", page_icon="🧠", layout="wide")

st.title("🧠 Bayes Gravity Game")
st.caption(
    "Use repeated ball-drop evidence to update your belief in Newton's law of gravitation."
)

with st.expander("How this game works", expanded=True):
    st.markdown(
        """
- **Hypothesis H**: Newtonian gravity correctly predicts ball-drop behavior.
- Each round gives one piece of evidence (**match** or **mismatch** vs prediction).
- You start with any prior `0 < P(H) < 1`.
- Bayes update computes the new belief `P(H|E)`.

If evidence is consistently more likely under `H` than under `not H`, the posterior tends to move toward 1.
        """
    )

left, right = st.columns([1, 1])

with left:
    st.subheader("1) Choose your assumptions")
    prior = st.slider("Initial belief P(H)", min_value=0.01, max_value=0.99, value=0.50)
    p_match_given_h = st.slider(
        "P(match evidence | H is true)",
        min_value=0.50,
        max_value=0.999,
        value=0.95,
        step=0.001,
    )
    p_match_given_not_h = st.slider(
        "P(match evidence | H is false)",
        min_value=0.001,
        max_value=0.499,
        value=0.20,
        step=0.001,
    )
    auto_rounds = st.slider("Auto-run rounds", min_value=1, max_value=200, value=20)

    if p_match_given_h <= p_match_given_not_h:
        st.error("For learning convergence, choose P(match|H) > P(match|not H).")

with right:
    st.subheader("2) Hidden world settings")
    world_truth = st.radio(
        "Reality for this run (can be hidden from player)",
        options=["H is true", "H is false"],
        index=0,
    )
    reveal_truth = st.checkbox("Reveal world truth", value=True)
    seed = st.number_input("Random seed", min_value=0, value=42, step=1)
    if reveal_truth:
        st.info(f"World state: **{world_truth}**")

if "history" not in st.session_state:
    st.session_state.history = [prior]
    st.session_state.events = []
    st.session_state.current_prior = prior
    st.session_state.saved_prior = prior

if not math.isclose(st.session_state.saved_prior, prior, rel_tol=0, abs_tol=1e-12):
    st.session_state.history = [prior]
    st.session_state.events = []
    st.session_state.current_prior = prior
    st.session_state.saved_prior = prior

model = EvidenceModel(
    p_match_given_h=p_match_given_h,
    p_match_given_not_h=p_match_given_not_h,
)

rng = random.Random(seed + len(st.session_state.events))

controls = st.columns([1, 1, 2])

with controls[0]:
    single = st.button("Run one drop")
with controls[1]:
    batch = st.button(f"Run {auto_rounds} drops")
with controls[2]:
    reset = st.button("Reset")

if reset:
    st.session_state.history = [prior]
    st.session_state.events = []
    st.session_state.current_prior = prior


def sample_match() -> bool:
    if world_truth == "H is true":
        return rng.random() < p_match_given_h
    return rng.random() < p_match_given_not_h


def apply_update(observed_match: bool) -> None:
    posterior = bayes_update(st.session_state.current_prior, observed_match, model)
    st.session_state.current_prior = posterior
    st.session_state.history.append(posterior)
    st.session_state.events.append(observed_match)


if single:
    apply_update(sample_match())

if batch:
    for _ in range(auto_rounds):
        apply_update(sample_match())

st.subheader("3) Posterior over time")
fig, ax = plt.subplots(figsize=(9, 4))
ax.plot(st.session_state.history, marker="o", linewidth=2)
ax.set_ylim(0, 1)
ax.set_xlabel("Evidence count")
ax.set_ylabel("P(H)")
ax.grid(alpha=0.3)
st.pyplot(fig)

last = st.session_state.history[-1]
st.metric("Current posterior P(H|evidence)", f"{last:.6f}")

if st.session_state.events:
    match_count = sum(st.session_state.events)
    total = len(st.session_state.events)
    st.write(
        f"Observed matches: **{match_count}/{total}** "
        f"({100 * match_count / total:.1f}%)"
    )

st.markdown("---")
st.markdown(
    """
### Why this demonstrates your idea
- If your prior is strictly between 0 and 1, Bayes can keep updating.
- If evidence is repeatedly more compatible with truth than falsehood,
  posterior probability tends to concentrate toward the true hypothesis.
- In finite runs, noise can cause wiggles; long-run trend is what matters.
"""
)
