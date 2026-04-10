(function () {
  "use strict";

  var sel = document.getElementById("plex-view-mode");
  if (!sel) return;

  function currentPageValue() {
    var path = window.location.pathname || "";
    if (/index-cesium\.html$/i.test(path)) return "index-cesium.html";
    return "index.html";
  }

  var cur = currentPageValue();
  sel.value = cur;

  sel.addEventListener("change", function () {
    var v = sel.value;
    if (v && v !== cur) {
      window.location.href = v;
    }
  });
})();
