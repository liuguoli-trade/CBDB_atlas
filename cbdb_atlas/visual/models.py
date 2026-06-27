from __future__ import annotations

MAX_GRAPH_NODES = 120
MAX_EXPLORE_PERSONS = 10
MAX_EXPLORE_DEPTH = 8
DEFAULT_EXPLORE_DEPTH = 6
EXPLORE_CONFIRM_THRESHOLD = 3

GRAPH_KINDS = frozenset({"all", "kinship", "association"})
EXPLORE_STRATEGIES = frozenset({"pairwise_shortest"})
