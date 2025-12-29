<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import type { Person, Shift } from "../lib/types";
import {
  decodeName,
  formatTime,
  shortId,
  toLocalDateTimeParts,
  parseLocalDateTime,
} from "../lib/format";

const props = defineProps<{
  shifts: Shift[];
  calendarShifts: Shift[];
  people: Person[];
  shiftForm: {
    id: string;
    person_id: string;
    start_date: string;
    start_time: string;
    end_date: string;
    end_time: string;
  };
  shiftError: string | null;
  shiftMessage: string | null;
  shiftBusy: boolean;
  peopleBusy: boolean;
  calendarBusy: boolean;
  calendarError: string | null;
  calendarMessage: string | null;
}>();

const emit = defineEmits<{
  (event: "refreshShifts"): void;
  (event: "refreshPeople"): void;
  (event: "saveShift"): void;
  (event: "resetShiftForm"): void;
  (event: "editShift", shift: Shift): void;
  (event: "removeShift", shift: Shift): void;
  (event: "calendarRangeChange", range: { start_at: string; end_at: string }): void;
  (event: "calendarSubmit", payload: { id?: string; person_id: string; start_at: string; end_at: string }): void;
}>();

type ViewMode = "list" | "day" | "week" | "month";

const shiftForm = props.shiftForm;
const viewMode = ref<ViewMode>("list");
const anchorDate = ref(new Date());
const filterEnabled = ref(false);
const filterPersonId = ref("");
const selectedDayIndex = ref(0);
const calendarLocalError = ref<string | null>(null);
const calendarLocalMessage = ref<string | null>(null);
const dayColumnRefs = ref<HTMLElement[]>([]);
const radialRef = ref<SVGSVGElement | null>(null);
const shiftOverrides = reactive(new Map<string, { start: Date; end: Date }>());

const draft = reactive({
  active: false,
  dayIndex: 0,
  person_id: "",
  start: new Date(),
  end: new Date(),
});

const dragState = ref<{
  type: "start" | "end";
  shiftId: string | null;
  isDraft: boolean;
  dayIndex: number;
  person_id: string;
  originalStart: Date;
  originalEnd: Date;
} | null>(null);

const HOUR_HEIGHT = 48;
const MINUTE_STEP = 15;
const MIN_DURATION = 15;
const RADIAL_VIEWBOX = 360;
const RING_MINUTES = 12 * 60;
const EDGE_TOLERANCE_MINUTES = 15;

const hours = Array.from({ length: 24 }, (_, i) => i);

const viewDays = computed(() => {
  if (viewMode.value === "day") {
    return [startOfDay(anchorDate.value)];
  }
  if (viewMode.value === "week") {
    const start = startOfWeek(anchorDate.value);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return [] as Date[];
});

const viewRange = computed(() => {
  if (viewMode.value === "day") {
    const start = startOfDay(anchorDate.value);
    return { start, end: endOfDay(anchorDate.value) };
  }
  if (viewMode.value === "week") {
    const start = startOfWeek(anchorDate.value);
    return { start, end: endOfDay(addDays(start, 6)) };
  }
  if (viewMode.value === "month") {
    const start = startOfMonth(anchorDate.value);
    return { start, end: endOfMonth(anchorDate.value) };
  }
  return null;
});

const dayStart = computed(() => startOfDay(anchorDate.value));

const viewLabel = computed(() => {
  if (viewMode.value === "day") {
    return formatDate(anchorDate.value);
  }
  if (viewMode.value === "week") {
    const start = startOfWeek(anchorDate.value);
    const end = addDays(start, 6);
    return `${formatDate(start)} ~ ${formatDate(end)}`;
  }
  if (viewMode.value === "month") {
    return `${anchorDate.value.getFullYear()}年${anchorDate.value.getMonth() + 1}月`;
  }
  return "列表";
});

const canCreateDraft = computed(() => {
  if (viewMode.value === "month" || viewMode.value === "list") {
    return false;
  }
  const range = viewRange.value;
  if (!range) return false;
  return range.end.getTime() > Date.now();
});

const filteredCalendarShifts = computed(() => {
  if (!filterEnabled.value || !filterPersonId.value) {
    return props.calendarShifts;
  }
  return props.calendarShifts.filter((shift) => shift.person_id === filterPersonId.value);
});

const monthCells = computed(() => {
  if (viewMode.value !== "month") return [] as { date: Date | null; inMonth: boolean }[];
  const start = startOfMonth(anchorDate.value);
  const startOffset = (start.getDay() + 6) % 7;
  const cells: { date: Date | null; inMonth: boolean }[] = [];
  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ date: null, inMonth: false });
  }
  const daysInMonth = endOfMonth(anchorDate.value).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      date: new Date(anchorDate.value.getFullYear(), anchorDate.value.getMonth(), day),
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, inMonth: false });
  }
  return cells;
});

const monthShiftMap = computed(() => {
  const map = new Map<string, Shift[]>();
  filteredCalendarShifts.value.forEach((shift) => {
    const key = dateKey(new Date(shift.start_at));
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)?.push(shift);
  });
  return map;
});

const daySegments = computed(() => {
  if (viewMode.value !== "day" && viewMode.value !== "week") {
    return [] as Segment[][];
  }
  return viewDays.value.map((day, index) => buildSegmentsForDay(day, index));
});

const draftShift = computed<Shift | null>(() => {
  if (!draft.active) return null;
  const person = props.people.find((item) => item.id === draft.person_id);
  return {
    id: "draft",
    person_id: draft.person_id,
    person_name_b64: person?.person_name_b64 || "",
    start_at: draft.start.toISOString(),
    end_at: draft.end.toISOString(),
    created_at: "",
    updated_at: "",
  };
});

const draftSegment = computed(() => {
  if (!draft.active) return null;
  const day = viewDays.value[draft.dayIndex];
  if (!day) return null;
  const start = clampToDay(draft.start, day);
  const end = clampToDay(draft.end, day);
  const shift = draftShift.value;
  if (!shift) return null;
  const segment = buildSegment(day, draft.dayIndex, shift, start, end);
  segment.isDraft = true;
  return segment;
});

