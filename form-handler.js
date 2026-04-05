/**
 * Shared inquiry form handler.
 *
 * Usage: include this script, then call:
 *   window.initInquiryForm({ sourcePage, messages })
 *
 * Also reveals obfuscated .js-email links on page load.
 */
(function () {
  // Reveal obfuscated emails
  document.querySelectorAll(".js-email").forEach(function (el) {
    var addr = el.dataset.u + "@" + el.dataset.d;
    el.href = "mailto:" + addr;
    if (el.textContent === "Loading\u2026") el.textContent = addr;
  });

  var DEFAULTS = {
    sending: "Submitting\u2026",
    success: "Thank you! We received your inquiry and will get back to you soon.",
    successEmail: "Thank you. Your inquiry was received and a confirmation email has been sent. Support targets a reply within 24 hours.",
    error: "Something went wrong. Please try again.",
    networkError: "Network error. Please check your connection and try again."
  };

  window.initInquiryForm = function (opts) {
    opts = opts || {};
    var form = document.getElementById("inquiry-form");
    if (!form) return;

    var msg = {};
    var src = opts.messages || {};
    for (var k in DEFAULTS) msg[k] = src[k] || DEFAULTS[k];

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = document.getElementById("form-status");
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      status.style.display = "block";
      status.textContent = msg.sending;
      status.style.color = "";

      var data = {};
      if (opts.sourcePage) data.sourcePage = opts.sourcePage;
      form.querySelectorAll("input, select, textarea").forEach(function (el) {
        if (el.name) data[el.name] = el.value;
      });

      fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.success) {
            status.textContent = (res.confirmationEmail && res.confirmationEmail.sent)
              ? msg.successEmail
              : msg.success;
            status.style.color = "#0c7d82";
            form.reset();
          } else {
            status.textContent = res.error || msg.error;
            status.style.color = "#c0392b";
          }
        })
        .catch(function () {
          status.textContent = msg.networkError;
          status.style.color = "#c0392b";
        })
        .finally(function () { btn.disabled = false; });
    });
  };
})();
