export const SEATING_STORAGE_KEY = "wips-office-seating-v1";

export function createSeatingStore({
  storage,
  normalizeSeating,
  swapSeats,
  onMessage,
} = {}) {
  const seatingKey = SEATING_STORAGE_KEY;
  const resolvedStorage = storage === undefined
    ? (typeof window !== "undefined" ? window.localStorage : null)
    : storage;

  let editing = false;
  let draggingOwner = null;
  let suppressClick = false;
  let saved = [];
  try {
    saved = JSON.parse(resolvedStorage?.getItem(seatingKey) ?? "[]");
  } catch {
    saved = [];
  }
  let order = normalizeSeating(saved);

  function persist(message) {
    try {
      resolvedStorage?.setItem(seatingKey, JSON.stringify(order));
      onMessage?.(message + " 이 브라우저에 저장했습니다.");
    } catch {
      onMessage?.(message + " 저장할 수 없어 현재 화면에만 적용됩니다.");
    }
  }

  return {
    isEditing() {
      return editing;
    },
    getOrder() {
      return order;
    },
    getDraggingOwner() {
      return draggingOwner;
    },
    syncEmployees(employees) {
      order = normalizeSeating(order);
      return order;
    },
    toggleEdit() {
      editing = !editing;
      return editing;
    },
    reset() {
      order = normalizeSeating([]);
      persist("기본 배치로 되돌렸습니다.");
      return order;
    },
    canDrop(owner, employees) {
      return editing && draggingOwner !== null && draggingOwner !== owner &&
        employees.includes(draggingOwner) && employees.includes(owner);
    },
    startDrag(owner) {
      draggingOwner = owner;
      suppressClick = true;
    },
    endDrag() {
      draggingOwner = null;
    },
    clearClickSuppression() {
      suppressClick = false;
    },
    consumeClickSuppression() {
      if (!suppressClick) return false;
      suppressClick = false;
      return true;
    },
    dropOn(targetOwner) {
      const source = draggingOwner;
      draggingOwner = null;
      order = swapSeats(order, source, targetOwner);
      persist(source + "와 " + targetOwner + "의 자리를 바꿨습니다.");
      return order;
    },
    swapWith(owner, target) {
      order = swapSeats(order, owner, target);
      persist(owner + "와 " + target + "의 자리를 바꿨습니다.");
      return order;
    },
  };
}
