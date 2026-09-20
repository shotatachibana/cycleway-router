package com.conveyal.r5.streets;

import com.conveyal.osmlib.Way;

/**
 * cycleway-router project: reads plain standard OSM tags (no external data injection required, unlike
 * LaDotCostTags) to classify a way as dedicated cycleway infrastructure or general road.
 * See CLAUDE.md "専用道路の定義" and src/r5_custom_cost/instruction.md for the policy this implements.
 */
public class JapanCycleCostTags {

    final boolean isDedicatedCycleway;
    final boolean isSeparatedTrack;
    final String highway;

    public JapanCycleCostTags (Way way) {
        highway = nullToEmpty(way.getTag("highway"));
        isDedicatedCycleway = "cycleway".equals(highway);
        isSeparatedTrack = "track".equals(way.getTag("cycleway"))
                || "track".equals(way.getTag("cycleway:left"))
                || "track".equals(way.getTag("cycleway:right"))
                || "track".equals(way.getTag("cycleway:both"));
    }

    boolean isDedicatedOrSeparated () {
        return isDedicatedCycleway || isSeparatedTrack;
    }

    private static String nullToEmpty (String s) {
        return s == null ? "" : s;
    }
}
