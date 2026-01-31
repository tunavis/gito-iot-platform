# ADR-002: React-Grid-Layout for Dashboard Builder

**Last Updated: 2026-01-31**

---

## Status

**Accepted** ✅

## Context

Gito IoT needs a professional **drag-and-drop dashboard builder** where users can:
- Create custom dashboards
- Add widgets (KPI cards, charts, gauges, maps)
- Drag and resize widgets
- Save layouts per user
- Support responsive grid (desktop, tablet, mobile)

### Requirements
- Industry-standard drag-and-drop UX
- Responsive grid system
- TypeScript support
- Mature, well-maintained library
- Low bundle size impact
- Compatible with React 18 + Next.js 14

### Current Situation
Building from scratch, need to choose a grid layout library for the dashboard builder MVP (Iteration 1).

## Decision

Use **react-grid-layout** (v1.4.4) as the foundation for the dashboard builder.

**Installation:**
```json
{
  "dependencies": {
    "react-grid-layout": "^1.4.4"
  },
  "devDependencies": {
    "@types/react-grid-layout": "^1.3.5"
  }
}
```

**Implementation pattern:**
```typescript
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

<ResponsiveGridLayout
  layouts={layouts}
  breakpoints={{ lg: 1200, md: 996, sm: 768 }}
  cols={{ lg: 12, md: 10, sm: 6 }}
  isDraggable={isEditMode}
  isResizable={isEditMode}
  onLayoutChange={handleLayoutChange}
>
  {widgets.map(widget => (
    <div key={widget.id}>
      <WidgetComponent {...widget} />
    </div>
  ))}
</ResponsiveGridLayout>
```

## Consequences

### Positive Consequences ✅
- **Industry standard:** Used by Grafana, Metabase, similar platforms
- **Mature:** 10+ years development, battle-tested
- **Feature complete:** Drag, drop, resize, responsive built-in
- **TypeScript support:** Full type definitions available
- **Customizable:** Can control drag handles, resize handles
- **Performance:** Handles 100+ widgets smoothly
- **Active maintenance:** Regular updates, bug fixes
- **Great DX:** Simple API, good documentation

### Negative Consequences / Trade-offs ⚠️
- **Bundle size:** ~50KB (acceptable for dashboard page)
- **CSS import required:** Need to import 2 CSS files
- **Learning curve:** Some API quirks (e.g., grid units vs pixels)
- **Layout complexity:** Need to manage breakpoints manually
- **Dependency:** Relying on external library for core feature

### Neutral / Unknown 📝
- May need custom CSS for specific use cases
- Performance with 500+ widgets untested (but unlikely scenario)

## Alternatives Considered

### Alternative 1: Build Custom Grid System
**Description:** Implement drag-and-drop from scratch with HTML5 Drag API

**Pros:**
- Full control over behavior
- No external dependency
- Exact UX we want
- Smaller bundle size (only what we need)

**Cons:**
- **2-3 weeks development time** vs 2 days with library
- Complex edge cases (touch events, resize conflicts)
- Need to handle responsive ourselves
- Reinventing the wheel
- Bugs to discover and fix
- Maintenance burden

**Why not chosen:** Not worth the development time. react-grid-layout is proven and feature-complete.

### Alternative 2: react-draggable + react-resizable (Raw)
**Description:** Use low-level draggable/resizable libraries directly

**Pros:**
- More control than react-grid-layout
- Lighter weight
- Flexible positioning

**Cons:**
- No grid snapping out of box
- Need to implement collision detection
- Need to implement responsive breakpoints
- More code to write and maintain
- Still external dependencies

**Why not chosen:** react-grid-layout builds on these libraries and adds the grid logic we need.

### Alternative 3: react-mosaic
**Description:** Alternative tiling window manager for React

**Pros:**
- Different layout paradigm
- Good for tiled layouts

**Cons:**
- Less popular (fewer maintainers)
- More opinionated UI (harder to customize)
- Not ideal for free-form dashboards
- Smaller community

**Why not chosen:** react-grid-layout better fits dashboard use case.

### Alternative 4: gridstack.js (with React wrapper)
**Description:** jQuery-based grid library with React wrapper

**Pros:**
- Very mature
- Powerful features

**Cons:**
- **jQuery dependency** in 2026 (avoid)
- Wrapper adds complexity
- Heavier bundle size
- Not React-native

**Why not chosen:** Modern React app shouldn't depend on jQuery.

## Implementation Notes

### Incremental Rollout
**Iteration 1 (Current):**
- Basic grid with drag/drop
- Single widget type (KPI Card)
- Desktop-first, responsive later

**Iteration 2:**
- Add more widget types
- Responsive breakpoints
- Mobile optimization

**Iteration 3:**
- Advanced features (widget locking, grid snapping settings)

### Key Configuration
```typescript
// Grid settings
const GRID_CONFIG = {
  breakpoints: { lg: 1200, md: 996, sm: 768, xs: 480 },
  cols: { lg: 12, md: 10, sm: 6, xs: 4 },
  rowHeight: 80,
  compactType: 'vertical' as const,
};

// Prevent dragging on specific elements
draggableCancel="button, input, select, textarea"
```

### CSS Customization
```css
/* Override default react-grid-layout styles */
.react-grid-item.react-grid-placeholder {
  background: rgb(59, 130, 246);
  opacity: 0.2;
  border-radius: 0.5rem;
}

.react-grid-item.resizing {
  z-index: 100;
  will-change: width, height;
}
```

### Performance Tips
- Use `width` and `height` in grid units (not pixels)
- Set `static: true` on widgets that shouldn't move
- Use `compactType: 'vertical'` for better auto-layout
- Lazy load widget content (not the grid items themselves)

## References

- [react-grid-layout GitHub](https://github.com/react-grid-layout/react-grid-layout)
- [Live Demo](https://react-grid-layout.github.io/react-grid-layout/examples/0-showcase.html)
- Implementation: `web/src/components/DashboardBuilder/DashboardGrid.tsx`
- Related: ADR-003 will cover widget component architecture

---

## Changelog

- 2026-01-31: Initial draft (Proposed)
- 2026-01-31: Accepted and implemented in Iteration 1
