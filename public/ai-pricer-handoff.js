(() => {
  const form = document.getElementById("ai-pricer-handoff");
  if (!(form instanceof HTMLFormElement)) return;

  // A deferred script runs after parsing, before DOMContentLoaded.
  // Use native POST navigation; keep the assertion out of URLs and fetch calls.
  try {
    HTMLFormElement.prototype.submit.call(form);
  } catch {
    // The form remains usable if automatic navigation is unavailable.
    form.closest("main").style.visibility = "visible";
  }
})();
