import {
  isConfirmView,
  isPositionView,
  isRecord,
  lightRowToView,
  type ConfirmView,
  type PositionView,
} from "./cards";

export type PanelState = {
  positions: PositionView[];
  selectedId?: string;
  selected?: PositionView;
  projection?: PositionView;
  confirm?: ConfirmView;
  loadError?: string;
};

export const emptyPanel: PanelState = { positions: [] };

export function unwrapToolOutput(output: unknown): Record<string, unknown> {
  if (typeof output === "string") {
    try {
      const parsed: unknown = JSON.parse(output);
      if (isRecord(parsed)) return unwrapToolOutput(parsed);
    } catch {
      return {};
    }
  }
  if (!isRecord(output)) return {};
  if (isRecord(output.result)) return unwrapToolOutput(output.result);
  if (
    isRecord(output.value) &&
    ("receipt" in output.value ||
      "positions" in output.value ||
      "view" in output.value ||
      "projection" in output.value ||
      "card" in output.value)
  ) {
    return output.value;
  }
  return output;
}

function upsert(positions: PositionView[], view: PositionView): PositionView[] {
  if (!view.tokenId) return positions;
  const idx = positions.findIndex((p) => p.tokenId === view.tokenId);
  if (idx === -1) return [...positions, view];
  const next = positions.slice();
  next[idx] = { ...next[idx], ...view };
  return next;
}

export function applyToolOutput(state: PanelState, toolName: string | undefined, output: unknown): PanelState {
  const data = unwrapToolOutput(output);
  const next: PanelState = { ...state, loadError: undefined };

  if (Array.isArray(data.positions)) {
    const views = data.positions
      .map((row) => (isRecord(row) ? lightRowToView(row) : null))
      .filter((row): row is PositionView => Boolean(row));
    next.positions = views;
    if (!next.selected && views[0]) {
      next.selected = views[0];
      next.selectedId = views[0].tokenId;
    } else if (next.selectedId) {
      const match = views.find((v) => v.tokenId === next.selectedId);
      if (match) next.selected = match;
    }
  }

  if (isPositionView(data.view) && data.view.kind === "live") {
    next.selected = data.view;
    next.selectedId = data.view.tokenId;
    next.positions = upsert(next.positions, data.view);
  }

  if (isPositionView(data.projection)) {
    next.projection = data.projection;
    if (!next.selected && data.projection.kind === "projected") {
      next.selected = { ...data.projection, kind: "live" };
    }
  } else if (isPositionView(data.view) && data.view.kind === "projected") {
    next.projection = data.view;
  }

  if (isConfirmView(data.confirm)) {
    next.confirm = data.confirm;
  }

  if (toolName === "mint" || toolName === "range") {
    if (isPositionView(data.view) && data.view.kind === "projected") {
      next.projection = data.view;
    }
  }

  return next;
}

export function applyStatusView(state: PanelState, view: PositionView): PanelState {
  return {
    ...state,
    selected: view,
    selectedId: view.tokenId,
    positions: upsert(state.positions, view),
  };
}

export function applyListPayload(state: PanelState, payload: unknown): PanelState {
  if (!isRecord(payload)) return state;
  const error = typeof payload.error === "string" ? payload.error : undefined;
  const rows = Array.isArray(payload.positions) ? payload.positions : [];
  const views = rows
    .map((row) => (isRecord(row) ? lightRowToView(row) : null))
    .filter((row): row is PositionView => Boolean(row));
  const selected = state.selectedId ? views.find((v) => v.tokenId === state.selectedId) : views[0];
  return {
    ...state,
    positions: views,
    selected: selected ?? state.selected,
    selectedId: selected?.tokenId ?? state.selectedId,
    loadError: error,
  };
}
