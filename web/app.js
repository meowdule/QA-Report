const line = document.getElementById("status-line");
if (line) {
  line.textContent = `클라이언트 로드 완료 · ${new Date().toISOString()}`;
}
