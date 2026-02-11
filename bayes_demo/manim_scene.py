"""Optional Manim scene for a 3Blue1Brown-style visual introduction."""

from manim import UP, Axes, MathTex, Scene, ValueTracker, always_redraw


class BayesConvergenceScene(Scene):
    def construct(self):
        title = MathTex(r"P(H\mid E)=\frac{P(E\mid H)P(H)}{P(E)}").to_edge(UP)
        self.play(title.animate.scale(0.9))

        axes = Axes(
            x_range=[0, 50, 10],
            y_range=[0, 1, 0.2],
            x_length=9,
            y_length=4,
            tips=False,
        ).shift(0.5)
        labels = axes.get_axis_labels("drops", "P(H)")

        tracker = ValueTracker(0)

        curve = always_redraw(
            lambda: axes.plot(
                lambda x: 1 - 0.92 ** x,
                x_range=[0, tracker.get_value()],
                color="#58C4DD",
            )
        )

        self.play(*[obj.animate for obj in [axes, labels]])
        self.add(curve)
        self.play(tracker.animate.set_value(50), run_time=6)
        self.wait(1)
