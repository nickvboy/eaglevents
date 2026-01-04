"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type CompanyOverview = RouterOutputs["admin"]["companyOverview"];
type DepartmentNode = CompanyOverview["departments"]["roots"][number];

type BusinessType = "university" | "nonprofit" | "corporation" | "government" | "venue" | "other";

type BuildingFormState = {
  name: string;
  acronym: string;
  roomField: string;
};

type NodePosition = {
  x: number;
  y: number;
};

type HandleSide = "top" | "right" | "bottom" | "left";

type SnapTarget = { id: number; handle: NodePosition; side: HandleSide; distance: number };

type ConnectorDrag = {
  fromId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  fromSide: HandleSide;
};

const businessTypes: Array<{ value: BusinessType; label: string }> = [
  { value: "university", label: "University" },
  { value: "nonprofit", label: "Non-profit" },
  { value: "corporation", label: "Corporation" },
  { value: "government", label: "Government" },
  { value: "venue", label: "Venue / Facility" },
  { value: "other", label: "Other" },
];

function renderDepartmentRows(
  nodes: DepartmentNode[],
  renderRow: (node: DepartmentNode, depth: number) => ReactElement,
  depth = 0,
): ReactElement[] {
  return nodes.flatMap((node) => [
    renderRow(node, depth),
    ...(node.children?.length ? renderDepartmentRows(node.children, renderRow, depth + 1) : []),
  ]);
}

const NODE_WIDTH = 190;
const NODE_HEIGHT = 72;
const X_GAP = 240;
const Y_GAP = 110;
const ROOT_DROP_HEIGHT = 46;
const CONNECT_SNAP_DISTANCE = 140;
const COMPANY_NODE_ID = 0;

