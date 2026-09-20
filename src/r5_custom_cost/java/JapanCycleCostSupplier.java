package com.conveyal.r5.streets;

/**
 * cycleway-router project: prefers dedicated cycleways / separated tracks over general roads.
 * Unlike LaDotBikeCostSupplier, this needs no external traffic/slope data - only standard OSM tags
 * (see JapanCycleCostTags). Implements the policy from CLAUDE.md "専用道路の定義" (iii):
 * dedicated cycleway infrastructure is traversed at its real distance; general roads are scaled up
 * by a penalty factor so that shortest-path search naturally minimizes general-road usage. R5 has no
 * native mechanism for a hard cap on total general-road distance, so this is a soft (multiplicative)
 * penalty only - see instruction.md for the reasoning and the follow-up post-hoc length check.
 */
public class JapanCycleCostSupplier implements SingleModeTraversalTimes.Supplier {

    /**
     * Default multiplier applied to general-road distance relative to dedicated cycleway infrastructure.
     * Tunable without recompiling via -DjapanCycle.generalRoadPenalty=<double>. Not yet confirmed with
     * the project owner - see instruction.md "確認してほしいこと".
     */
    public static final double DEFAULT_GENERAL_ROAD_PENALTY =
            Double.parseDouble(System.getProperty("japanCycle.generalRoadPenalty", "5.0"));

    private final JapanCycleCostTags tags;

    public JapanCycleCostSupplier (JapanCycleCostTags tags) {
        this.tags = tags;
    }

    @Override
    public double perceivedLengthMultipler () {
        if (tags.isDedicatedOrSeparated()) {
            return 1.0;
        }
        return DEFAULT_GENERAL_ROAD_PENALTY;
    }

    @Override
    public int turnTimeSeconds (SingleModeTraversalTimes.TurnDirection turnDirection) {
        // Signal/crossing turn penalties are a future extension (see CLAUDE.md 「専用道路の定義」
        // の交差点の短い横断の扱い); not modeled yet.
        return 0;
    }
}