const dayShiftList = computed(() => {
  if (viewMode.value !== "day") return [] as Shift[];
  const start = dayStart.value;
  const end = addDays(start, 1);
  return filteredCalendarShifts.value.filter((shift) => {
    const shiftStart = new Date(shift.start_at);
    const shiftEnd = new Date(shift.end_at);
    return shiftEnd > start && shiftStart < end;
  });
});

const radialRingCount = computed(() => {
  if (viewMode.value !== "day") return 0;
  const base = dayStart.value.getTime();
  let maxMinutes = 24 * 60;
  filteredCalendarShifts.value.forEach((shift) => {
    const { end } = getShiftTimes(shift);
    const diff = (end.getTime() - base) / 60000;
    if (diff > maxMinutes) {
      maxMinutes = diff;
    }
  });
  if (draft.active) {
    const diff = (draft.end.getTime() - base) / 60000;
    if (diff > maxMinutes) {
      maxMinutes = diff;
    }
  }
  return Math.max(2, Math.ceil(maxMinutes / RING_MINUTES));
});

const radialLayout = computed(() =>
  getRadialLayout(RADIAL_VIEWBOX, Math.max(2, radialRingCount.value))
);

const radialRings = computed(() =>
  Array.from({ length: Math.max(2, radialRingCount.value) }, (_, index) => index)
);

const radialSegments = computed(() => {
  if (viewMode.value !== "day") return [] as RadialSegment[];
  const base = dayStart.value;
  const segments: RadialSegment[] = [];
  const shiftList: Array<{ shift: Shift; isDraft: boolean }> = filteredCalendarShifts.value.map(
    (shift) => ({ shift, isDraft: false })
  );
  const draftValue = draftShift.value;
  if (draftValue) {
    shiftList.push({ shift: draftValue, isDraft: true });
  }
  shiftList.forEach(({ shift, isDraft }) => {
    const times = isDraft
      ? { start: new Date(shift.start_at), end: new Date(shift.end_at) }
      : getShiftTimes(shift);
    const startMinutesRaw = (times.start.getTime() - base.getTime()) / 60000;
    const endMinutesRaw = (times.end.getTime() - base.getTime()) / 60000;
    if (endMinutesRaw <= 0) return;
    const startMinutes = Math.max(0, startMinutesRaw);
    const endMinutes = Math.max(startMinutes + MIN_DURATION, endMinutesRaw);
    const editable = isDraft ? true : isEditableShift(shift);
    const startRing = Math.floor(startMinutes / RING_MINUTES);
    const endRing = Math.floor((endMinutes - 1) / RING_MINUTES);
    for (let ring = startRing; ring <= endRing; ring += 1) {
      const ringStart = ring * RING_MINUTES;
      const ringEnd = ringStart + RING_MINUTES;
      const segStart = Math.max(startMinutes, ringStart);
      const segEnd = Math.min(endMinutes, ringEnd);
      if (segEnd <= segStart) continue;
      segments.push({
        shift,
        isDraft,
        editable,
        ringIndex: ring,
        startAngle: minutesToAngle(segStart - ringStart),
        endAngle: minutesToAngle(segEnd - ringStart),
        isStartEdge: ring === startRing,
        isEndEdge: ring === endRing,
      });
    }
  });
  return segments;
});

const radialHandles = computed(() => {
  if (viewMode.value !== "day") return [] as RadialHandle[];
  const base = dayStart.value;
  const layout = radialLayout.value;
  const handles: RadialHandle[] = [];
  const shiftList: Array<{ shift: Shift; isDraft: boolean }> = filteredCalendarShifts.value.map(
    (shift) => ({ shift, isDraft: false })
  );
  const draftValue = draftShift.value;
  if (draftValue) {
    shiftList.push({ shift: draftValue, isDraft: true });
  }
  shiftList.forEach(({ shift, isDraft }) => {
    const editable = isDraft ? true : isEditableShift(shift);
    if (!editable) return;
    const times = isDraft
      ? { start: new Date(shift.start_at), end: new Date(shift.end_at) }
      : getShiftTimes(shift);
    handles.push(buildRadialHandle(shift, isDraft, "start", times.start, base, layout));
    handles.push(buildRadialHandle(shift, isDraft, "end", times.end, base, layout));
  });
  return handles;
});

const radialDraftPickerStyle = computed(() => {
  if (viewMode.value !== "day" || !draft.active) return null;
  const handle = radialHandles.value.find((item) => item.isDraft && item.edge === "end");
  if (!handle) return null;
  const layout = radialLayout.value;
  const xPercent = (handle.cx / layout.size) * 100;
  const yPercent = (handle.cy / layout.size) * 100;
  return {
    left: `${xPercent}%`,
    top: `${yPercent}%`,
    transform: "translate(12px, -50%)",
  };
});

watch(
  [viewMode, anchorDate],
  () => {
    if (viewMode.value === "list") return;
    const range = viewRange.value;
    if (!range) return;
    emit("calendarRangeChange", {
      start_at: range.start.toISOString(),
      end_at: range.end.toISOString(),
    });
  },
  { immediate: true }
);

watch(viewMode, (mode) => {
  if (mode === "list" || mode === "month") {
    clearDraft();
  }
  selectedDayIndex.value = 0;
  if (mode === "week") {
    anchorDate.value = new Date();
  }
  if (mode !== "list" && !props.people.length) {
    emit("refreshPeople");
  }
});

watch(
  viewDays,
  (days) => {
    if (!draft.active) return;
    if (viewMode.value === "list" || viewMode.value === "month") return;
    const day = days[draft.dayIndex];
    if (!day) {
      cancelDraftWithError("草稿已失效，请重新创建");
      return;
    }
    moveDraftToDay(day);
  },
  { flush: "post" }
);

watch(
  () => props.people.map((person) => person.id).join(","),
  () => {
    if (filterEnabled.value && props.people.length) {
      if (!props.people.some((person) => person.id === filterPersonId.value)) {
        filterPersonId.value = props.people[0].id;
      }
    }
  }
);