export function CompanyView() {
  const { data, isLoading, isError, refetch } = api.admin.companyOverview.useQuery(undefined, {
    staleTime: 30_000,
  });
  const utils = api.useUtils();
  const invalidateCompany = async () => {
    await utils.admin.companyOverview.invalidate();
  };

  const updateBusiness = api.admin.updateBusiness.useMutation({ onSuccess: invalidateCompany });
  const createBuilding = api.admin.createBuilding.useMutation({ onSuccess: invalidateCompany });
  const updateBuilding = api.admin.updateBuilding.useMutation({
    onSuccess: async () => {
      await invalidateCompany();
      await refetch();
    },
  });
  const deleteBuilding = api.admin.deleteBuilding.useMutation({ onSuccess: invalidateCompany });
  const createRoom = api.admin.createRoom.useMutation({
    onSuccess: async () => {
      await invalidateCompany();
      await refetch();
    },
  });
  const updateRoom = api.admin.updateRoom.useMutation({
    onSuccess: async () => {
      await invalidateCompany();
      await refetch();
    },
  });
  const deleteRoom = api.admin.deleteRoom.useMutation({ onSuccess: invalidateCompany });
  const createDepartment = api.admin.createDepartment.useMutation({ onSuccess: invalidateCompany });
  const updateDepartment = api.admin.updateDepartment.useMutation({ onSuccess: invalidateCompany });
  const deleteDepartment = api.admin.deleteDepartment.useMutation({ onSuccess: invalidateCompany });
  const { data: calendars } = api.calendar.listManageable.useQuery();
  const { data: calendarScopeOptions } = api.calendar.scopeOptions.useQuery();
  const updateCalendar = api.calendar.update.useMutation({
    onSuccess: async () => {
      await utils.calendar.listAccessible.invalidate();
    },
  });
  const deleteCalendar = api.calendar.delete.useMutation({
    onSuccess: async () => {
      await utils.calendar.listAccessible.invalidate();
      await utils.calendar.listManageable.invalidate();
    },
  });
  const restoreCalendar = api.calendar.restore.useMutation({
    onSuccess: async () => {
      await utils.calendar.listAccessible.invalidate();
      await utils.calendar.listManageable.invalidate();
    },
  });
  const createCalendar = api.calendar.create.useMutation({
    onSuccess: async () => {
      await utils.calendar.listAccessible.invalidate();
      await utils.calendar.listManageable.invalidate();
    },
  });

  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("university");
  const [businessFeedback, setBusinessFeedback] = useState<string | null>(null);

  const [buildingForms, setBuildingForms] = useState<Record<number, BuildingFormState>>({});
  const [roomForms, setRoomForms] = useState<Record<number, string>>({});
  const [newBuilding, setNewBuilding] = useState({ name: "", acronym: "", rooms: [] as string[], roomField: "" });
  const [buildingFeedback, setBuildingFeedback] = useState<string | null>(null);

  const [departmentForms, setDepartmentForms] = useState<Record<number, { name: string; parentDepartmentId: number | null }>>({});
  const [newDepartment, setNewDepartment] = useState<{ name: string; parentDepartmentId: number | null }>({
    name: "",
    parentDepartmentId: null,
  });
  const [departmentFeedback, setDepartmentFeedback] = useState<string | null>(null);
  const [calendarForms, setCalendarForms] = useState<Record<number, { name: string; color: string; scopeKey: string }>>({});
  const [newCalendar, setNewCalendar] = useState<{ name: string; color: string; isPersonal: boolean; scopeKey: string }>({
    name: "",
    color: "#22c55e",
    isPersonal: false,
    scopeKey: "",
  });
  const [calendarFeedback, setCalendarFeedback] = useState<string | null>(null);
  const [calendarToRemove, setCalendarToRemove] = useState<{ id: number; name: string } | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<number, NodePosition>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<number | null>(null);
  const [companyPosition, setCompanyPosition] = useState<NodePosition>({ x: 0, y: ROOT_DROP_HEIGHT + 12 });
  const [draggingCompany, setDraggingCompany] = useState(false);
  const dragOffsetRef = useRef<NodePosition | null>(null);
  const companyDragOffsetRef = useRef<NodePosition | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const nodePositionsRef = useRef<Record<number, NodePosition>>({});
  const rafRef = useRef<number | null>(null);
  const [pendingParents, setPendingParents] = useState<Record<number, number | null>>({});
  const [companyLinks, setCompanyLinks] = useState<Record<number, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; parentId: number } | null>(null);
  const [contextChildName, setContextChildName] = useState("");
  const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
  const [editingNodeName, setEditingNodeName] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<{ from: number; to: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [connectorDrag, setConnectorDrag] = useState<ConnectorDrag | null>(null);
  const [connectorTargetId, setConnectorTargetId] = useState<number | null>(null);
  const [connectorTargetHandle, setConnectorTargetHandle] = useState<NodePosition | null>(null);
  const [pendingAnchors, setPendingAnchors] = useState<
    Record<number, { parentId: number; fromSide: HandleSide; toSide: HandleSide }>
  >({});
  const [edgeAnchors, setEdgeAnchors] = useState<
    Record<number, { parentId: number; fromSide: HandleSide; toSide: HandleSide }>
  >({});

  useEffect(() => {
    if (data?.business) {
      setBusinessName(data.business.name);
      setBusinessType(data.business.type as BusinessType);
    }
  }, [data?.business]);

  useEffect(() => {
    if (!data?.buildings) return;
    const nextBuildingForms: Record<number, BuildingFormState> = {};
    const nextRoomForms: Record<number, string> = {};
    data.buildings.forEach((building) => {
      nextBuildingForms[building.id] = {
        name: building.name,
        acronym: building.acronym,
        roomField: "",
      };
      building.rooms.forEach((room) => {
        nextRoomForms[room.id] = room.roomNumber;
      });
    });
    setBuildingForms(nextBuildingForms);
    setRoomForms(nextRoomForms);
  }, [data?.buildings]);

  useEffect(() => {
    if (!data?.departments?.flat) return;
    const nextDepartmentForms: Record<number, { name: string; parentDepartmentId: number | null }> = {};
    data.departments.flat.forEach((dept) => {
      nextDepartmentForms[dept.id] = {
        name: dept.name,
        parentDepartmentId: dept.parentDepartmentId,
      };
    });
    setDepartmentForms(nextDepartmentForms);
  }, [data?.departments]);

  useEffect(() => {
    if (!calendars) return;
    const nextCalendarForms: Record<number, { name: string; color: string; scopeKey: string }> = {};
    calendars.forEach((calendar) => {
      nextCalendarForms[calendar.id] = {
        name: calendar.name,
        color: calendar.color,
        scopeKey: `${calendar.scopeType}:${calendar.scopeId}`,
      };
    });
    setCalendarForms(nextCalendarForms);
    setNewCalendar((prev) => ({
      ...prev,
      scopeKey: prev.scopeKey || (calendarScopeOptions?.[0] ? `${calendarScopeOptions[0].scopeType}:${calendarScopeOptions[0].scopeId}` : ""),
    }));
  }, [calendars, calendarScopeOptions]);

  useEffect(() => {
    if (!data?.departments?.roots) return;
    const computed = (() => {
      const positions: Record<number, NodePosition> = {};
      const rowByDepth: number[] = [];
      const walk = (node: DepartmentNode, depth: number) => {
        const row = rowByDepth[depth] ?? 0;
        positions[node.id] = {
          x: depth * X_GAP,
          y: row * Y_GAP,
        };
        rowByDepth[depth] = row + 1;
        node.children.forEach((child) => walk(child, depth + 1));
      };
      data.departments.roots.forEach((root) => walk(root, 0));
      return positions;
    })();

    setNodePositions((prev) => {
      const merged: Record<number, NodePosition> = {};
      Object.entries(computed).forEach(([id, pos]) => {
        const key = Number(id);
        merged[key] = prev[key] ?? pos;
      });
      nodePositionsRef.current = merged;
      return merged;
    });

    if (chartRef.current) {
      const bounds = chartRef.current.getBoundingClientRect();
      setCompanyPosition((prev) => {
        if (prev.x !== 0 || prev.y !== ROOT_DROP_HEIGHT + 12) return prev;
        return {
          x: Math.max(24, bounds.width / 2 - 48),
          y: ROOT_DROP_HEIGHT + 20,
        };
      });
    }
  }, [data?.departments?.roots]);

  useEffect(() => {
    nodePositionsRef.current = nodePositions;
  }, [nodePositions]);

  useEffect(() => {
    const flat = data?.departments?.flat ?? [];
    const parentMap = new Map(flat.map((dept) => [dept.id, dept.parentDepartmentId ?? null]));
    setEdgeAnchors((prev) => {
      const next: Record<number, { parentId: number; fromSide: HandleSide; toSide: HandleSide }> = {};
      Object.entries(prev).forEach(([childId, anchor]) => {
        const id = Number(childId);
        const effectiveParent = parentMap.get(id) ?? null;
        if (effectiveParent && effectiveParent === anchor.parentId) {
          next[id] = anchor;
        } else if (effectiveParent === null && anchor.parentId === COMPANY_NODE_ID) {
          next[id] = anchor;
        }
      });
      return next;
    });
  }, [data?.departments?.flat]);

  useEffect(() => {
    const flat = data?.departments?.flat ?? [];
    setCompanyLinks(() => {
      const next: Record<number, boolean> = {};
      flat.forEach((dept) => {
        next[dept.id] = dept.parentDepartmentId === null;
      });
      return next;
    });
  }, [data?.departments?.flat]);

  const departmentPathMap = useMemo(() => {
    const flat = data?.departments?.flat ?? [];
    const byId = new Map(flat.map((dept) => [dept.id, dept]));
    const cache = new Map<number, string>();

    const buildPath = (deptId: number): string => {
      const cached = cache.get(deptId);
      if (cached) return cached;
      const dept = byId.get(deptId);
      if (!dept) return "";
      const parentId = dept.parentDepartmentId;
      const path = parentId ? `${buildPath(parentId)} / ${dept.name}` : dept.name;
      cache.set(deptId, path);
      return path;
    };

    flat.forEach((dept) => {
      buildPath(dept.id);
    });

    return cache;
  }, [data?.departments?.flat]);

  const departmentById = useMemo(() => {
    return new Map((data?.departments?.flat ?? []).map((dept) => [dept.id, dept]));
  }, [data?.departments?.flat]);

  const companySize = useMemo(() => {
    const name = data?.business?.name ?? "";
    const base = Math.max(72, name.length * 6 + 28);
    return Math.min(160, base);
  }, [data?.business?.name]);

  const edges = useMemo(() => {
    const nextEdges: Array<{ from: number; to: number }> = [];
    (data?.departments?.flat ?? []).forEach((dept) => {
      const parentOverride = Object.prototype.hasOwnProperty.call(pendingParents, dept.id)
        ? pendingParents[dept.id]
        : dept.parentDepartmentId ?? null;
      if (parentOverride) {
        nextEdges.push({ from: parentOverride, to: dept.id });
      } else {
        const linked = companyLinks[dept.id] ?? true;
        if (linked) {
          nextEdges.push({ from: COMPANY_NODE_ID, to: dept.id });
        }
      }
    });
    return nextEdges;
  }, [data?.departments?.flat, pendingParents, companyLinks]);

  const getEffectiveParentId = (deptId: number, fallback: number | null) => {
    if (Object.prototype.hasOwnProperty.call(pendingParents, deptId)) {
      return pendingParents[deptId] ?? null;
    }
    return fallback ?? null;
  };

  const schedulePositionSync = () => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setNodePositions({ ...nodePositionsRef.current });
    });
  };

  const getHandlePoint = (pos: NodePosition, side: HandleSide, width = NODE_WIDTH, height = NODE_HEIGHT) => {
    switch (side) {
      case "top":
        return { x: pos.x + width / 2, y: pos.y - 8 };
      case "right":
        return { x: pos.x + width + 8, y: pos.y + height / 2 };
      case "bottom":
        return { x: pos.x + width / 2, y: pos.y + height + 8 };
      case "left":
      default:
        return { x: pos.x - 8, y: pos.y + height / 2 };
    }
  };

  const getHandlePoints = (pos: NodePosition, width = NODE_WIDTH, height = NODE_HEIGHT) => [
    { side: "top" as const, ...getHandlePoint(pos, "top", width, height) },
    { side: "right" as const, ...getHandlePoint(pos, "right", width, height) },
    { side: "bottom" as const, ...getHandlePoint(pos, "bottom", width, height) },
    { side: "left" as const, ...getHandlePoint(pos, "left", width, height) },
  ];

  const getClosestHandle = (pos: NodePosition, x: number, y: number, width = NODE_WIDTH, height = NODE_HEIGHT) => {
    const handles = getHandlePoints(pos, width, height);
    let closest = handles[0]!;
    let distance = Math.hypot(closest.x - x, closest.y - y);
    for (let index = 1; index < handles.length; index += 1) {
      const handle = handles[index]!;
      const nextDistance = Math.hypot(handle.x - x, handle.y - y);
      if (nextDistance < distance) {
        distance = nextDistance;
        closest = handle;
      }
    }
    return { handle: closest, distance };
  };

  const findSnapTarget = (x: number, y: number, fromId: number): SnapTarget | null => {
    const entries = Object.entries(nodePositionsRef.current)
      .map(([id, pos]) => ({ id: Number(id), pos, width: NODE_WIDTH, height: NODE_HEIGHT }))
      .filter((entry) => entry.id !== fromId);
    entries.push({ id: COMPANY_NODE_ID, pos: companyPosition, width: companySize, height: companySize });
    const expandedPadding = 24;
    const insideCandidates = entries.filter(({ pos, width, height }) => {
      return (
        x >= pos.x - expandedPadding &&
        x <= pos.x + width + expandedPadding &&
        y >= pos.y - expandedPadding &&
        y <= pos.y + height + expandedPadding
      );
    });

    const evaluate = (candidates: typeof entries): SnapTarget | null => {
      let best: SnapTarget | null = null;
      candidates.forEach(({ id, pos, width, height }) => {
        const { handle, distance } = getClosestHandle(pos, x, y, width, height);
        if (!best || distance < best.distance) {
          best = { id, handle: { x: handle.x, y: handle.y }, side: handle.side, distance };
        }
      });
      return best;
    };

    const preferred = insideCandidates.length > 0 ? evaluate(insideCandidates) : evaluate(entries);
    if (!preferred) return null;
    if (insideCandidates.length === 0 && preferred.distance > CONNECT_SNAP_DISTANCE) {
      return null;
    }
    return preferred;
  };

  const wouldCreateCycle = (childId: number, nextParentId: number | null) => {
    if (nextParentId === null || nextParentId === COMPANY_NODE_ID) return false;
    if (nextParentId === childId) return true;
    let current: number | null = nextParentId;
    const visited = new Set<number>();
    while (current !== null) {
      if (current === childId) return true;
      if (visited.has(current)) return true;
      visited.add(current);
      const override: number | null = Object.prototype.hasOwnProperty.call(pendingParents, current)
        ? pendingParents[current] ?? null
        : departmentById.get(current)?.parentDepartmentId ?? null;
      current = override ?? null;
    }
    return false;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (connectorDrag && chartRef.current) {
      const bounds = chartRef.current.getBoundingClientRect();
      const nextX = event.clientX - bounds.left;
      const nextY = event.clientY - bounds.top;
      setConnectorDrag((prev) =>
        prev
          ? {
              ...prev,
              x: nextX,
              y: nextY,
            }
          : null,
      );

      const snap = findSnapTarget(nextX, nextY, connectorDrag.fromId);
      setConnectorTargetId(snap?.id ?? null);
      setConnectorTargetHandle(snap?.handle ?? null);
      return;
    }

    if (draggingCompany && chartRef.current && companyDragOffsetRef.current) {
      const bounds = chartRef.current.getBoundingClientRect();
      const nextX = event.clientX - bounds.left - companyDragOffsetRef.current.x;
      const nextY = event.clientY - bounds.top - companyDragOffsetRef.current.y;
      setCompanyPosition({
        x: Math.max(12, nextX),
        y: Math.max(ROOT_DROP_HEIGHT + 8, nextY),
      });
      return;
    }

    if (!draggingNodeId || !chartRef.current || !dragOffsetRef.current) return;
    const bounds = chartRef.current.getBoundingClientRect();
    const nextX = event.clientX - bounds.left - dragOffsetRef.current.x;
    const nextY = event.clientY - bounds.top - dragOffsetRef.current.y;
    nodePositionsRef.current = {
      ...nodePositionsRef.current,
      [draggingNodeId]: {
        x: Math.max(0, nextX),
        y: Math.max(ROOT_DROP_HEIGHT + 8, nextY),
      },
    };
    schedulePositionSync();
  };

  const handlePointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingCompany) {
      setDraggingCompany(false);
      companyDragOffsetRef.current = null;
    }
    if (connectorDrag && chartRef.current) {
      const bounds = chartRef.current.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const snap = findSnapTarget(pointerX, pointerY, connectorDrag.fromId);
      const dropTargetId = snap?.id ?? null;

      if (dropTargetId !== null) {
        if (wouldCreateCycle(connectorDrag.fromId, dropTargetId)) {
          setDepartmentFeedback("That connection would create a circular relationship.");
          setConnectorDrag(null);
          setConnectorTargetId(null);
          setConnectorTargetHandle(null);
          return;
        }
        setPendingParents((prev) => ({
          ...prev,
          [connectorDrag.fromId]: dropTargetId === COMPANY_NODE_ID ? null : dropTargetId,
        }));
        if (snap?.side) {
          setPendingAnchors((prev) => ({
            ...prev,
            [connectorDrag.fromId]: {
              parentId: dropTargetId === COMPANY_NODE_ID ? COMPANY_NODE_ID : dropTargetId,
              fromSide: connectorDrag.fromSide,
              toSide: snap.side,
            },
          }));
        }
        setCompanyLinks((prev) => ({
          ...prev,
          [connectorDrag.fromId]: dropTargetId === COMPANY_NODE_ID,
        }));
      }
      setConnectorDrag(null);
      setConnectorTargetId(null);
      setConnectorTargetHandle(null);
      return;
    }

    if (!draggingNodeId || !chartRef.current) return;
    const bounds = chartRef.current.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    let dropTargetId: number | null | undefined;
    const currentPositions = nodePositionsRef.current;

    if (pointerY <= ROOT_DROP_HEIGHT) {
      dropTargetId = null;
    } else {
      dropTargetId = undefined;
      for (const [id, pos] of Object.entries(currentPositions)) {
        const numericId = Number(id);
        if (numericId === draggingNodeId) continue;
        const withinX = pointerX >= pos.x && pointerX <= pos.x + NODE_WIDTH;
        const withinY = pointerY >= pos.y && pointerY <= pos.y + NODE_HEIGHT;
        if (withinX && withinY) {
          dropTargetId = numericId;
          break;
        }
      }
    }

    if (dropTargetId === undefined) {
      const withinCompany =
        pointerX >= companyPosition.x &&
        pointerX <= companyPosition.x + companySize &&
        pointerY >= companyPosition.y &&
        pointerY <= companyPosition.y + companySize;
      if (withinCompany) {
        dropTargetId = COMPANY_NODE_ID;
      }
    }

    setDraggingNodeId(null);
    dragOffsetRef.current = null;

    const department = departmentById.get(draggingNodeId);
    if (!department) return;
    const currentParent = department.parentDepartmentId ?? null;
    if (dropTargetId === undefined || dropTargetId === currentParent) return;

    if (dropTargetId !== null && wouldCreateCycle(draggingNodeId, dropTargetId)) {
      setDepartmentFeedback("That move would create a circular relationship.");
      return;
    }
    setPendingParents((prev) => ({
      ...prev,
      [draggingNodeId]: dropTargetId === COMPANY_NODE_ID ? null : dropTargetId ?? null,
    }));
    setPendingAnchors((prev) => {
      const next = { ...prev };
      delete next[draggingNodeId];
      return next;
    });
    setCompanyLinks((prev) => ({
      ...prev,
      [draggingNodeId]: dropTargetId === COMPANY_NODE_ID || dropTargetId === null,
    }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-40 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
        <div className="h-64 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
        <div className="h-64 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 text-sm text-status-danger">
        Unable to load company settings. Please refresh.
      </div>
    );
  }

  if (!data?.business) {
    return (
      <div className="rounded-2xl border border-outline-muted bg-surface-muted p-6 text-sm text-ink-muted">
        No organization has been created yet. Finish setup to manage company details.
      </div>
    );
  }

  const handleAddNewRoom = async (buildingId: number) => {
    const draft = buildingForms[buildingId];
    if (!draft?.roomField.trim()) return;
    setBuildingFeedback(null);
    try {
      await createRoom.mutateAsync({ buildingId, roomNumber: draft.roomField.trim() });
      setBuildingForms((prev) => {
        const base = prev[buildingId] ?? { name: "", acronym: "", roomField: "" };
        return {
          ...prev,
          [buildingId]: { ...base, roomField: "" },
        };
      });
    } catch (error) {
      setBuildingFeedback((error as Error).message ?? "Failed to add room.");
    }
  };

  const handleAddNewBuildingRoom = () => {
    const room = newBuilding.roomField.trim();
    if (!room) return;
    if (newBuilding.rooms.includes(room)) {
      setNewBuilding((prev) => ({ ...prev, roomField: "" }));
      return;
    }
    setNewBuilding((prev) => ({ ...prev, rooms: [...prev.rooms, room], roomField: "" }));
  };

  const handleRemoveNewBuildingRoom = (room: string) => {
    setNewBuilding((prev) => ({ ...prev, rooms: prev.rooms.filter((value) => value !== room) }));
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header>
          <h2 className="text-lg font-semibold text-ink-primary">Organization details</h2>
          <p className="text-sm text-ink-muted">Update the company name and organization type.</p>
        </header>
        <form
          className="mt-6 grid gap-4 md:grid-cols-[2fr_1fr_auto]"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusinessFeedback(null);
            try {
              await updateBusiness.mutateAsync({ name: businessName.trim(), type: businessType });
              setBusinessFeedback("Organization updated.");
            } catch (error) {
              setBusinessFeedback((error as Error).message ?? "Failed to update organization.");
            }
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-ink-primary">
            <span>Business name</span>
            <input
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
              required
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-ink-primary">
            <span>Business type</span>
            <select
              value={businessType}
              onChange={(event) => setBusinessType(event.target.value as BusinessType)}
              className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
            >
              {businessTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={updateBusiness.isPending}
              className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:opacity-60"
            >
              {updateBusiness.isPending ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
        {businessFeedback ? (
          <p className="mt-3 text-sm text-ink-muted">{businessFeedback}</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header>
          <h2 className="text-lg font-semibold text-ink-primary">Buildings & rooms</h2>
          <p className="text-sm text-ink-muted">Add, edit, or remove facilities and their room numbers.</p>
        </header>

        <div className="mt-6 space-y-4">
          {data.buildings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
              No buildings yet. Add your first facility below.
            </div>
          ) : null}
          {data.buildings.map((building) => {
            const form = buildingForms[building.id];
            return (
              <div key={building.id} className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-primary">{building.name}</h3>
                    <p className="text-xs text-ink-subtle">{building.acronym}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setBuildingFeedback(null);
                      if (!confirm(`Delete ${building.name}? This removes all rooms in the building.`)) return;
                      try {
                        await deleteBuilding.mutateAsync({ buildingId: building.id });
                      } catch (error) {
                        setBuildingFeedback((error as Error).message ?? "Failed to delete building.");
                      }
                    }}
                    className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-status-danger hover:text-status-danger"
                  >
                    Delete building
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                  <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                    Name
                    <input
                      value={form?.name ?? building.name}
                      onChange={(event) =>
                        setBuildingForms((prev) => {
                          const base = prev[building.id] ?? { name: building.name, acronym: building.acronym, roomField: "" };
                          return {
                            ...prev,
                            [building.id]: { ...base, name: event.target.value },
                          };
                        })
                      }
                      className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                    Acronym
                    <input
                      value={form?.acronym ?? building.acronym}
                      onChange={(event) =>
                        setBuildingForms((prev) => {
                          const base = prev[building.id] ?? { name: building.name, acronym: building.acronym, roomField: "" };
                          return {
                            ...prev,
                            [building.id]: { ...base, acronym: event.target.value },
                          };
                        })
                      }
                      className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm uppercase text-ink-primary focus:border-outline-accent focus:outline-none"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={async () => {
                        setBuildingFeedback(null);
                        try {
                          await updateBuilding.mutateAsync({
                            buildingId: building.id,
                            name: form?.name ?? building.name,
                            acronym: form?.acronym ?? building.acronym,
                          });
                        } catch (error) {
                          setBuildingFeedback((error as Error).message ?? "Failed to update building.");
                        }
                      }}
                      className="rounded-full border border-outline-muted px-4 py-2 text-xs font-semibold text-ink-primary transition hover:border-outline-strong"
                    >
                      Update building
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="text-xs uppercase text-ink-subtle">Rooms</div>
                  {building.rooms.length === 0 ? (
                    <div className="text-xs text-ink-muted">No rooms added yet.</div>
                  ) : (
                    <div className="grid gap-2">
                      {building.rooms.map((room) => (
                        <div key={room.id} className="flex flex-wrap items-center gap-2">
                          <input
                            value={roomForms[room.id] ?? room.roomNumber}
                            onChange={(event) =>
                              setRoomForms((prev) => ({
                                ...prev,
                                [room.id]: event.target.value,
                              }))
                            }
                            className="w-32 rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              setBuildingFeedback(null);
                              try {
                                await updateRoom.mutateAsync({ roomId: room.id, roomNumber: roomForms[room.id] ?? room.roomNumber });
                              } catch (error) {
                                setBuildingFeedback((error as Error).message ?? "Failed to update room.");
                              }
                            }}
                            className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-outline-strong"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setBuildingFeedback(null);
                              if (!confirm(`Remove room ${room.roomNumber}?`)) return;
                              try {
                                await deleteRoom.mutateAsync({ roomId: room.id });
                              } catch (error) {
                                setBuildingFeedback((error as Error).message ?? "Failed to remove room.");
                              }
                            }}
                            className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-status-danger hover:text-status-danger"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={form?.roomField ?? ""}
                      onChange={(event) =>
                        setBuildingForms((prev) => {
                          const base = prev[building.id] ?? { name: building.name, acronym: building.acronym, roomField: "" };
                          return {
                            ...prev,
                            [building.id]: { ...base, roomField: event.target.value },
                          };
                        })
                      }
                      className="w-40 rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                      placeholder="Add room"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddNewRoom(building.id)}
                      className="rounded-full border border-outline-accent px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-primary hover:bg-accent-muted"
                    >
                      Add room
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-outline-muted bg-surface-muted p-4">
          <h3 className="text-sm font-semibold text-ink-primary">Add a building</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Name
              <input
                value={newBuilding.name}
                onChange={(event) => setNewBuilding((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Acronym
              <input
                value={newBuilding.acronym}
                onChange={(event) => setNewBuilding((prev) => ({ ...prev, acronym: event.target.value }))}
                className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm uppercase text-ink-primary focus:border-outline-accent focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-4">
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Rooms
              <div className="flex flex-wrap gap-2">
                <input
                  value={newBuilding.roomField}
                  onChange={(event) => setNewBuilding((prev) => ({ ...prev, roomField: event.target.value }))}
                  className="w-40 rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                  placeholder="201"
                />
                <button
                  type="button"
                  onClick={handleAddNewBuildingRoom}
                  className="rounded-full border border-outline-accent px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-primary hover:bg-accent-muted"
                >
                  Add room
                </button>
              </div>
            </label>
            {newBuilding.rooms.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {newBuilding.rooms.map((room) => (
                  <span
                    key={room}
                    className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-raised px-3 py-1 text-xs"
                  >
                    {room}
                    <button type="button" onClick={() => handleRemoveNewBuildingRoom(room)} className="text-ink-subtle">
                      Remove
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">Add each room you schedule (e.g., 135, 210A).</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                setBuildingFeedback(null);
                if (!newBuilding.name.trim() || !newBuilding.acronym.trim() || newBuilding.rooms.length === 0) {
                  setBuildingFeedback("Add a building name, acronym, and at least one room.");
                  return;
                }
                try {
                  await createBuilding.mutateAsync({
                    name: newBuilding.name.trim(),
                    acronym: newBuilding.acronym.trim(),
                    rooms: newBuilding.rooms,
                  });
                  setNewBuilding({ name: "", acronym: "", rooms: [], roomField: "" });
                } catch (error) {
                  setBuildingFeedback((error as Error).message ?? "Failed to add building.");
                }
              }}
              className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
            >
              Add building
            </button>
          </div>
          {buildingFeedback ? (
            <p className="mt-3 text-sm text-ink-muted">{buildingFeedback}</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header>
          <h2 className="text-lg font-semibold text-ink-primary">Departments & divisions</h2>
          <p className="text-sm text-ink-muted">Reassign departments, rename teams, and add new divisions.</p>
        </header>

        <div className="mt-6 space-y-4">
          {data.departments.roots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
              No departments created yet. Add one below.
            </div>
          ) : (
            <div className="space-y-6">
                <div className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink-primary">Department flow chart</div>
                      <p className="text-xs text-ink-muted">
                        Drag a department onto another to change its parent. Drop on the top bar to make it a root department.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={Object.keys(pendingParents).length === 0}
                        onClick={async () => {
                          setDepartmentFeedback(null);
                          const entries = Object.entries(pendingParents)
                            .map(([id, parentId]) => ({ id: Number(id), parentId }))
                            .filter((entry) => departmentById.has(entry.id));
                          if (entries.length === 0) return;

                          const workingMap = new Map<number, number | null>();
                          (data.departments.flat ?? []).forEach((dept) => {
                            workingMap.set(dept.id, dept.parentDepartmentId ?? null);
                          });
                          const projectedMap = new Map(workingMap);
                          entries.forEach((entry) => {
                            projectedMap.set(entry.id, entry.parentId ?? null);
                          });
                          const rootIds = Array.from(projectedMap.entries())
                            .filter(([, parentId]) => parentId === null)
                            .map(([id]) => id);
                          const linkedRootCount = rootIds.filter((id) => companyLinks[id] ?? true).length;
                          if (linkedRootCount === 0) {
                            setDepartmentFeedback("At least one department must remain connected to the company node.");
                            return;
                          }

                          const canApply = (childId: number, nextParentId: number | null) => {
                            if (nextParentId === null) return true;
                            let current: number | null = nextParentId;
                            const visited = new Set<number>();
                            while (current !== null) {
                              if (current === childId) return false;
                              if (visited.has(current)) return false;
                              visited.add(current);
                              current = workingMap.get(current) ?? null;
                            }
                            return true;
                          };

                          const ordered: Array<{ id: number; parentId: number | null }> = [];
                          const remaining = [...entries];
                          let progressed = true;
                          while (remaining.length > 0 && progressed) {
                            progressed = false;
                            for (let index = remaining.length - 1; index >= 0; index -= 1) {
                              const entry = remaining[index]!;
                              if (canApply(entry.id, entry.parentId)) {
                                ordered.push(entry);
                                workingMap.set(entry.id, entry.parentId);
                                remaining.splice(index, 1);
                                progressed = true;
                              }
                            }
                          }

                          if (remaining.length > 0) {
                            setDepartmentFeedback("Unable to save all changes without creating a cycle. Try saving in smaller steps.");
                            return;
                          }

                          try {
                            for (const entry of ordered) {
                              await updateDepartment.mutateAsync({
                                departmentId: entry.id,
                                parentDepartmentId: entry.parentId,
                              });
                            }
                            setEdgeAnchors((prev) => ({ ...prev, ...pendingAnchors }));
                            setPendingParents({});
                            setPendingAnchors({});
                          } catch (error) {
                            setDepartmentFeedback((error as Error).message ?? "Failed to save department structure.");
                          }
                        }}
                        className="rounded-full bg-accent-strong px-4 py-2 text-xs font-semibold text-ink-inverted transition hover:bg-accent-default disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const computed: Record<number, NodePosition> = {};
                          const rowByDepth: number[] = [];
                          const walk = (node: DepartmentNode, depth: number) => {
                        const row = rowByDepth[depth] ?? 0;
                        computed[node.id] = {
                          x: depth * X_GAP,
                          y: row * Y_GAP,
                        };
                            rowByDepth[depth] = row + 1;
                            node.children.forEach((child) => walk(child, depth + 1));
                          };
                          data.departments.roots.forEach((root) => walk(root, 0));
                          nodePositionsRef.current = computed;
                          setNodePositions(computed);
                        }}
                        className="rounded-full border border-outline-muted px-4 py-2 text-xs font-semibold text-ink-subtle hover:border-outline-strong"
                      >
                        Reset layout
                      </button>
                    </div>
                  </div>
                  <div
                    ref={chartRef}
                    className="relative mt-4 min-h-[360px] overflow-auto rounded-2xl border border-outline-muted bg-surface-canvas"
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (!selectedEdge) return;
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        setPendingParents((prev) => ({
                          ...prev,
                          [selectedEdge.to]: null,
                        }));
                        if (selectedEdge.from === COMPANY_NODE_ID) {
                          setCompanyLinks((prev) => ({
                            ...prev,
                            [selectedEdge.to]: false,
                          }));
                        }
                        setPendingAnchors((prev) => {
                          const next = { ...prev };
                          delete next[selectedEdge.to];
                          return next;
                        });
                        setEdgeAnchors((prev) => {
                          const next = { ...prev };
                          delete next[selectedEdge.to];
                          return next;
                        });
                        setSelectedEdge(null);
                      }
                    }}
                    onClick={() => {
                      setContextMenu(null);
                      setSelectedEdge(null);
                    }}
                  >
                    <div className="absolute inset-x-0 top-0 flex h-[46px] items-center justify-center border-b border-dashed border-outline-muted text-xs font-semibold uppercase tracking-[0.2em] text-ink-subtle">
                      Root level drop zone
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (!chartRef.current) return;
                        const bounds = chartRef.current.getBoundingClientRect();
                        companyDragOffsetRef.current = {
                          x: event.clientX - bounds.left - companyPosition.x,
                          y: event.clientY - bounds.top - companyPosition.y,
                        };
                        setDraggingCompany(true);
                        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
                      }}
                      onPointerEnter={() => setHoveredNodeId(COMPANY_NODE_ID)}
                      onPointerLeave={() => {
                        if (hoveredNodeId === COMPANY_NODE_ID) setHoveredNodeId(null);
                      }}
                      className="absolute flex cursor-grab flex-col items-center gap-2 text-center text-xs text-ink-primary"
                      style={{
                        left: companyPosition.x,
                        top: companyPosition.y,
                        width: companySize,
                      }}
                    >
                      <div
                        className="flex items-center justify-center rounded-full border border-outline-muted bg-surface-raised px-3 text-center text-xs font-semibold text-ink-primary shadow-sm"
                        style={{
                          width: companySize,
                          height: companySize,
                        }}
                      >
                        <span className="line-clamp-3 break-words">{data.business.name}</span>
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-ink-subtle">Company</div>
                      {hoveredNodeId === COMPANY_NODE_ID ? (
                        <>
                          <div
                            className="absolute -top-3 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                            style={{ top: -6 }}
                          />
                          <div
                            className="absolute right-[-12px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                          />
                          <div
                            className="absolute -bottom-3 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                          />
                          <div
                            className="absolute left-[-12px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                          />
                        </>
                      ) : null}
                    </div>
                  <svg className="absolute inset-0 h-full w-full" aria-hidden>
                    {edges.map((edge) => {
                      const parentPos = edge.from === COMPANY_NODE_ID ? companyPosition : nodePositions[edge.from];
                      const childPos = nodePositions[edge.to];
                      if (!parentPos || !childPos) return null;
                      const anchor = pendingAnchors[edge.to] ?? edgeAnchors[edge.to];
                      const useAnchors = anchor && anchor.parentId === edge.from;
                      const childSide: HandleSide = useAnchors
                        ? anchor.fromSide
                        : Math.abs(parentPos.x - childPos.x) >= Math.abs(parentPos.y - childPos.y)
                          ? parentPos.x > childPos.x
                            ? "right"
                            : "left"
                          : parentPos.y > childPos.y
                            ? "bottom"
                            : "top";
                      const parentSide: HandleSide = useAnchors
                        ? anchor.toSide
                        : childSide === "right"
                          ? "left"
                          : childSide === "left"
                            ? "right"
                            : childSide === "top"
                              ? "bottom"
                              : "top";
                      const start = getHandlePoint(childPos, childSide);
                      const end = getHandlePoint(
                        parentPos,
                        parentSide,
                        edge.from === COMPANY_NODE_ID ? companySize : NODE_WIDTH,
                        edge.from === COMPANY_NODE_ID ? companySize : NODE_HEIGHT,
                      );
                      const startX = start.x;
                      const startY = start.y;
                      const endX = end.x;
                      const endY = end.y;
                      const dx = Math.max(80, Math.abs(endX - startX) * 0.5);
                      const path = `M ${startX} ${startY} C ${startX + dx} ${startY} ${endX - dx} ${endY} ${endX} ${endY}`;
                      const midX = (startX + endX) / 2;
                      const midY = (startY + endY) / 2;
                      const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to;
                      return (
                        <g key={`${edge.from}-${edge.to}`}>
                          <path
                            d={path}
                            fill="none"
                            stroke="rgba(148, 163, 184, 0.7)"
                            strokeWidth="2"
                          />
                          <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="14"
                            className="cursor-pointer"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedEdge(edge);
                            }}
                          />
                          {isSelected ? (
                            <foreignObject x={midX - 12} y={midY - 12} width="24" height="24">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPendingParents((prev) => ({
                                    ...prev,
                                    [edge.to]: null,
                                  }));
                                  if (edge.from === COMPANY_NODE_ID) {
                                    setCompanyLinks((prev) => ({
                                      ...prev,
                                      [edge.to]: false,
                                    }));
                                  }
                                  setPendingAnchors((prev) => {
                                    const next = { ...prev };
                                    delete next[edge.to];
                                    return next;
                                  });
                                  setEdgeAnchors((prev) => {
                                    const next = { ...prev };
                                    delete next[edge.to];
                                    return next;
                                  });
                                  setSelectedEdge(null);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-outline-muted bg-surface-raised text-[10px] font-semibold text-ink-subtle shadow-sm hover:border-status-danger hover:text-status-danger"
                              >
                                X
                              </button>
                            </foreignObject>
                          ) : null}
                        </g>
                      );
                    })}
                    {connectorDrag ? (
                      <path
                        d={`M ${connectorDrag.startX} ${connectorDrag.startY} C ${
                          connectorDrag.startX + 80
                        } ${connectorDrag.startY} ${
                          (connectorTargetHandle?.x ?? connectorDrag.x) - 80
                        } ${
                          connectorTargetHandle?.y ?? connectorDrag.y
                        } ${connectorTargetHandle?.x ?? connectorDrag.x} ${connectorTargetHandle?.y ?? connectorDrag.y}`}
                        fill="none"
                        stroke="rgba(59, 130, 246, 0.9)"
                        strokeWidth="2"
                      />
                    ) : null}
                  </svg>
                  {(data.departments.flat ?? []).map((dept) => {
                    const pos = nodePositions[dept.id] ?? { x: 0, y: ROOT_DROP_HEIGHT + 8 };
                    const effectiveParentId = getEffectiveParentId(dept.id, dept.parentDepartmentId ?? null);
                    const isEditing = editingNodeId === dept.id;
                    const isTarget = connectorTargetId === dept.id;
                    const showHandles = hoveredNodeId === dept.id || connectorDrag?.fromId === dept.id;
                    return (
                      <div
                        key={dept.id}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(event) => {
                          if (!chartRef.current) return;
                          const bounds = chartRef.current.getBoundingClientRect();
                          dragOffsetRef.current = {
                            x: event.clientX - bounds.left - pos.x,
                            y: event.clientY - bounds.top - pos.y,
                          };
                          setDraggingNodeId(dept.id);
                          (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerEnter={() => setHoveredNodeId(dept.id)}
                        onPointerLeave={() => {
                          if (hoveredNodeId === dept.id) setHoveredNodeId(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            setDepartmentFeedback(`Selected ${dept.name}. Drag to reposition or update parent below.`);
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!chartRef.current) return;
                          const bounds = chartRef.current.getBoundingClientRect();
                          setContextMenu({
                            x: Math.max(8, event.clientX - bounds.left),
                            y: Math.max(ROOT_DROP_HEIGHT + 8, event.clientY - bounds.top),
                            parentId: dept.id,
                          });
                          setContextChildName("");
                        }}
                        className={
                          "absolute flex flex-col justify-center rounded-xl border bg-surface-raised px-3 py-2 text-sm shadow-sm transition " +
                          (draggingNodeId === dept.id
                            ? "cursor-grabbing border-outline-accent shadow-[var(--shadow-accent-glow)]"
                            : isTarget
                              ? "cursor-grab border-outline-accent shadow-[var(--shadow-accent-glow)]"
                              : "cursor-grab border-outline-muted hover:border-outline-strong")
                        }
                        style={{
                          width: NODE_WIDTH,
                          height: NODE_HEIGHT,
                          transform: `translate(${pos.x}px, ${pos.y}px)`,
                        }}
                      >
                        {isEditing ? (
                          <input
                            value={editingNodeName}
                            onChange={(event) => setEditingNodeName(event.target.value)}
                            onKeyDown={async (event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setEditingNodeId(null);
                                setEditingNodeName("");
                                return;
                              }
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              const name = editingNodeName.trim();
                              if (!name) {
                                setDepartmentFeedback("Department name is required.");
                                return;
                              }
                              try {
                                await updateDepartment.mutateAsync({
                                  departmentId: dept.id,
                                  name,
                                });
                                setEditingNodeId(null);
                                setEditingNodeName("");
                              } catch (error) {
                                setDepartmentFeedback((error as Error).message ?? "Failed to rename department.");
                              }
                            }}
                            className="rounded-md border border-outline-muted bg-surface-muted px-2 py-1 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingNodeId(dept.id);
                              setEditingNodeName(dept.name);
                            }}
                            className="text-left font-semibold text-ink-primary hover:text-ink-strong"
                          >
                            {dept.name}
                          </button>
                        )}
                        <span className="text-xs text-ink-subtle">
                          {effectiveParentId
                            ? `Reports to ${departmentPathMap.get(effectiveParentId) ?? "Parent"}`
                            : "Root department"}
                        </span>
                        {showHandles ? (
                          <>
                            <button
                              type="button"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                if (!chartRef.current) return;
                                const bounds = chartRef.current.getBoundingClientRect();
                                chartRef.current.setPointerCapture(event.pointerId);
                                const start = getHandlePoint(pos, "top");
                                setConnectorDrag({
                                  fromId: dept.id,
                                  startX: start.x,
                                  startY: start.y,
                                  x: event.clientX - bounds.left,
                                  y: event.clientY - bounds.top,
                                  fromSide: "top",
                                });
                              }}
                              className="absolute -top-3 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                            />
                            <button
                              type="button"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                if (!chartRef.current) return;
                                const bounds = chartRef.current.getBoundingClientRect();
                                chartRef.current.setPointerCapture(event.pointerId);
                                const start = getHandlePoint(pos, "right");
                                setConnectorDrag({
                                  fromId: dept.id,
                                  startX: start.x,
                                  startY: start.y,
                                  x: event.clientX - bounds.left,
                                  y: event.clientY - bounds.top,
                                  fromSide: "right",
                                });
                              }}
                              className="absolute right-[-12px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                            />
                            <button
                              type="button"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                if (!chartRef.current) return;
                                const bounds = chartRef.current.getBoundingClientRect();
                                chartRef.current.setPointerCapture(event.pointerId);
                                const start = getHandlePoint(pos, "bottom");
                                setConnectorDrag({
                                  fromId: dept.id,
                                  startX: start.x,
                                  startY: start.y,
                                  x: event.clientX - bounds.left,
                                  y: event.clientY - bounds.top,
                                  fromSide: "bottom",
                                });
                              }}
                              className="absolute -bottom-3 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                            />
                            <button
                              type="button"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                if (!chartRef.current) return;
                                const bounds = chartRef.current.getBoundingClientRect();
                                chartRef.current.setPointerCapture(event.pointerId);
                                const start = getHandlePoint(pos, "left");
                                setConnectorDrag({
                                  fromId: dept.id,
                                  startX: start.x,
                                  startY: start.y,
                                  x: event.clientX - bounds.left,
                                  y: event.clientY - bounds.top,
                                  fromSide: "left",
                                });
                              }}
                              className="absolute left-[-12px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-outline-accent bg-surface-raised shadow-sm"
                            />
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                  {contextMenu ? (
                    <div
                      className="absolute z-10 w-64 rounded-xl border border-outline-muted bg-surface-raised p-3 shadow-[var(--shadow-pane)]"
                      style={{ left: contextMenu.x, top: contextMenu.y }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="text-xs uppercase tracking-wide text-ink-subtle">Add child department</div>
                      <input
                        value={contextChildName}
                        onChange={(event) => setContextChildName(event.target.value)}
                        placeholder="Department name"
                        onKeyDown={async (event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          if (!contextChildName.trim()) {
                            setDepartmentFeedback("Department name is required.");
                            return;
                          }
                          try {
                            await createDepartment.mutateAsync({
                              name: contextChildName.trim(),
                              parentDepartmentId: contextMenu.parentId,
                            });
                            setContextMenu(null);
                            setContextChildName("");
                          } catch (error) {
                            setDepartmentFeedback((error as Error).message ?? "Failed to create department.");
                          }
                        }}
                        className="mt-2 w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                      />
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setContextMenu(null)}
                          className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-outline-strong"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!contextChildName.trim()) {
                              setDepartmentFeedback("Department name is required.");
                              return;
                            }
                            try {
                              await createDepartment.mutateAsync({
                                name: contextChildName.trim(),
                                parentDepartmentId: contextMenu.parentId,
                              });
                              setContextMenu(null);
                              setContextChildName("");
                            } catch (error) {
                              setDepartmentFeedback((error as Error).message ?? "Failed to create department.");
                            }
                          }}
                          className="rounded-full bg-accent-strong px-3 py-1 text-xs font-semibold text-ink-inverted transition hover:bg-accent-default"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {renderDepartmentRows(data.departments.roots, (dept, depth) => {
                const form = departmentForms[dept.id];
                const options = data.departments.flat.filter((option) => option.id !== dept.id);
                const hasChanges =
                  form && (form.name !== dept.name || form.parentDepartmentId !== dept.parentDepartmentId);
                return (
                  <div
                    key={dept.id}
                    className="rounded-xl border border-outline-muted bg-surface-muted p-3"
                    style={{ paddingLeft: depth * 16 + 12 }}
                  >
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                      <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                        Name
                        <input
                          value={form?.name ?? dept.name}
                          onChange={(event) =>
                            setDepartmentForms((prev) => {
                              const base = prev[dept.id] ?? { name: dept.name, parentDepartmentId: dept.parentDepartmentId ?? null };
                              return {
                                ...prev,
                                [dept.id]: { ...base, name: event.target.value },
                              };
                            })
                          }
                          className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                        Parent
                        <select
                          value={form?.parentDepartmentId ?? ""}
                          onChange={(event) =>
                            setDepartmentForms((prev) => {
                              const base = prev[dept.id] ?? { name: dept.name, parentDepartmentId: dept.parentDepartmentId ?? null };
                              return {
                                ...prev,
                                [dept.id]: {
                                  ...base,
                                  parentDepartmentId: event.target.value ? Number(event.target.value) : null,
                                },
                              };
                            })
                          }
                          className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                        >
                          <option value="">No parent</option>
                          {options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {departmentPathMap.get(option.id) ?? option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex flex-wrap items-end gap-2">
                        <button
                          type="button"
                          disabled={!hasChanges}
                          onClick={async () => {
                            setDepartmentFeedback(null);
                            try {
                              await updateDepartment.mutateAsync({
                                departmentId: dept.id,
                                name: form?.name ?? dept.name,
                                parentDepartmentId: form?.parentDepartmentId ?? null,
                              });
                            } catch (error) {
                              setDepartmentFeedback((error as Error).message ?? "Failed to update department.");
                            }
                          }}
                          className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-outline-strong disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setDepartmentFeedback(null);
                            if (!confirm(`Delete ${dept.name}? Sub-departments will be removed too.`)) return;
                            try {
                              await deleteDepartment.mutateAsync({ departmentId: dept.id });
                            } catch (error) {
                              setDepartmentFeedback((error as Error).message ?? "Failed to delete department.");
                            }
                          }}
                          className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-status-danger hover:text-status-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-outline-muted bg-surface-muted p-4">
          <h3 className="text-sm font-semibold text-ink-primary">Add department</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Name
              <input
                value={newDepartment.name}
                onChange={(event) => setNewDepartment((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Parent
              <select
                value={newDepartment.parentDepartmentId ?? ""}
                onChange={(event) =>
                  setNewDepartment((prev) => ({
                    ...prev,
                    parentDepartmentId: event.target.value ? Number(event.target.value) : null,
                  }))
                }
                className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
              >
                <option value="">No parent</option>
                {data.departments.flat.map((option) => (
                  <option key={option.id} value={option.id}>
                    {departmentPathMap.get(option.id) ?? option.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={async () => {
                  setDepartmentFeedback(null);
                  if (!newDepartment.name.trim()) {
                    setDepartmentFeedback("Department name is required.");
                    return;
                  }
                  try {
                    await createDepartment.mutateAsync({
                      name: newDepartment.name.trim(),
                      parentDepartmentId: newDepartment.parentDepartmentId ?? null,
                    });
                    setNewDepartment({ name: "", parentDepartmentId: null });
                  } catch (error) {
                    setDepartmentFeedback((error as Error).message ?? "Failed to create department.");
                  }
                }}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
              >
                Add department
              </button>
            </div>
          </div>
          {departmentFeedback ? (
            <p className="mt-3 text-sm text-ink-muted">{departmentFeedback}</p>
          ) : null}
        </div>

        <div className="mt-6 rounded-2xl border border-outline-muted bg-surface-muted p-4">
          <h3 className="text-sm font-semibold text-ink-primary">Calendars</h3>
        <div className="mt-4 border-b border-outline-muted pb-4">
          <h4 className="text-sm font-semibold text-ink-primary">Add calendar</h4>
          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Name
              <input
                value={newCalendar.name}
                onChange={(event) => setNewCalendar((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Color
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newCalendar.color}
                  onChange={(event) => setNewCalendar((prev) => ({ ...prev, color: event.target.value }))}
                  className="h-10 w-12 cursor-pointer rounded border border-outline-muted bg-transparent"
                />
                <input
                  value={newCalendar.color}
                  onChange={(event) => setNewCalendar((prev) => ({ ...prev, color: event.target.value }))}
                  className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                />
              </div>
            </label>
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Scope
              <select
                value={newCalendar.scopeKey}
                onChange={(event) => setNewCalendar((prev) => ({ ...prev, scopeKey: event.target.value }))}
                disabled={newCalendar.isPersonal}
                className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none disabled:opacity-60"
              >
                <option value="">Select scope</option>
                {(calendarScopeOptions ?? []).map((option) => (
                  <option key={`${option.scopeType}:${option.scopeId}`} value={`${option.scopeType}:${option.scopeId}`}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col items-start gap-2 text-xs uppercase text-ink-subtle md:items-end">
              <label className="flex items-center gap-2 text-xs uppercase text-ink-subtle">
                <input
                  type="checkbox"
                  checked={newCalendar.isPersonal}
                  onChange={(event) => setNewCalendar((prev) => ({ ...prev, isPersonal: event.target.checked }))}
                  className="accent-accent-strong"
                />
                Personal
              </label>
              <button
                type="button"
                onClick={async () => {
                  setCalendarFeedback(null);
                  if (!newCalendar.name.trim()) {
                    setCalendarFeedback("Calendar name is required.");
                    return;
                  }
                  if (!newCalendar.isPersonal && !newCalendar.scopeKey) {
                    setCalendarFeedback("Select a scope for team calendars.");
                    return;
                  }
                  const [scopeTypeRaw, scopeIdRaw] = newCalendar.scopeKey.split(":");
                  const scopeId = Number(scopeIdRaw);
                  if (!newCalendar.isPersonal && (!scopeTypeRaw || !Number.isFinite(scopeId))) {
                    setCalendarFeedback("Select a valid scope for team calendars.");
                    return;
                  }
                  try {
                    await createCalendar.mutateAsync({
                      name: newCalendar.name.trim(),
                      color: newCalendar.color,
                      isPersonal: newCalendar.isPersonal,
                      ...(newCalendar.isPersonal
                        ? {}
                        : {
                            scopeType: scopeTypeRaw as "business" | "department" | "division",
                            scopeId,
                          }),
                    });
                    setNewCalendar({
                      name: "",
                      color: "#22c55e",
                      isPersonal: false,
                      scopeKey: calendarScopeOptions?.[0]
                        ? `${calendarScopeOptions[0].scopeType}:${calendarScopeOptions[0].scopeId}`
                        : "",
                    });
                  } catch (error) {
                    setCalendarFeedback((error as Error).message ?? "Failed to create calendar.");
                  }
                }}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
              >
                Add calendar
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-6">
          {(calendars ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">No calendars available.</p>
          ) : (
              <>
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Active calendars</h4>
                  {(calendars ?? [])
                    .filter((calendar) => !calendar.isArchived)
                    .map((calendar) => {
                const form = calendarForms[calendar.id];
                const scopeKey = form?.scopeKey ?? `${calendar.scopeType}:${calendar.scopeId}`;
                const canManage = calendar.canManage;
                const hasChanges =
                  form &&
                  (form.name !== calendar.name ||
                    form.color !== calendar.color ||
                    (!calendar.isPersonal && scopeKey !== `${calendar.scopeType}:${calendar.scopeId}`));
                return (
                  <div key={calendar.id} className="rounded-xl border border-outline-muted bg-surface-raised p-4">
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
                      <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                        Name
                        <input
                          value={form?.name ?? calendar.name}
                          disabled={!canManage}
                          onChange={(event) =>
                            setCalendarForms((prev) => ({
                              ...prev,
                              [calendar.id]: {
                                name: event.target.value,
                                color: prev[calendar.id]?.color ?? calendar.color,
                                scopeKey: prev[calendar.id]?.scopeKey ?? `${calendar.scopeType}:${calendar.scopeId}`,
                              },
                            }))
                          }
                          className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                        Color
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={form?.color ?? calendar.color}
                            disabled={!canManage}
                            onChange={(event) =>
                              setCalendarForms((prev) => ({
                                ...prev,
                                [calendar.id]: {
                                  name: prev[calendar.id]?.name ?? calendar.name,
                                  color: event.target.value,
                                  scopeKey: prev[calendar.id]?.scopeKey ?? `${calendar.scopeType}:${calendar.scopeId}`,
                                },
                              }))
                            }
                            className="h-10 w-12 cursor-pointer rounded border border-outline-muted bg-transparent"
                          />
                          <input
                            value={form?.color ?? calendar.color}
                            disabled={!canManage}
                            onChange={(event) =>
                              setCalendarForms((prev) => ({
                                ...prev,
                                [calendar.id]: {
                                  name: prev[calendar.id]?.name ?? calendar.name,
                                  color: event.target.value,
                                  scopeKey: prev[calendar.id]?.scopeKey ?? `${calendar.scopeType}:${calendar.scopeId}`,
                                },
                              }))
                            }
                            className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                          />
                        </div>
                      </label>
                      <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                        Scope
                        {calendar.isPersonal ? (
                          <div className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                            Personal calendar
                          </div>
                        ) : (
                          <select
                            value={scopeKey}
                            disabled={!canManage}
                            onChange={(event) =>
                              setCalendarForms((prev) => ({
                                ...prev,
                                [calendar.id]: {
                                  name: prev[calendar.id]?.name ?? calendar.name,
                                  color: prev[calendar.id]?.color ?? calendar.color,
                                  scopeKey: event.target.value,
                                },
                              }))
                            }
                            className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                          >
                            {(calendarScopeOptions ?? []).map((option) => (
                              <option key={`${option.scopeType}:${option.scopeId}`} value={`${option.scopeType}:${option.scopeId}`}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          disabled={!canManage || !hasChanges || updateCalendar.isPending}
                          onClick={async () => {
                            setCalendarFeedback(null);
                            const payload = calendarForms[calendar.id];
                            if (!payload?.name?.trim()) {
                              setCalendarFeedback("Calendar name is required.");
                              return;
                            }
                            let scopeType: "business" | "department" | "division" | null = null;
                            let scopeId = 0;
                            if (!calendar.isPersonal) {
                              const [scopeTypeRaw, scopeIdRaw] = (payload.scopeKey || "").split(":");
                              const parsedScopeId = Number(scopeIdRaw);
                              if (!scopeTypeRaw || !Number.isFinite(parsedScopeId)) {
                                setCalendarFeedback("Select a valid scope.");
                                return;
                              }
                              scopeType = scopeTypeRaw as "business" | "department" | "division";
                              scopeId = parsedScopeId;
                            }
                            try {
                              await updateCalendar.mutateAsync({
                                calendarId: calendar.id,
                                name: payload.name.trim(),
                                color: payload.color,
                                ...(scopeType
                                  ? {
                                      scopeType,
                                      scopeId,
                                    }
                                  : {}),
                              });
                            } catch (error) {
                              setCalendarFeedback((error as Error).message ?? "Failed to update calendar.");
                            }
                          }}
                          className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-outline-strong disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={!canManage || deleteCalendar.isPending}
                          onClick={() => {
                            setCalendarFeedback(null);
                            setCalendarToRemove({ id: calendar.id, name: calendar.name });
                          }}
                          className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-status-danger hover:text-status-danger disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Hidden calendars</h4>
                  {(calendars ?? []).filter((calendar) => calendar.isArchived).length === 0 ? (
                    <p className="text-sm text-ink-muted">No hidden calendars.</p>
                  ) : (
                    (calendars ?? [])
                      .filter((calendar) => calendar.isArchived)
                      .map((calendar) => {
                        const form = calendarForms[calendar.id];
                        const scopeKey = form?.scopeKey ?? `${calendar.scopeType}:${calendar.scopeId}`;
                        const canManage = calendar.canManage;
                        return (
                          <div
                            key={calendar.id}
                            className="rounded-xl border border-outline-muted bg-surface-muted/70 p-4 text-ink-muted"
                          >
                            <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
                              <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                                Name
                                <input
                                  value={form?.name ?? calendar.name}
                                  disabled
                                  className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-muted"
                                />
                              </label>
                              <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                                Color
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={form?.color ?? calendar.color}
                                    disabled
                                    className="h-10 w-12 cursor-not-allowed rounded border border-outline-muted bg-transparent opacity-60"
                                  />
                                  <input
                                    value={form?.color ?? calendar.color}
                                    disabled
                                    className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-muted"
                                  />
                                </div>
                              </label>
                              <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
                                Scope
                                {calendar.isPersonal ? (
                                  <div className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                                    Personal calendar
                                  </div>
                                ) : (
                                  <div className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                                    {(calendarScopeOptions ?? []).find(
                                      (option) => `${option.scopeType}:${option.scopeId}` === scopeKey,
                                    )?.label ?? "Scope"}
                                  </div>
                                )}
                              </label>
                              <div className="flex items-end gap-2">
                                <button
                                  type="button"
                                  disabled={!canManage || restoreCalendar.isPending}
                                  onClick={async () => {
                                    setCalendarFeedback(null);
                                    try {
                                      await restoreCalendar.mutateAsync({ calendarId: calendar.id });
                                    } catch (error) {
                                      setCalendarFeedback((error as Error).message ?? "Failed to restore calendar.");
                                    }
                                  }}
                                  className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle hover:border-outline-strong disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Restore
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </>
            )}
          </div>

          {calendarFeedback ? <p className="mt-3 text-sm text-ink-muted">{calendarFeedback}</p> : null}
        </div>
      </section>

      {calendarToRemove ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--color-overlay-backdrop)] px-4">
          <div className="w-full max-w-md rounded-2xl border border-outline-muted bg-surface-raised p-6 text-ink-primary shadow-2xl shadow-[var(--shadow-pane)]">
            <div className="text-lg font-semibold">Remove calendar?</div>
            <p className="mt-2 text-sm text-ink-muted">
              "{calendarToRemove.name}" will be removed from the list. Events stay in the database but become hidden.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-outline-muted px-4 py-2 text-sm text-ink-subtle hover:bg-surface-muted"
                onClick={() => setCalendarToRemove(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deleteCalendar.isPending}
                onClick={async () => {
                  if (!calendarToRemove) return;
                  setCalendarFeedback(null);
                  try {
                    await deleteCalendar.mutateAsync({ calendarId: calendarToRemove.id });
                    setCalendarToRemove(null);
                  } catch (error) {
                    setCalendarFeedback((error as Error).message ?? "Failed to remove calendar.");
                  }
                }}
              >
                Remove calendar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
