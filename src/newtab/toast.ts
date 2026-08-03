const toastEl = document.getElementById("toast")!;

let hideToastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(
  message: string,
  durationMs: number = 3000,
  onUndo?: () => void,
) {
  if (hideToastTimeout !== null) clearTimeout(hideToastTimeout);

  toastEl.innerHTML = message;
  if (onUndo) {
    const undoBtn = document.createElement("button");
    undoBtn.textContent = "Undo";
    undoBtn.addEventListener("click", () => {
      onUndo();
      toastEl.classList.add("hidden");
    });
    toastEl.appendChild(undoBtn);
  }
  toastEl.classList.remove("hidden");

  hideToastTimeout = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, durationMs);
}