watch(filterEnabled, (enabled) => {
  if (enabled && !filterPersonId.value && props.people.length) {
    filterPersonId.value = props.people[0].id;
  }
  if (!enabled) {
    filterPersonId.value = "";
  }
});

function setStartNow() {
  const parts = toLocalDateTimeParts(new Date().toISOString());
  shiftForm.start_date = parts.date;
  shiftForm.start_time = parts.time;
  if (!shiftForm.end_date || !shiftForm.end_time) {
    setEndFromStart(8);
  }
}

function copyStartToEnd() {
  if (!shiftForm.start_date || !shiftForm.start_time) return;
  shiftForm.end_date = shiftForm.start_date;
  shiftForm.end_time = shiftForm.start_time;
}

function setEndFromStart(hours: number) {
  if (!shiftForm.start_date || !shiftForm.start_time) return;
  const base = parseLocalDateTime(shiftForm.start_date, shiftForm.start_time);
  if (!base) return;
  const end = new Date(base.getTime() + hours * 60 * 60 * 1000);
  const parts = toLocalDateTimeParts(end.toISOString());
  shiftForm.end_date = parts.date;
  shiftForm.end_time = parts.time;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeOnly(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatTimeLabel(date: Date, includeDate: boolean) {
  const time = formatTimeOnly(date);
  if (!includeDate) return time;
  return `${formatDate(date)} ${time}`;
}

function isCrossDayShift(shift: Shift) {
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  return !isSameDay(start, end);
}

function getRadialLayout(size: number, ringCount: number) {
  const rings = Math.max(1, ringCount);
  const padding = 14;
  const innerRadius = 36;
  const maxRadius = size / 2 - padding;
  const ringStep = (maxRadius - innerRadius) / rings;
  const ringThickness = ringStep * 0.7;
  const ringGap = ringStep - ringThickness;
  return {
    size,
    center: size / 2,
    innerRadius,
    ringThickness,
    ringGap,
    ringStep,
  };
}

function ringRadius(layout: ReturnType<typeof getRadialLayout>, ringIndex: number) {
  return layout.innerRadius + layout.ringStep * ringIndex + layout.ringThickness / 2;
}

function minutesToAngle(minutes: number) {
  return (minutes / RING_MINUTES) * 360;
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const safeEnd = endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle;
  const start = polarToCartesian(centerX, centerY, radius, safeEnd);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = safeEnd - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function buildRadialHandle(
  shift: Shift,
  isDraft: boolean,
  edge: "start" | "end",
  time: Date,
  base: Date,
  layout: ReturnType<typeof getRadialLayout>
): RadialHandle {
  const minutes = Math.max(0, (time.getTime() - base.getTime()) / 60000);
  const ringIndex = Math.floor(minutes / RING_MINUTES);
  const angle = minutesToAngle(minutes - ringIndex * RING_MINUTES);
  const radius = ringRadius(layout, ringIndex);
  const point = polarToCartesian(layout.center, layout.center, radius, angle);
  return {
    shiftId: shift.id,
    isDraft,
    edge,
    person_id: shift.person_id,
    cx: point.x,
    cy: point.y,
    editable: true,
  };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function startOfWeek(date: Date) {
  return startOfDay(date);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clearDraft() {
  draft.active = false;
  calendarLocalError.value = null;
  calendarLocalMessage.value = null;
}

function cancelDraftWithError(message: string) {
  draft.active = false;
  calendarLocalError.value = message;
  calendarLocalMessage.value = null;
}

function refreshCurrentView() {
  calendarLocalError.value = null;
  calendarLocalMessage.value = null;
  if (viewMode.value === "list") {
    emit("refreshShifts");
    return;
  }
  const range = viewRange.value;
  if (!range) return;
  emit("calendarRangeChange", {
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
  });
}

function goPrev() {
  if (viewMode.value === "day") {
    anchorDate.value = addDays(anchorDate.value, -1);
    return;
  }
  if (viewMode.value === "week") {
    anchorDate.value = addDays(anchorDate.value, -7);
    return;
  }
  if (viewMode.value === "month") {
    anchorDate.value = new Date(anchorDate.value.getFullYear(), anchorDate.value.getMonth() - 1, 1);
  }
}

function goNext() {
  if (viewMode.value === "day") {
    anchorDate.value = addDays(anchorDate.value, 1);
    return;
  }
  if (viewMode.value === "week") {
    anchorDate.value = addDays(anchorDate.value, 7);
    return;
  }
  if (viewMode.value === "month") {
    anchorDate.value = new Date(anchorDate.value.getFullYear(), anchorDate.value.getMonth() + 1, 1);
  }
}

function goToday() {
  anchorDate.value = new Date();
}

function selectDay(index: number) {
  selectedDayIndex.value = index;
  if (draft.active) {
    const day = viewDays.value[index];
    if (!day) return;
    if (!moveDraftToDay(day)) {
      return;
    }
    draft.dayIndex = index;
  }
}

function findDayIndexByDate(date: Date) {
  return viewDays.value.findIndex((day) => isSameDay(day, date));
}

function clampToDay(value: Date, day: Date) {
  const start = startOfDay(day).getTime();
  const end = addDays(startOfDay(day), 1).getTime();
  const clamped = Math.min(Math.max(value.getTime(), start), end);
  return new Date(clamped);
}

function roundToStep(date: Date) {
  const stepMs = MINUTE_STEP * 60 * 1000;
  const rounded = Math.ceil(date.getTime() / stepMs) * stepMs;
  return new Date(rounded);
}

function applyTimeToDay(day: Date, source: Date) {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    source.getHours(),
    source.getMinutes(),
    0,
    0
  );
}

function moveDraftToDay(day: Date) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const now = new Date();
  if (dayEnd <= now) {
    cancelDraftWithError("过去时间段只读，草稿已取消");
    return false;
  }
  const durationMs = Math.max(
    draft.end.getTime() - draft.start.getTime(),
    MIN_DURATION * 60 * 1000
  );
  let start = applyTimeToDay(day, draft.start);
  const minStart = addMinutes(dayStart, getMinNowMinutes(dayStart));
  const maxStart = addMinutes(dayStart, 24 * 60 - MIN_DURATION);
  if (start < minStart) {
    start = minStart;
  }
  if (start > maxStart) {
    cancelDraftWithError("过去时间段只读，草稿已取消");
    return false;
  }
  let end = new Date(start.getTime() + durationMs);
  if (end > dayEnd) {
    end = dayEnd;
    const minEnd = new Date(start.getTime() + MIN_DURATION * 60 * 1000);
    if (end < minEnd) {
      const adjustedStart = new Date(dayEnd.getTime() - MIN_DURATION * 60 * 1000);
      if (adjustedStart < minStart) {
        cancelDraftWithError("过去时间段只读，草稿已取消");
        return false;
      }
      start = adjustedStart;
      end = dayEnd;
    }
  }
  draft.start = start;
  draft.end = end;
  return true;
}

function createDraft() {
  calendarLocalError.value = null;
  calendarLocalMessage.value = null;
  if (!props.people.length) {
    calendarLocalError.value = "暂无可用人员，请先创建用户";
    return;
  }
  if (!canCreateDraft.value || viewMode.value === "list" || viewMode.value === "month") {
    calendarLocalError.value = "当前视图不可新建班次";
    return;
  }
  const days = viewDays.value;
  const dayIndex = Math.min(selectedDayIndex.value, days.length - 1);
  const day = days[dayIndex];
  if (!day) return;
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const now = new Date();
  if (dayEnd <= now) {
    calendarLocalError.value = "过去时间段只读";
    return;
  }
  let start = dayStart;
  if (now > dayStart && now < dayEnd) {
    start = roundToStep(now);
  } else {
    start = new Date(dayStart.getTime() + 9 * 60 * 60 * 1000);
  }
  if (start >= dayEnd) {
    calendarLocalError.value = "该日期已过期";
    return;
  }
  let end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  if (end > dayEnd) {
    const minEnd = new Date(start.getTime() + MIN_DURATION * 60 * 1000);
    end = minEnd > dayEnd ? dayEnd : minEnd;
  }
  const defaultPerson = filterEnabled.value && filterPersonId.value ? filterPersonId.value : props.people[0].id;
  draft.active = true;
  draft.dayIndex = dayIndex;
  draft.person_id = defaultPerson;
  draft.start = start;
  draft.end = end;
  calendarLocalMessage.value = "草稿已生成，拖动端点调整后保存";
}

function cancelDraft() {
  clearDraft();
}

function saveDraft() {
  if (!draft.active) return;
  if (!draft.person_id) {
    calendarLocalError.value = "请选择人员";
    return;
  }
  if (draft.end <= draft.start) {
    calendarLocalError.value = "结束时间必须晚于开始时间";
    return;
  }
  emit("calendarSubmit", {
    person_id: draft.person_id,
    start_at: draft.start.toISOString(),
    end_at: draft.end.toISOString(),
  });
  draft.active = false;
  calendarLocalMessage.value = "已提交创建请求";
}

function cycleDraftPerson(event: WheelEvent) {
  if (!props.people.length) return;
  const delta = Math.sign(event.deltaY);
  if (delta === 0) return;
  const list = props.people;
  const currentIndex = list.findIndex((person) => person.id === draft.person_id);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + list.length) % list.length;
  draft.person_id = list[nextIndex].id;
}

function startDrag(event: MouseEvent, segment: Segment, edge: "start" | "end") {
  if (!segment.editable) return;
  event.preventDefault();
  dragState.value = {
    type: edge,
    shiftId: segment.isDraft ? null : segment.shift.id,
    isDraft: segment.isDraft,
    dayIndex: segment.dayIndex,
    person_id: segment.shift.person_id,
    originalStart: new Date(segment.shift.start_at),
    originalEnd: new Date(segment.shift.end_at),
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function startRadialDrag(event: MouseEvent, handle: RadialHandle) {
  if (!handle.editable) return;
  const shift = handle.isDraft
    ? draftShift.value
    : filteredCalendarShifts.value.find((item) => item.id === handle.shiftId);
  if (!shift) return;
  beginRadialDrag(event, shift, handle.isDraft, handle.edge);
}

function startRadialSegmentDrag(event: MouseEvent, segment: RadialSegment) {
  if (!segment.editable) return;
  if (!segment.isStartEdge && !segment.isEndEdge) return;
  const shift = segment.isDraft ? draftShift.value : segment.shift;
  if (!shift) return;
  const point = getRadialPoint(event);
  if (!point) return;
  const tolerance = (EDGE_TOLERANCE_MINUTES / RING_MINUTES) * 360;
  const nearStart = segment.isStartEdge && angleDistance(point.angle, segment.startAngle) <= tolerance;
  const nearEnd = segment.isEndEdge && angleDistance(point.angle, segment.endAngle) <= tolerance;
  let edge: "start" | "end" | null = null;
  if (nearStart && nearEnd) {
    edge =
      angleDistance(point.angle, segment.startAngle) <=
      angleDistance(point.angle, segment.endAngle)
        ? "start"
        : "end";
  } else if (nearStart) {
    edge = "start";
  } else if (nearEnd) {
    edge = "end";
  } else {
    return;
  }
  if (!edge) return;
  beginRadialDrag(event, shift, segment.isDraft, edge);
}

function beginRadialDrag(event: MouseEvent, shift: Shift, isDraft: boolean, edge: "start" | "end") {
  event.preventDefault();
  dragState.value = {
    type: edge,
    shiftId: isDraft ? null : shift.id,
    isDraft,
    dayIndex: 0,
    person_id: shift.person_id,
    originalStart: new Date(shift.start_at),
    originalEnd: new Date(shift.end_at),
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onDragMove(event: MouseEvent) {
  const state = dragState.value;
  if (!state) return;
  const target = getDragTarget(event);
  if (!target) return;
  if (state.isDraft) {
    const next = applyMinutesToDraft(target.dayIndex, target.minutes, state.type);
    if (!next) return;
    draft.start = next.start;
    draft.end = next.end;
    if (state.type === "start") {
      const nextIndex = findDayIndexByDate(next.start);
      if (nextIndex >= 0) {
        draft.dayIndex = nextIndex;
      }
    }
    return;
  }
  if (state.shiftId) {
    const shift = filteredCalendarShifts.value.find((item) => item.id === state.shiftId);
    if (!shift) return;
    const next = applyMinutesToShift(shift, target.dayIndex, target.minutes, state.type);
    if (!next) return;
    shiftOverrides.set(shift.id, next);
  }
}

function onDragEnd() {
  const state = dragState.value;
  if (!state) return;
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  if (state.isDraft) {
    dragState.value = null;
    return;
  }
  if (state.shiftId) {
    const override = shiftOverrides.get(state.shiftId);
    if (override) {
      const changed =
        override.start.getTime() !== state.originalStart.getTime() ||
        override.end.getTime() !== state.originalEnd.getTime();
      if (changed) {
        emit("calendarSubmit", {
          id: state.shiftId,
          person_id: state.person_id,
          start_at: override.start.toISOString(),
          end_at: override.end.toISOString(),
        });
      }
      shiftOverrides.delete(state.shiftId);
    }
  }
  dragState.value = null;
}

function getDragTarget(event: MouseEvent) {
  if (viewMode.value === "day") {
    return getRadialTarget(event);
  }
  return getColumnTarget(event);
}

function getColumnTarget(event: MouseEvent) {
  const columns = dayColumnRefs.value;
  if (!columns.length) return null;
  let targetIndex = -1;
  for (let index = 0; index < columns.length; index += 1) {
    const rect = columns[index].getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex === -1) {
    const firstRect = columns[0].getBoundingClientRect();
    const lastRect = columns[columns.length - 1].getBoundingClientRect();
    if (event.clientX < firstRect.left) {
      targetIndex = 0;
    } else if (event.clientX > lastRect.right) {
      targetIndex = columns.length - 1;
    } else {
      return null;
    }
  }
  const column = columns[targetIndex];
  const rect = column.getBoundingClientRect();
  const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
  const rawMinutes = (offsetY / rect.height) * 24 * 60;
  const snapped = Math.round(rawMinutes / MINUTE_STEP) * MINUTE_STEP;
  return {
    dayIndex: targetIndex,
    minutes: Math.min(24 * 60, Math.max(0, snapped)),
  };
}

function getRadialTarget(event: MouseEvent) {
  const point = getRadialPoint(event);
  if (!point) return null;
  const layout = radialLayout.value;
  const ringIndex = Math.max(0, Math.floor((point.distance - layout.innerRadius) / layout.ringStep));
  const minutes = ringIndex * RING_MINUTES + (point.angle / 360) * RING_MINUTES;
  const snapped = Math.round(minutes / MINUTE_STEP) * MINUTE_STEP;
  return {
    dayIndex: 0,
    minutes: Math.max(0, snapped),
  };
}

function getRadialPoint(event: MouseEvent) {
  const host = radialRef.value;
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  if (!size) return null;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const scale = RADIAL_VIEWBOX / size;
  const dx = (event.clientX - centerX) * scale;
  const dy = (event.clientY - centerY) * scale;
  const distance = Math.sqrt(dx * dx + dy * dy);
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (angle < 0) {
    angle += 360;
  }
  return { distance, angle };
}

function angleDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function applyMinutesToDraft(dayIndex: number, minutes: number, edge: "start" | "end") {
  const day = viewDays.value[dayIndex];
  if (!day) return null;
  const dayStart = startOfDay(day);
  const target = addMinutes(dayStart, minutes);
  const now = new Date();
  if (target.getTime() < now.getTime()) {
    return null;
  }
  let start = new Date(draft.start);
  let end = new Date(draft.end);
  if (edge === "start") {
    start = target;
    if (end <= start) {
      end = addMinutes(start, MIN_DURATION);
    }
  } else {
    end = target;
    if (end <= start) {
      start = addMinutes(end, -MIN_DURATION);
    }
  }
  if (start.getTime() < now.getTime()) {
    return null;
  }
  return { start, end };
}

function applyMinutesToShift(shift: Shift, dayIndex: number, minutes: number, edge: "start" | "end") {
  const day = viewDays.value[dayIndex];
  if (!day) return null;
  const originalStart = new Date(shift.start_at);
  const originalEnd = new Date(shift.end_at);
  const dayStart = startOfDay(day);
  const target = addMinutes(dayStart, minutes);
  const now = new Date();
  if (target.getTime() < now.getTime()) {
    return null;
  }
  let start = new Date(originalStart);
  let end = new Date(originalEnd);
  if (edge === "start") {
    start = target;
    if (end <= start) {
      end = addMinutes(start, MIN_DURATION);
    }
  } else {
    end = target;
    if (end <= start) {
      start = addMinutes(end, -MIN_DURATION);
    }
  }
  if (start.getTime() < now.getTime()) {
    return null;
  }
  return { start, end };
}

function getMinNowMinutes(dayStart: Date) {
  const now = new Date();
  if (!isSameDay(now, dayStart)) {
    return 0;
  }
  const diff = now.getTime() - dayStart.getTime();
  return Math.max(0, Math.ceil(diff / (MINUTE_STEP * 60 * 1000)) * MINUTE_STEP);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function getShiftTimes(shift: Shift) {
  const override = shiftOverrides.get(shift.id);
  if (override) {
    return { start: override.start, end: override.end };
  }
  return { start: new Date(shift.start_at), end: new Date(shift.end_at) };
}

function isEditableShift(shift: Shift) {
  const { start } = getShiftTimes(shift);
  if (viewMode.value === "month") return false;
  if (viewMode.value === "list") return false;
  return start.getTime() >= Date.now();
}

type Segment = {
  shift: Shift;
  dayIndex: number;
  top: number;
  height: number;
  start: Date;
  end: Date;
  editable: boolean;
  handleStart: boolean;
  handleEnd: boolean;
  isDraft: boolean;
};

type RadialSegment = {
  shift: Shift;
  isDraft: boolean;
  editable: boolean;
  ringIndex: number;
  startAngle: number;
  endAngle: number;
  isStartEdge: boolean;
  isEndEdge: boolean;
};

type RadialHandle = {
  shiftId: string;
  isDraft: boolean;
  edge: "start" | "end";
  person_id: string;
  cx: number;
  cy: number;
  editable: boolean;
};

function buildSegmentsForDay(day: Date, dayIndex: number) {
  const segments: Segment[] = [];
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const shiftItems: Array<{ shift: Shift; isDraft: boolean }> = filteredCalendarShifts.value.map(
    (shift) => ({ shift, isDraft: false })
  );
  const draftValue = draftShift.value;
  if (draftValue) {
    shiftItems.push({ shift: draftValue, isDraft: true });
  }
  shiftItems.forEach(({ shift, isDraft }) => {
    const times = isDraft
      ? { start: new Date(shift.start_at), end: new Date(shift.end_at) }
      : getShiftTimes(shift);
    const start = times.start;
    const end = times.end;
    if (end <= dayStart || start >= dayEnd) {
      return;
    }
    const segmentStart = start < dayStart ? dayStart : start;
    const segmentEnd = end > dayEnd ? dayEnd : end;
    const segment = buildSegment(day, dayIndex, shift, segmentStart, segmentEnd);
    segment.editable = isDraft ? true : isEditableShift(shift);
    segment.handleStart = isSameDay(start, day);
    segment.handleEnd = isSameDay(end, day);
    segment.isDraft = isDraft;
    segments.push(segment);
  });
  return segments;
}

function buildSegment(
  day: Date,
  dayIndex: number,
  shift: Shift,
  displayStart: Date,
  displayEnd: Date
): Segment {
  const dayStart = startOfDay(day);
  const startMinutes = Math.max(0, (displayStart.getTime() - dayStart.getTime()) / 60000);
  const endMinutes = Math.min(24 * 60, (displayEnd.getTime() - dayStart.getTime()) / 60000);
  const heightMinutes = Math.max(endMinutes - startMinutes, MIN_DURATION);
  return {
    shift,
    dayIndex,
    top: (startMinutes / (24 * 60)) * 100,
    height: (heightMinutes / (24 * 60)) * 100,
    start: displayStart,
    end: displayEnd,
    editable: false,
    handleStart: false,
    handleEnd: false,
    isDraft: false,
  };
}

function segmentStyle(segment: Segment) {
  return {
    top: `${segment.top}%`,
    height: `${segment.height}%`,
  };
}

function draftPickerStyle(segment: Segment | null) {
  if (!segment) return {};
  return {
    top: `${segment.top}%`,
  };
}

function draftPickerPosition(dayIndex: number) {
  if (viewMode.value === "day") {
    return "right-2";
  }
  const lastIndex = Math.max(viewDays.value.length - 1, 0);
  if (dayIndex >= lastIndex) {
    return "right-full mr-2";
  }
  return "left-full ml-2";
}

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">班次管理</h2>
      <div class="flex flex-wrap items-center gap-2">
        <div class="join">
          <button
            class="btn btn-sm join-item"
            :class="viewMode === 'list' ? 'btn-active' : ''"
            @click="viewMode = 'list'"
          >
            列表
          </button>
          <button
            class="btn btn-sm join-item"
            :class="viewMode === 'day' ? 'btn-active' : ''"
            @click="viewMode = 'day'"
          >
            日
          </button>
          <button
            class="btn btn-sm join-item"
            :class="viewMode === 'week' ? 'btn-active' : ''"
            @click="viewMode = 'week'"
          >
            周
          </button>
          <button
            class="btn btn-sm join-item"
            :class="viewMode === 'month' ? 'btn-active' : ''"
            @click="viewMode = 'month'"
          >
            月
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" @click="refreshCurrentView" :disabled="shiftBusy || calendarBusy">
          刷新
        </button>
      </div>
    </div>

    <div v-if="viewMode === 'list'" class="grid xl:grid-cols-[1fr_1.4fr] gap-6">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-4">
          <h3 class="card-title">{{ shiftForm.id ? "编辑班次" : "创建班次" }}</h3>
          <div class="space-y-3">
            <label class="form-control">
              <div class="label">
                <span class="label-text">人员</span>
              </div>
              <select v-model="shiftForm.person_id" class="select select-bordered">
                <option disabled value="">请选择人员</option>
                <option v-for="person in people" :key="person.id" :value="person.id">
                  {{ decodeName(person.person_name_b64) }} · {{ shortId(person.id) }}
                </option>
              </select>
            </label>
            <div class="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">开始日期</span>
                </div>
                <input v-model="shiftForm.start_date" class="input input-bordered" type="date" />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">开始时间</span>
                </div>
                <input
                  v-model="shiftForm.start_time"
                  class="input input-bordered"
                  type="time"
                  step="60"
                  lang="zh-CN"
                  placeholder="HH:mm"
                />
              </label>
              <button class="btn btn-outline btn-sm" type="button" @click="setStartNow">
                开始=现在
              </button>
            </div>
            <div class="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">结束日期</span>
                </div>
                <input v-model="shiftForm.end_date" class="input input-bordered" type="date" />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">结束时间</span>
                </div>
                <input
                  v-model="shiftForm.end_time"
                  class="input input-bordered"
                  type="time"
                  step="60"
                  lang="zh-CN"
                  placeholder="HH:mm"
                />
              </label>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-outline btn-sm" type="button" @click="copyStartToEnd">
                  结束=开始
                </button>
                <button class="btn btn-outline btn-sm" type="button" @click="setEndFromStart(8)">
                  结束+8h
                </button>
              </div>
            </div>
          </div>
          <div v-if="shiftError" class="text-xs text-error">{{ shiftError }}</div>
          <div v-if="shiftMessage" class="text-xs text-success">{{ shiftMessage }}</div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-primary" :disabled="shiftBusy" @click="emit('saveShift')">
              {{ shiftForm.id ? "保存更新" : "创建班次" }}
            </button>
            <button class="btn btn-ghost" type="button" @click="emit('resetShiftForm')">
              清空表单
            </button>
            <button class="btn btn-ghost" type="button" @click="emit('refreshPeople')" :disabled="peopleBusy">
              刷新人员
            </button>
          </div>
          <div class="text-xs text-base-content/60">
            使用人员目录选择班次归属，日期与时间分别输入以避免兼容性问题。
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="card-title">即将到来的班次</h3>
            <span class="text-xs text-base-content/60">共 {{ shifts.length }} 条</span>
          </div>
          <div class="space-y-3">
            <div
              v-for="shift in shifts"
              :key="shift.id"
              class="rounded-2xl border border-base-200 bg-base-100 p-4 space-y-2"
            >
              <div class="flex items-center justify-between">
                <div class="text-lg font-semibold">
                  {{ decodeName(shift.person_name_b64) }}
                </div>
                <span class="badge badge-outline">{{ shortId(shift.person_id) }}</span>
              </div>
              <div class="text-sm text-base-content/70">
                {{ formatTime(shift.start_at) }} → {{ formatTime(shift.end_at) }}
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-xs btn-outline" @click="emit('editShift', shift)">
                  编辑
                </button>
                <button class="btn btn-xs btn-error btn-outline" @click="emit('removeShift', shift)">
                  删除
                </button>
              </div>
              <div class="text-xs text-base-content/50">班次 ID: {{ shift.id }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="space-y-4">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <div class="join">
                <button class="btn btn-sm join-item" @click="goPrev">上一{{ viewMode === 'week' ? '周' : viewMode === 'month' ? '月' : '天' }}</button>
                <button class="btn btn-sm join-item" @click="goToday">今天</button>
                <button class="btn btn-sm join-item" @click="goNext">下一{{ viewMode === 'week' ? '周' : viewMode === 'month' ? '月' : '天' }}</button>
              </div>
              <div class="text-sm font-semibold">{{ viewLabel }}</div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <label class="cursor-pointer label justify-start gap-2">
                <input v-model="filterEnabled" type="checkbox" class="checkbox checkbox-sm" />
                <span class="label-text">筛选人员</span>
              </label>
              <select v-model="filterPersonId" class="select select-bordered select-sm" :disabled="!filterEnabled">
                <option disabled value="">选择人员</option>
                <option v-for="person in people" :key="person.id" :value="person.id">
                  {{ decodeName(person.person_name_b64) }}
                </option>
              </select>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button class="btn btn-primary btn-sm" :disabled="!canCreateDraft" @click="createDraft">新建</button>
              <button v-if="draft.active" class="btn btn-ghost btn-sm" @click="saveDraft">保存草稿</button>
              <button v-if="draft.active" class="btn btn-ghost btn-sm" @click="cancelDraft">取消草稿</button>
            </div>
          </div>
          <div class="text-xs text-base-content/60">
            月视图与过去时间段只读；日/周视图支持拖动端点调整时间。
          </div>
          <div v-if="calendarError" class="text-xs text-error">{{ calendarError }}</div>
          <div v-if="calendarLocalError" class="text-xs text-error">{{ calendarLocalError }}</div>
          <div v-if="shiftError" class="text-xs text-error">{{ shiftError }}</div>
          <div v-if="calendarMessage" class="text-xs text-success">{{ calendarMessage }}</div>
          <div v-if="calendarLocalMessage" class="text-xs text-success">{{ calendarLocalMessage }}</div>
          <div v-if="shiftMessage" class="text-xs text-success">{{ shiftMessage }}</div>

          <div v-if="viewMode === 'month'" class="space-y-3">
            <div class="grid grid-cols-7 text-xs text-base-content/60">
              <div class="p-2">一</div>
              <div class="p-2">二</div>
              <div class="p-2">三</div>
              <div class="p-2">四</div>
              <div class="p-2">五</div>
              <div class="p-2">六</div>
              <div class="p-2">日</div>
            </div>
            <div class="grid grid-cols-7 gap-2">
              <div
                v-for="(cell, index) in monthCells"
                :key="cell.date ? cell.date.toISOString() : index"
                class="border border-base-200 rounded-xl min-h-[100px] p-2 bg-base-100"
                :class="cell.inMonth ? '' : 'opacity-40'"
              >
                <div class="text-xs font-semibold mb-2">
                  {{ cell.date ? cell.date.getDate() : '' }}
                </div>
                <div v-if="cell.date" class="space-y-1">
                  <template v-for="shift in (monthShiftMap.get(dateKey(cell.date)) || []).slice(0, 3)" :key="shift.id">
                    <div class="text-[10px] text-base-content/70 truncate">
                      {{ decodeName(shift.person_name_b64) }} {{ formatTimeOnly(shift.start_at) }}
                    </div>
                  </template>
                  <div
                    v-if="(monthShiftMap.get(dateKey(cell.date)) || []).length > 3"
                    class="text-[10px] text-base-content/50"
                  >
                    +{{ (monthShiftMap.get(dateKey(cell.date)) || []).length - 3 }} 条
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="viewMode === 'day'" class="border border-base-200 rounded-2xl bg-base-100 p-4">
            <div class="flex flex-wrap lg:flex-nowrap gap-6 items-start">
              <div class="relative w-full max-w-[420px] aspect-square mx-auto overflow-visible">
                <svg
                  ref="radialRef"
                  :viewBox="`0 0 ${radialLayout.size} ${radialLayout.size}`"
                  class="w-full h-full"
                >
                  <g v-for="ring in radialRings" :key="ring">
                    <circle
                      :cx="radialLayout.center"
                      :cy="radialLayout.center"
                      :r="ringRadius(radialLayout, ring)"
                      :stroke-width="radialLayout.ringThickness"
                      stroke="currentColor"
                      fill="none"
                      opacity="0.25"
                      class="text-base-200"
                    />
                  </g>
                  <g
                    v-for="segment in radialSegments"
                    :key="`${segment.shift.id}-${segment.ringIndex}-${segment.startAngle}`"
                  >
                    <path
                      :d="describeArc(radialLayout.center, radialLayout.center, ringRadius(radialLayout, segment.ringIndex), segment.startAngle, segment.endAngle)"
                      stroke="currentColor"
                      :stroke-width="radialLayout.ringThickness"
                      stroke-linecap="round"
                      fill="none"
                      pointer-events="stroke"
                      :opacity="segment.editable ? 1 : 0.7"
                      :class="segment.isDraft ? 'text-accent' : segment.editable ? 'text-primary' : 'text-base-300'"
                      @mousedown="startRadialSegmentDrag($event, segment)"
                    />
                  </g>
                  <text
                    :x="radialLayout.center"
                    :y="radialLayout.center"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill="hsl(var(--bc))"
                    class="text-[10px]"
                  >
                    {{ formatDate(anchorDate) }}
                  </text>
                </svg>

                <div
                  v-if="draft.active && radialDraftPickerStyle"
                  class="absolute w-40 rounded-xl border border-base-200 bg-base-100 p-2 shadow-lg z-30"
                  :style="radialDraftPickerStyle"
                  @wheel.prevent="cycleDraftPerson"
                >
                  <div class="text-[10px] text-base-content/50">人员（滚轮切换）</div>
                  <select v-model="draft.person_id" class="select select-bordered select-xs w-full mt-1">
                    <option v-for="person in people" :key="person.id" :value="person.id">
                      {{ decodeName(person.person_name_b64) }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="flex-1 min-w-[220px] space-y-3">
                <div class="text-xs text-base-content/60">
                  顶部为 00:00，顺时针递增，每一圈 12 小时；向外拖动可延展到下一天。
                </div>
                <div
                  v-if="draft.active"
                  class="rounded-xl border border-accent/40 bg-accent/10 p-2 text-xs"
                >
                  草稿：
                  {{ decodeName(people.find((person) => person.id === draft.person_id)?.person_name_b64 || '') }}
                  {{ formatTimeLabel(draft.start, true) }} → {{ formatTimeLabel(draft.end, true) }}
                </div>
                <div v-if="!dayShiftList.length" class="text-xs text-base-content/50">
                  当日暂无班次
                </div>
                <div
                  v-for="shift in dayShiftList"
                  :key="shift.id"
                  class="rounded-xl border border-base-200 bg-base-100 p-3 text-xs space-y-1"
                >
                  <div class="font-semibold">{{ decodeName(shift.person_name_b64) }}</div>
                  <div class="text-base-content/70">
                    {{
                      formatTimeLabel(new Date(shift.start_at), true)
                    }} →
                    {{
                      formatTimeLabel(new Date(shift.end_at), true)
                    }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="border border-base-200 rounded-2xl bg-base-100 overflow-auto">
            <div class="min-w-[640px]">
              <div
                class="grid text-xs text-base-content/60 border-b border-base-200"
                :style="{ gridTemplateColumns: `72px repeat(${viewDays.length}, minmax(0, 1fr))` }"
              >
                <div class="p-2"></div>
                <button
                  v-for="(day, index) in viewDays"
                  :key="day.toISOString()"
                  class="p-2 text-left"
                  :class="selectedDayIndex === index ? 'bg-base-200/60 font-semibold' : ''"
                  @click="selectDay(index)"
                >
                  {{ day.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }) }}
                </button>
              </div>
              <div
                class="grid"
                :style="{ gridTemplateColumns: `72px repeat(${viewDays.length}, minmax(0, 1fr))` }"
              >
                <div class="text-[11px] text-base-content/60">
                  <div
                    v-for="hour in hours"
                    :key="hour"
                    class="flex items-start justify-end pr-2"
                    :style="{ height: `${HOUR_HEIGHT}px` }"
                  >
                    {{ hour.toString().padStart(2, '0') }}:00
                  </div>
                </div>
                <div
                  v-for="(day, dayIndex) in viewDays"
                  :key="day.toISOString()"
                  ref="dayColumnRefs"
                  class="relative border-l border-base-200"
                  :style="{ height: `${HOUR_HEIGHT * 24}px` }"
                >
                  <div class="absolute inset-0 grid grid-rows-24 pointer-events-none">
                    <div v-for="hour in hours" :key="hour" class="border-b border-base-200/70"></div>
                  </div>
                  <div
                    v-for="segment in daySegments[dayIndex]"
                    :key="`${segment.shift.id}-${segment.dayIndex}-${segment.start.toISOString()}`"
                    class="absolute left-2 right-2 rounded-xl px-2 py-1 text-xs shadow-sm"
                    :class="segment.isDraft ? 'bg-accent/20 border border-accent/40' : segment.editable ? 'bg-primary/15 border border-primary/40' : 'bg-base-200/80 border border-base-300'"
                    :style="segmentStyle(segment)"
                  >
                    <div class="flex items-center justify-between text-[10px] text-base-content/70">
                      <span>{{ formatTimeOnly(segment.start) }}</span>
                      <span>{{ formatTimeOnly(segment.end) }}</span>
                    </div>
                    <div class="font-semibold truncate">
                      {{ segment.isDraft ? "草稿班次" : decodeName(segment.shift.person_name_b64) }}
                    </div>
                    <div class="text-[10px] text-base-content/60 truncate">
                      {{ segment.isDraft ? decodeName(segment.shift.person_name_b64) : shortId(segment.shift.person_id) }}
                    </div>
                    <button
                      v-if="segment.editable && segment.handleStart"
                      class="absolute left-2 right-2 top-0 h-2 cursor-ns-resize"
                      type="button"
                      @mousedown="startDrag($event, segment, 'start')"
                    ></button>
                    <button
                      v-if="segment.editable && segment.handleEnd"
                      class="absolute left-2 right-2 bottom-0 h-2 cursor-ns-resize"
                      type="button"
                      @mousedown="startDrag($event, segment, 'end')"
                    ></button>
                  </div>

                  <div
                    v-if="draft.active && draft.dayIndex === dayIndex && draftSegment"
                    class="absolute w-40 rounded-xl border border-base-200 bg-base-100 p-2 shadow-lg z-30"
                    :class="draftPickerPosition(dayIndex)"
                    :style="draftPickerStyle(draftSegment)"
                    @wheel.prevent="cycleDraftPerson"
                  >
                    <div class="text-[10px] text-base-content/50">人员（滚轮切换）</div>
                    <select v-model="draft.person_id" class="select select-bordered select-xs w-full mt-1">
                      <option v-for="person in people" :key="person.id" :value="person.id">
                        {{ decodeName(person.person_name_b64) }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
