## ADDED Requirements

### Requirement: The organization hierarchy renders as a pannable graph
The system SHALL render the organization → site → device-group hierarchy as a
node graph on a pannable, zoomable canvas, rather than as a nested
expand/collapse list. Nested sites (a site's `children`) SHALL be drawn at their
correct depth, so a multi-level site structure is visible in one view instead of
requiring the user to expand each level.

The canvas SHALL NOT render a minimap. At the graph sizes this page produces it
covers real nodes and navigates nothing that panning and zoom-to-fit do not
already reach.

Node positions SHALL be computed deterministically from tree depth and leaf order
at render time. No layout is persisted and no external graph-layout dependency is
introduced — the structure is a strict shallow tree, not a general DAG.

#### Scenario: A tenant with nested sites
- **WHEN** a user opens the hierarchy page for a tenant whose sites have child
  sites and device groups
- **THEN** organizations, sites at every nesting level, and device groups are all
  drawn as connected nodes at their correct depth, and the view fits them on load

#### Scenario: Panning and zooming a large hierarchy
- **WHEN** the hierarchy is larger than the viewport
- **THEN** the user can pan the canvas, zoom in and out, and zoom to fit the
  whole graph, rather than scrolling a long list

### Requirement: Hierarchy node health signalling and selection are preserved
The system SHALL preserve the existing behaviour of the hierarchy page across the
change in rendering: each node SHALL carry the same health indication it does
today — red when active alarms are present, amber when fewer than 80% of its
devices are online, green otherwise — along with its device count, online count,
and active-alarm badge.

Selecting a node SHALL populate the existing detail sidebar with that
organization, site, or device group, unchanged. The existing search SHALL narrow
the set of nodes drawn, together with any edges referencing a removed node.

#### Scenario: Selecting a site node
- **WHEN** a user clicks a site node on the canvas
- **THEN** the detail sidebar shows that site's details exactly as it does when
  the corresponding tree row is clicked today

#### Scenario: Searching within the hierarchy
- **WHEN** a user types a query that matches a subset of the hierarchy
- **THEN** only matching nodes remain on the canvas, with no edges left pointing
  at nodes that are no longer drawn
