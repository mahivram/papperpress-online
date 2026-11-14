const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const modeInput = document.querySelector("#mode");
const compressButton = document.querySelector("#compress");
let selectedFile = null;
let downloadUrl = null;

const requestedTarget = new URLSearchParams(location.search).get("target");
if (requestedTarget) {
  modeInput.value = "target";
  document.querySelector("#target-kb").value = requestedTarget;
  document.querySelector("#level-wrap").hidden = true;
  document.querySelector("#target-wrap").hidden = false;
}

function setFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    document.querySelector("#file-info").textContent = "Choose a PDF file.";
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    document.querySelector("#file-info").textContent = "This file is over the 100 MB upload limit.";
    return;
  }
  selectedFile = file;
  document.querySelector("#file-info").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  compressButton.disabled = false;
  document.querySelector("#result").hidden = true;
}

fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
for (const name of ["dragenter", "dragover"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
for (const name of ["dragleave", "drop"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
dropZone.addEventListener("drop", (event) => setFile(event.dataTransfer.files[0]));
modeInput.addEventListener("change", () => {
  const targeting = modeInput.value === "target";
  document.querySelector("#level-wrap").hidden = targeting;
  document.querySelector("#target-wrap").hidden = !targeting;
});
compressButton.addEventListener("click", async () => {
  if (!selectedFile) return;
  const targetKb = Number(document.querySelector("#target-kb").value);
  if (modeInput.value === "target" && (!Number.isFinite(targetKb) || targetKb < 10 || targetKb > 102400)) {
    document.querySelector("#progress-wrap").hidden = false;
    document.querySelector("#status").textContent = "Enter a target between 10 KB and 102400 KB.";
    return;
  }
  const data = new FormData();
  data.append("file", selectedFile);
  data.append("mode", modeInput.value);
  data.append("level", document.querySelector("#level").value);
  data.append("targetKb", String(targetKb));
  compressButton.disabled = true;
  document.querySelector("#result").hidden = true;
  document.querySelector("#progress-wrap").hidden = false;
  document.querySelector("#progress-bar").style.width = "20%";
  document.querySelector("#status").textContent = "Uploading and compressing your PDF…";
  try {
    const apiBaseUrl = window.PDF_COMPRESSOR_API_BASE_URL;
    if (!apiBaseUrl) throw new Error("The compression API is not configured.");
    const response = await fetch(`${apiBaseUrl}/api/compress`, { method: "POST", body: data });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Compression failed (${response.status}).`);
    }
    const blob = await response.blob();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const alreadySmaller = response.headers.get("X-Already-Smaller") === "true";
    const didNotReduce = response.headers.get("X-Not-Reduced") === "true";
    const link = document.querySelector("#download");
    link.href = downloadUrl;
    link.download = didNotReduce ? selectedFile.name : `${selectedFile.name.replace(/\.pdf$/i, "")}-compressed.pdf`;
    link.textContent = didNotReduce ? "Download original PDF" : "Download compressed PDF";
    const difference = Math.round(Math.abs(1 - blob.size / selectedFile.size) * 100);
    const sizeMessage = alreadySmaller
      ? "The original is already smaller than the target."
      : didNotReduce
        ? "Compression would increase the file size, so the original is provided instead."
        : `${(blob.size / 1024).toFixed(1)} KB · ${difference}% smaller`;
    const targetMissed = modeInput.value === "target" && response.headers.get("X-Target-Reached") === "false";
    document.querySelector("#result-message").textContent = `${sizeMessage}${targetMissed ? " · target size could not be reached; this is the smallest result" : ""}`;
    document.querySelector("#result").hidden = false;
    document.querySelector("#progress-bar").style.width = "100%";
    document.querySelector("#status").textContent = "Compression complete.";
  } catch (error) {
    document.querySelector("#status").textContent = error instanceof Error ? error.message : "PDF compression failed.";
  } finally {
    compressButton.disabled = false;
  }
});
window.addEventListener("beforeunload", () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
