import type { ClipSort } from "../../lib/appTypes";
import { formatClock } from "./formatClock";
import type { RecordingsPaneProps } from "./types";

export function RecordingsPane(props: RecordingsPaneProps): JSX.Element {
  const {
    isAlwaysOnEnabled,
    isRealtimeRunning,
    onToggleRealtime,
    clipSearch,
    onChangeClipSearch,
    clipCategoryFilter,
    onChangeClipCategoryFilter,
    clipSort,
    onChangeClipSort,
    clipCategories,
    filteredClips,
    selectedClipId,
    onSelectClip,
    manifestStatus,
    onRefreshManifest,
  } = props;

  return (
    <aside className="recordingsPane">
      <div className="recordingsToolbar">
        <button className="recordAction" onClick={onToggleRealtime}>
          {isRealtimeRunning ? "Pause" : isAlwaysOnEnabled ? "Listening" : "Enable Live"}
        </button>
      </div>

      <label className="field">
        <span>Filter</span>
        <input
          value={clipSearch}
          onChange={event => onChangeClipSearch(event.target.value)}
          placeholder="Filter by category, text, title..."
        />
      </label>

      <div className="finderControls compact">
        <label className="field">
          <span>Category</span>
          <select value={clipCategoryFilter} onChange={event => onChangeClipCategoryFilter(event.target.value)}>
            <option value="all">All Categories</option>
            {clipCategories.map(category => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Sort</span>
          <select value={clipSort} onChange={event => onChangeClipSort(event.target.value as ClipSort)}>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="title">Title A-Z</option>
          </select>
        </label>
      </div>

      <div className="clipListCompact listMode">
        {filteredClips.length === 0 && <p className="status">No saved recordings match the current filter.</p>}
        {filteredClips.map(clip => (
          <button
            key={clip.id}
            className={`clipItemButton ${selectedClipId === clip.id ? "active" : ""}`}
            onClick={() => onSelectClip(clip.id)}
          >
            <strong>{clip.title}</strong>
            <span>
              {new Date(clip.createdAtMs).toLocaleTimeString()} | {formatClock(clip.durationMs)}
            </span>
            <span>{clip.categories.join(" • ") || "uncategorized"}</span>
          </button>
        ))}
      </div>

      <div className="paneStatusRow">
        <span>{manifestStatus}</span>
        <button className="textButton" onClick={onRefreshManifest}>
          Refresh
        </button>
      </div>
    </aside>
  );
}
