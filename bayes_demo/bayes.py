"""Bayesian update helpers for the gravity evidence game."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EvidenceModel:
    """Likelihood model for one observed ball drop."""

    p_match_given_h: float
    p_match_given_not_h: float


def bayes_update(prior_h: float, observed_match: bool, model: EvidenceModel) -> float:
    """Return P(H|E) from prior P(H) and one evidence observation.

    Args:
        prior_h: P(H) before observing evidence.
        observed_match: True if the drop matches Newtonian prediction.
        model: Conditional probabilities for a matching observation.
    """

    if not 0 < prior_h < 1:
        raise ValueError("prior_h must be strictly between 0 and 1")

    p_e_given_h = model.p_match_given_h if observed_match else 1 - model.p_match_given_h
    p_e_given_not_h = (
        model.p_match_given_not_h
        if observed_match
        else 1 - model.p_match_given_not_h
    )

    numerator = p_e_given_h * prior_h
    denominator = numerator + (p_e_given_not_h * (1 - prior_h))

    if denominator == 0:
        raise ValueError("Evidence model produced zero denominator")

    return numerator / denominator
